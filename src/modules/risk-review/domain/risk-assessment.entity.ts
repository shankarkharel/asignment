import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { numericTransformer } from '../../../common/database/numeric.transformer';
import { RiskLevel } from '../../applications/domain/application.enums';
import { MerchantApplicationEntity } from '../../applications/domain/merchant-application.entity';

/**
 * Result of one risk/KYB check. The unique key (application_id, check_version) is the
 * database-level idempotency guarantee: a check can be recorded at most once, no matter
 * how many times its job is delivered.
 */
@Entity({ name: 'risk_assessments' })
@Unique('uq_risk_assessments_application_version', ['applicationId', 'checkVersion'])
@Check('chk_risk_assessments_score', `"score" BETWEEN 0 AND 100`)
@Check('chk_risk_assessments_attempt', `"attempt" >= 1`)
export class RiskAssessmentEntity {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_risk_assessments' })
  id: string;

  @Column({ name: 'application_id', type: 'uuid' })
  applicationId: string;

  @ManyToOne(() => MerchantApplicationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'application_id',
    foreignKeyConstraintName: 'fk_risk_assessments_application',
  })
  application?: MerchantApplicationEntity;

  @Column({ name: 'check_version', type: 'integer' })
  checkVersion: number;

  @Column({ type: 'varchar', length: 50 })
  provider: string;

  @Column({ name: 'provider_reference', type: 'varchar', length: 100 })
  providerReference: string;

  @Column({ type: 'smallint', transformer: numericTransformer })
  score: number;

  @Column({ type: 'enum', enum: RiskLevel, enumName: 'risk_level' })
  level: RiskLevel;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  reasons: string[];

  /** Delivery attempt (1-based) that produced this result - useful when tuning retries. */
  @Column({ type: 'smallint' })
  attempt: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
