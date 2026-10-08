import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { UnrecoverableError } from 'bullmq';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { RiskLevel, RiskStatus } from '../applications/domain/application.enums';
import { MerchantApplicationEntity } from '../applications/domain/merchant-application.entity';
import { AuditAction } from '../audit/domain/audit-action.enum';
import { AuditService } from '../audit/audit.service';
import { RiskAssessmentEntity } from './domain/risk-assessment.entity';
import {
  RISK_PROVIDER,
  RiskProvider,
  RiskProviderPermanentError,
} from './provider/risk-provider.interface';
import { AssessRiskJobData } from './risk-review.constants';

export interface AttemptContext {
  /** 1-based number of the current delivery attempt. */
  attempt: number;
  maxAttempts: number;
  idempotencyKey: string;
}

export type AssessmentOutcome =
  | { status: 'completed'; score: number; level: RiskLevel }
  | { status: 'skipped'; reason: 'APPLICATION_NOT_FOUND' | 'NOT_AWAITING_CHECK' };

/**
 * Executes a risk check for one (application, checkVersion) pair.
 *
 * Idempotency is layered:
 *  1. Deterministic job id   - the queue never holds two jobs for the same check.
 *  2. Pre-check              - superseded or already-completed checks are skipped cheaply.
 *  3. Row lock + re-check    - concurrent deliveries serialise on `SELECT ... FOR UPDATE`.
 *  4. Unique constraint      - `risk_assessments(application_id, check_version)` is the final backstop.
 *
 * The vendor call happens *outside* the DB transaction so no row lock is held during network I/O.
 */
@Injectable()
export class RiskReviewService {
  private readonly logger = new Logger(RiskReviewService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(MerchantApplicationEntity)
    private readonly applications: Repository<MerchantApplicationEntity>,
    @Inject(RISK_PROVIDER) private readonly provider: RiskProvider,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Entry point used by the queue processor. Classifies failures:
   *  - permanent provider error -> mark FAILED, throw `UnrecoverableError` (no further retries)
   *  - transient error          -> rethrow so BullMQ retries with exponential backoff;
   *                                on the final attempt mark FAILED first.
   */
  async process(data: AssessRiskJobData, ctx: AttemptContext): Promise<AssessmentOutcome> {
    try {
      return await this.assess(data, ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const permanent = error instanceof RiskProviderPermanentError;
      const finalAttempt = ctx.attempt >= ctx.maxAttempts;

      this.logger.warn(
        {
          applicationId: data.applicationId,
          checkVersion: data.checkVersion,
          attempt: ctx.attempt,
          permanent,
        },
        `Risk assessment attempt failed: ${message}`,
      );

      if (permanent || finalAttempt) {
        await this.markFailed(
          data,
          permanent ? `PERMANENT: ${message}` : `RETRIES_EXHAUSTED: ${message}`,
        );
      }
      if (permanent) throw new UnrecoverableError(message);
      throw error;
    }
  }

  private async assess(data: AssessRiskJobData, ctx: AttemptContext): Promise<AssessmentOutcome> {
    const application = await this.applications.findOneBy({ id: data.applicationId });
    if (!application) return { status: 'skipped', reason: 'APPLICATION_NOT_FOUND' };
    if (!this.isAwaitingCheck(application, data.checkVersion)) {
      return { status: 'skipped', reason: 'NOT_AWAITING_CHECK' };
    }

    const result = await this.provider.assess({
      idempotencyKey: ctx.idempotencyKey,
      legalBusinessName: application.legalBusinessName,
      businessType: application.businessType,
      taxId: application.taxId,
      countryCode: application.countryCode,
      merchantCategoryCode: application.merchantCategoryCode,
      expectedMonthlyVolume: application.expectedMonthlyVolume,
      averageTransactionAmount: application.averageTransactionAmount,
    });

    return this.dataSource.transaction(async (manager): Promise<AssessmentOutcome> => {
      const locked = await this.lockApplication(manager, data.applicationId);
      if (!locked || !this.isAwaitingCheck(locked, data.checkVersion)) {
        return { status: 'skipped', reason: 'NOT_AWAITING_CHECK' };
      }

      const insert = await manager
        .createQueryBuilder()
        .insert()
        .into(RiskAssessmentEntity)
        .values({
          applicationId: data.applicationId,
          checkVersion: data.checkVersion,
          provider: result.provider,
          providerReference: result.providerReference,
          score: result.score,
          level: result.level,
          reasons: result.reasons,
          attempt: ctx.attempt,
        })
        .orIgnore()
        .execute();
      if ((insert.raw as unknown[]).length === 0) {
        return { status: 'skipped', reason: 'NOT_AWAITING_CHECK' };
      }

      await manager.update(MerchantApplicationEntity, data.applicationId, {
        riskStatus: RiskStatus.COMPLETED,
        riskScore: result.score,
        riskLevel: result.level,
      });
      await this.auditService.record(
        {
          actorId: null,
          action: AuditAction.RISK_REVIEW_COMPLETED,
          entityType: 'merchant_application',
          entityId: data.applicationId,
          metadata: {
            checkVersion: data.checkVersion,
            score: result.score,
            level: result.level,
            reasons: result.reasons,
            providerReference: result.providerReference,
            attempt: ctx.attempt,
          },
        },
        manager,
      );

      this.logger.log(
        { applicationId: data.applicationId, checkVersion: data.checkVersion, level: result.level },
        'Risk assessment completed',
      );
      return { status: 'completed', score: result.score, level: result.level };
    });
  }

  /** Marks a check FAILED unless it was already superseded or completed. Safe to call repeatedly. */
  async markFailed(data: AssessRiskJobData, reason: string): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const locked = await this.lockApplication(manager, data.applicationId);
      if (!locked || !this.isAwaitingCheck(locked, data.checkVersion)) return false;

      await manager.update(MerchantApplicationEntity, data.applicationId, {
        riskStatus: RiskStatus.FAILED,
      });
      await this.auditService.record(
        {
          actorId: null,
          action: AuditAction.RISK_REVIEW_FAILED,
          entityType: 'merchant_application',
          entityId: data.applicationId,
          metadata: { checkVersion: data.checkVersion, reason },
        },
        manager,
      );
      return true;
    });
  }

  private isAwaitingCheck(application: MerchantApplicationEntity, checkVersion: number): boolean {
    return (
      application.riskCheckVersion === checkVersion && application.riskStatus === RiskStatus.PENDING
    );
  }

  private lockApplication(manager: EntityManager, id: string) {
    return manager.getRepository(MerchantApplicationEntity).findOne({
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
  }
}
