import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AuditAction } from './audit-action.enum';

/**
 * Append-only audit record. UPDATE/DELETE are rejected by a database trigger
 * (see migration), so immutability does not depend on application code.
 */
@Entity({ name: 'audit_logs' })
@Index('idx_audit_logs_entity', ['entityType', 'entityId', 'createdAt'])
@Index('idx_audit_logs_actor', ['actorId', 'createdAt'])
export class AuditLogEntity {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_audit_logs' })
  id: string;

  /** NULL when the actor is the system (e.g. the risk-review worker). */
  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({ type: 'enum', enum: AuditAction, enumName: 'audit_action' })
  action: AuditAction;

  @Column({ name: 'entity_type', type: 'varchar', length: 50 })
  entityType: string;

  @Column({ name: 'entity_id', type: 'uuid' })
  entityId: string;

  /** Redacted before persisting - never contains secrets or unmasked PII. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata: Record<string, unknown>;

  @Column({ name: 'request_id', type: 'varchar', length: 64, nullable: true })
  requestId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
