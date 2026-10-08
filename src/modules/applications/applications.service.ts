import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository, SelectQueryBuilder } from 'typeorm';
import { buildPaginationMeta, Paginated } from '../../common/dto/pagination.dto';
import {
  BusinessRuleViolationError,
  ResourceNotFoundError,
} from '../../common/errors/domain.errors';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { AuditAction } from '../audit/domain/audit-action.enum';
import { AuditService } from '../audit/audit.service';
import { RiskAssessmentEntity } from '../risk-review/domain/risk-assessment.entity';
import { RiskReviewQueue } from '../risk-review/risk-review.queue';
import { Role } from '../users/domain/role.enum';
import { UsersService } from '../users/users.service';
import { ApplicationAccessPolicy } from './domain/application-access.policy';
import {
  ApplicationAction,
  assertDecisionPreconditions,
  assertRiskRetryAllowed,
  decisionToAction,
  transition,
} from './domain/application-state-machine';
import { ApplicationStatus, ReviewDecision, RiskStatus } from './domain/application.enums';
import { MerchantApplicationEntity } from './domain/merchant-application.entity';
import { CreateApplicationDto } from './dto/create-application.dto';
import { ListApplicationsQueryDto } from './dto/list-applications-query.dto';
import { ReviewDecisionDto } from './dto/review-decision.dto';
import { UpdateApplicationDto } from './dto/update-application.dto';

const ENTITY_TYPE = 'merchant_application';
const ALIAS = 'application';

/**
 * Application use-cases. Every state change follows the same recipe inside one transaction:
 *   1. load the row *within the caller's visibility scope* and lock it (FOR UPDATE)
 *   2. check the object-level permission           (ApplicationAccessPolicy)
 *   3. compute the next status                     (state machine - throws on invalid transition)
 *   4. persist + write the audit entry atomically
 * Side effects outside the database (enqueueing jobs) run only after commit.
 */
@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(MerchantApplicationEntity)
    private readonly applications: Repository<MerchantApplicationEntity>,
    @InjectRepository(RiskAssessmentEntity)
    private readonly riskAssessments: Repository<RiskAssessmentEntity>,
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
    private readonly riskReviewQueue: RiskReviewQueue,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateApplicationDto,
  ): Promise<MerchantApplicationEntity> {
    return this.dataSource.transaction(async (manager) => {
      const application = await manager.save(
        manager.create(MerchantApplicationEntity, {
          ...dto,
          websiteUrl: dto.websiteUrl ?? null,
          status: ApplicationStatus.DRAFT,
          riskStatus: RiskStatus.NOT_STARTED,
          createdById: user.id,
        }),
      );
      await this.audit(manager, user, AuditAction.APPLICATION_CREATED, application.id, {
        businessName: application.businessName,
        status: application.status,
      });
      return application;
    });
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateApplicationDto,
  ): Promise<MerchantApplicationEntity> {
    return this.dataSource.transaction(async (manager) => {
      const application = await this.findVisibleForUpdate(manager, user, id);
      ApplicationAccessPolicy.assertCanManage(user, application);
      transition(application.status, ApplicationAction.UPDATE);

      const changedFields = Object.keys(dto).filter(
        (key) => dto[key as keyof UpdateApplicationDto] !== undefined,
      );
      Object.assign(application, dto);
      const saved = await manager.save(application);

      // Field names only: values may be PII and the audit log is not the system of record for them.
      await this.audit(manager, user, AuditAction.APPLICATION_UPDATED, id, { changedFields });
      return saved;
    });
  }

  async submit(user: AuthenticatedUser, id: string): Promise<MerchantApplicationEntity> {
    const submitted = await this.dataSource.transaction(async (manager) => {
      const application = await this.findVisibleForUpdate(manager, user, id);
      ApplicationAccessPolicy.assertCanManage(user, application);

      const from = application.status;
      application.status = transition(from, ApplicationAction.SUBMIT);
      this.startNewRiskCheck(application);
      application.submittedAt = new Date();
      const saved = await manager.save(application);

      await this.audit(manager, user, AuditAction.APPLICATION_SUBMITTED, id, {
        from,
        to: saved.status,
        riskCheckVersion: saved.riskCheckVersion,
      });
      return saved;
    });

    await this.enqueueRiskReview(submitted);
    return submitted;
  }

  async assignReviewer(
    user: AuthenticatedUser,
    id: string,
    reviewerId: string,
  ): Promise<MerchantApplicationEntity> {
    const reviewer = await this.usersService.findActiveById(reviewerId);
    if (!reviewer || reviewer.role !== Role.REVIEWER) {
      throw new BusinessRuleViolationError(
        'Assignee must be an active user with the REVIEWER role',
        {
          reviewerId,
        },
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const application = await this.findVisibleForUpdate(manager, user, id);
      const from = application.status;
      const previousReviewerId = application.assignedReviewerId;

      application.status = transition(from, ApplicationAction.ASSIGN_REVIEWER);
      application.assignedReviewerId = reviewer.id;
      const saved = await manager.save(application);

      await this.audit(manager, user, AuditAction.REVIEWER_ASSIGNED, id, {
        reviewerId: reviewer.id,
        previousReviewerId,
        from,
        to: saved.status,
      });
      return saved;
    });
  }

  async decide(
    user: AuthenticatedUser,
    id: string,
    dto: ReviewDecisionDto,
  ): Promise<MerchantApplicationEntity> {
    return this.dataSource.transaction(async (manager) => {
      const application = await this.findVisibleForUpdate(manager, user, id);
      ApplicationAccessPolicy.assertCanDecide(user, application);

      const from = application.status;
      application.status = transition(from, decisionToAction[dto.decision]);
      assertDecisionPreconditions(dto.decision, application.riskStatus);

      application.decisionReason = dto.reason ?? null;
      if (dto.decision !== ReviewDecision.REQUEST_INFO) application.decidedAt = new Date();
      const saved = await manager.save(application);

      await this.audit(manager, user, AuditAction.REVIEW_DECISION_RECORDED, id, {
        decision: dto.decision,
        reason: dto.reason,
        from,
        to: saved.status,
        riskLevel: saved.riskLevel,
        riskScore: saved.riskScore,
      });
      return saved;
    });
  }

  /** Re-runs a risk check that ended in FAILED (e.g. vendor outage outlasted all retries). */
  async retryRiskReview(user: AuthenticatedUser, id: string): Promise<MerchantApplicationEntity> {
    const updated = await this.dataSource.transaction(async (manager) => {
      const application = await this.findVisibleForUpdate(manager, user, id);
      transition(application.status, ApplicationAction.RETRY_RISK_REVIEW);
      assertRiskRetryAllowed(application.riskStatus);

      this.startNewRiskCheck(application);
      const saved = await manager.save(application);
      await this.audit(manager, user, AuditAction.RISK_REVIEW_REQUESTED, id, {
        riskCheckVersion: saved.riskCheckVersion,
        retry: true,
      });
      return saved;
    });

    await this.enqueueRiskReview(updated);
    return updated;
  }

  async findOne(user: AuthenticatedUser, id: string): Promise<MerchantApplicationEntity> {
    const qb = this.applications.createQueryBuilder(ALIAS).where(`${ALIAS}.id = :id`, { id });
    this.applyVisibility(qb, user);
    const application = await qb.getOne();
    if (!application) throw new ResourceNotFoundError('MerchantApplication', id);
    return application;
  }

  async list(
    user: AuthenticatedUser,
    query: ListApplicationsQueryDto,
  ): Promise<Paginated<MerchantApplicationEntity>> {
    const qb = this.applications
      .createQueryBuilder(ALIAS)
      .orderBy(`${ALIAS}.createdAt`, 'DESC')
      .addOrderBy(`${ALIAS}.id`, 'DESC') // stable ordering across pages
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    this.applyVisibility(qb, user);
    if (query.status?.length)
      qb.andWhere(`${ALIAS}.status IN (:...statuses)`, { statuses: query.status });
    if (query.riskStatus)
      qb.andWhere(`${ALIAS}.riskStatus = :riskStatus`, { riskStatus: query.riskStatus });
    if (query.assignedReviewerId) {
      qb.andWhere(`${ALIAS}.assignedReviewerId = :reviewerId`, {
        reviewerId: query.assignedReviewerId,
      });
    }

    const [data, total] = await qb.getManyAndCount();
    return { data, meta: buildPaginationMeta(query.page, query.limit, total) };
  }

  async listRiskAssessments(user: AuthenticatedUser, id: string): Promise<RiskAssessmentEntity[]> {
    await this.findOne(user, id); // enforces visibility
    return this.riskAssessments.find({
      where: { applicationId: id },
      order: { checkVersion: 'DESC' },
    });
  }

  // ---------------------------------------------------------------------------

  private startNewRiskCheck(application: MerchantApplicationEntity): void {
    application.riskCheckVersion += 1;
    application.riskStatus = RiskStatus.PENDING;
    application.riskLevel = null;
    application.riskScore = null;
  }

  /**
   * Runs after commit. If enqueueing fails the request still succeeds: the application is
   * durably PENDING and the reconciler will enqueue it. Failing the request here would be
   * worse - the client would retry a submit that already happened.
   */
  private async enqueueRiskReview(application: MerchantApplicationEntity): Promise<void> {
    try {
      await this.riskReviewQueue.enqueueAssessment(application.id, application.riskCheckVersion);
    } catch (error) {
      this.logger.error(
        { err: error, applicationId: application.id, checkVersion: application.riskCheckVersion },
        'Failed to enqueue risk review; reconciler will retry',
      );
    }
  }

  private applyVisibility(
    qb: SelectQueryBuilder<MerchantApplicationEntity>,
    user: AuthenticatedUser,
  ): void {
    const constraint = ApplicationAccessPolicy.visibilityConstraint(user);
    if (constraint) qb.andWhere(constraint.clause, constraint.params);
  }

  /** Visibility-scoped `SELECT ... FOR UPDATE`. Out-of-scope rows surface as 404, never 403. */
  private async findVisibleForUpdate(
    manager: EntityManager,
    user: AuthenticatedUser,
    id: string,
  ): Promise<MerchantApplicationEntity> {
    const qb = manager
      .getRepository(MerchantApplicationEntity)
      .createQueryBuilder(ALIAS)
      .setLock('pessimistic_write')
      .where(`${ALIAS}.id = :id`, { id });
    this.applyVisibility(qb, user);

    const application = await qb.getOne();
    if (!application) throw new ResourceNotFoundError('MerchantApplication', id);
    return application;
  }

  private audit(
    manager: EntityManager,
    user: AuthenticatedUser,
    action: AuditAction,
    applicationId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    return this.auditService.record(
      { actorId: user.id, action, entityType: ENTITY_TYPE, entityId: applicationId, metadata },
      manager,
    );
  }
}
