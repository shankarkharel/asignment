import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { encryptedColumnTransformer } from '../../../common/crypto/field-encryption';
import { numericTransformer } from '../../../common/database/numeric.transformer';
import { UserEntity } from '../../users/domain/user.entity';
import { ApplicationStatus, BusinessType, RiskLevel, RiskStatus } from './application.enums';

@Entity({ name: 'merchant_applications' })
@Index('idx_merchant_applications_status_created', ['status', 'createdAt'])
@Index('idx_merchant_applications_creator_created', ['createdById', 'createdAt'])
@Index('idx_merchant_applications_reviewer_status', ['assignedReviewerId', 'status'])
@Index('idx_merchant_applications_risk_pending', ['updatedAt'], {
  where: `"risk_status" = 'PENDING'`,
})
@Check('chk_merchant_applications_volume', `"expected_monthly_volume" >= 0`)
@Check('chk_merchant_applications_avg_amount', `"average_transaction_amount" > 0`)
@Check('chk_merchant_applications_risk_score', `"risk_score" BETWEEN 0 AND 100`)
@Check('chk_merchant_applications_risk_check_version', `"risk_check_version" >= 0`)
@Check('chk_merchant_applications_mcc', `"merchant_category_code" ~ '^[0-9]{4}$'`)
@Check('chk_merchant_applications_currency', `"currency" ~ '^[A-Z]{3}$'`)
@Check('chk_merchant_applications_country', `"country_code" ~ '^[A-Z]{2}$'`)
// State-machine invariants, enforced again by the database:
@Check(
  'chk_merchant_applications_reviewer_required',
  `"status" NOT IN ('UNDER_REVIEW', 'INFO_REQUESTED', 'APPROVED', 'REJECTED') OR "assigned_reviewer_id" IS NOT NULL`,
)
@Check(
  'chk_merchant_applications_decided_at',
  `"status" NOT IN ('APPROVED', 'REJECTED') OR "decided_at" IS NOT NULL`,
)
@Check(
  'chk_merchant_applications_approval_risk',
  `"status" <> 'APPROVED' OR "risk_status" = 'COMPLETED'`,
)
export class MerchantApplicationEntity {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_merchant_applications' })
  id: string;

  // --- Business profile -----------------------------------------------------
  @Column({ name: 'business_name', type: 'varchar', length: 200 })
  businessName: string;

  @Column({ name: 'legal_business_name', type: 'varchar', length: 200 })
  legalBusinessName: string;

  @Column({ name: 'business_type', type: 'enum', enum: BusinessType, enumName: 'business_type' })
  businessType: BusinessType;

  /** Tax / company registration number. Encrypted at rest (AES-256-GCM); masked in API responses. */
  @Column({ name: 'tax_id_encrypted', type: 'text', transformer: encryptedColumnTransformer })
  taxId: string;

  /** ISO 3166-1 alpha-2. */
  @Column({ name: 'country_code', type: 'char', length: 2 })
  countryCode: string;

  @Column({ name: 'website_url', type: 'varchar', length: 2048, nullable: true })
  websiteUrl: string | null;

  // --- Owner / contact (PII) --------------------------------------------------
  @Column({ name: 'owner_full_name', type: 'varchar', length: 200 })
  ownerFullName: string;

  @Column({ name: 'owner_email', type: 'varchar', length: 254 })
  ownerEmail: string;

  @Column({ name: 'owner_phone', type: 'varchar', length: 20 })
  ownerPhone: string;

  // --- Requested processing ---------------------------------------------------
  /** ISO 18245 merchant category code. */
  @Column({ name: 'merchant_category_code', type: 'char', length: 4 })
  merchantCategoryCode: string;

  @Column({
    name: 'expected_monthly_volume',
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: numericTransformer,
  })
  expectedMonthlyVolume: number;

  @Column({
    name: 'average_transaction_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    transformer: numericTransformer,
  })
  averageTransactionAmount: number;

  /** ISO 4217. */
  @Column({ type: 'char', length: 3 })
  currency: string;

  // --- Workflow ---------------------------------------------------------------
  @Column({
    type: 'enum',
    enum: ApplicationStatus,
    enumName: 'application_status',
    default: ApplicationStatus.DRAFT,
  })
  status: ApplicationStatus;

  @Column({
    name: 'risk_status',
    type: 'enum',
    enum: RiskStatus,
    enumName: 'risk_status',
    default: RiskStatus.NOT_STARTED,
  })
  riskStatus: RiskStatus;

  @Column({
    name: 'risk_level',
    type: 'enum',
    enum: RiskLevel,
    enumName: 'risk_level',
    nullable: true,
  })
  riskLevel: RiskLevel | null;

  @Column({ name: 'risk_score', type: 'smallint', nullable: true })
  riskScore: number | null;

  /**
   * Monotonic counter bumped every time a new risk check is requested (submit, resubmit,
   * retry). Together with the application id it forms the idempotency key of a risk job,
   * and lets the worker discard results of superseded checks.
   */
  @Column({ name: 'risk_check_version', type: 'integer', default: 0 })
  riskCheckVersion: number;

  @Column({ name: 'created_by_id', type: 'uuid' })
  createdById: string;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'created_by_id',
    foreignKeyConstraintName: 'fk_merchant_applications_created_by',
  })
  createdBy?: UserEntity;

  @Column({ name: 'assigned_reviewer_id', type: 'uuid', nullable: true })
  assignedReviewerId: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({
    name: 'assigned_reviewer_id',
    foreignKeyConstraintName: 'fk_merchant_applications_assigned_reviewer',
  })
  assignedReviewer?: UserEntity | null;

  @Column({ name: 'decision_reason', type: 'text', nullable: true })
  decisionReason: string | null;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt: Date | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
