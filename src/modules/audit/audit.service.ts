import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { buildPaginationMeta, Paginated } from '../../common/dto/pagination.dto';
import { redact } from '../../common/logging/redact';
import { currentRequestId } from '../../common/request-context/request-context';
import { AuditAction } from './domain/audit-action.enum';
import { AuditLogEntity } from './domain/audit-log.entity';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';

export interface AuditEntry {
  actorId: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLogEntity) private readonly auditLogs: Repository<AuditLogEntity>,
  ) {}

  /**
   * Persists an audit entry. Pass the transaction's `EntityManager` so the audit row
   * commits or rolls back atomically with the state change it describes.
   */
  async record(entry: AuditEntry, manager?: EntityManager): Promise<void> {
    const repository = manager?.getRepository(AuditLogEntity) ?? this.auditLogs;
    await repository.save(
      repository.create({
        actorId: entry.actorId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        metadata: redact(entry.metadata ?? {}),
        requestId: currentRequestId() ?? null,
      }),
    );
  }

  async list(query: ListAuditLogsQueryDto): Promise<Paginated<AuditLogEntity>> {
    const qb = this.auditLogs
      .createQueryBuilder('log')
      .orderBy('log.createdAt', 'DESC')
      .addOrderBy('log.id', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    if (query.entityId) qb.andWhere('log.entityId = :entityId', { entityId: query.entityId });
    if (query.action) qb.andWhere('log.action = :action', { action: query.action });
    if (query.actorId) qb.andWhere('log.actorId = :actorId', { actorId: query.actorId });

    const [data, total] = await qb.getManyAndCount();
    return { data, meta: buildPaginationMeta(query.page, query.limit, total) };
  }
}
