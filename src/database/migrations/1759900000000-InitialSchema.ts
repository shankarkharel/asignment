import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial schema. Hand-written (not auto-generated) so that every constraint is intentional:
 *  - enums for closed vocabularies, CHECK constraints for value domains
 *  - indexes matching the actual query patterns (list by status / creator / reviewer)
 *  - a unique key that makes risk-check recording idempotent
 *  - a trigger that makes the audit log append-only at the database level
 */
export class InitialSchema1759900000000 implements MigrationInterface {
  name = 'InitialSchema1759900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "user_role" AS ENUM ('ADMIN', 'REVIEWER', 'SALES')`);
    await queryRunner.query(
      `CREATE TYPE "business_type" AS ENUM ('SOLE_PROPRIETORSHIP', 'PARTNERSHIP', 'PRIVATE_LIMITED', 'PUBLIC_LIMITED', 'NON_PROFIT')`,
    );
    await queryRunner.query(
      `CREATE TYPE "application_status" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'INFO_REQUESTED', 'APPROVED', 'REJECTED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "risk_status" AS ENUM ('NOT_STARTED', 'PENDING', 'COMPLETED', 'FAILED')`,
    );
    await queryRunner.query(`CREATE TYPE "risk_level" AS ENUM ('LOW', 'MEDIUM', 'HIGH')`);
    await queryRunner.query(
      `CREATE TYPE "audit_action" AS ENUM ('USER_LOGGED_IN', 'APPLICATION_CREATED', 'APPLICATION_UPDATED', 'APPLICATION_SUBMITTED', 'REVIEWER_ASSIGNED', 'REVIEW_DECISION_RECORDED', 'RISK_REVIEW_REQUESTED', 'RISK_REVIEW_COMPLETED', 'RISK_REVIEW_FAILED')`,
    );

    // --- users -----------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id"            uuid         NOT NULL DEFAULT gen_random_uuid(),
        "email"         varchar(254) NOT NULL,
        "password_hash" varchar(100) NOT NULL,
        "full_name"     varchar(200) NOT NULL,
        "role"          "user_role"  NOT NULL,
        "is_active"     boolean      NOT NULL DEFAULT true,
        "created_at"    timestamptz  NOT NULL DEFAULT now(),
        "updated_at"    timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_users" PRIMARY KEY ("id"),
        CONSTRAINT "chk_users_email_lowercase" CHECK ("email" = lower("email"))
      )`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_users_email" ON "users" ("email")`);

    // --- merchant_applications ---------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "merchant_applications" (
        "id"                         uuid                 NOT NULL DEFAULT gen_random_uuid(),
        "business_name"              varchar(200)         NOT NULL,
        "legal_business_name"        varchar(200)         NOT NULL,
        "business_type"              "business_type"      NOT NULL,
        "tax_id_encrypted"           text                 NOT NULL,
        "country_code"               char(2)              NOT NULL,
        "website_url"                varchar(2048),
        "owner_full_name"            varchar(200)         NOT NULL,
        "owner_email"                varchar(254)         NOT NULL,
        "owner_phone"                varchar(20)          NOT NULL,
        "merchant_category_code"     char(4)              NOT NULL,
        "expected_monthly_volume"    numeric(14,2)        NOT NULL,
        "average_transaction_amount" numeric(12,2)        NOT NULL,
        "currency"                   char(3)              NOT NULL,
        "status"                     "application_status" NOT NULL DEFAULT 'DRAFT',
        "risk_status"                "risk_status"        NOT NULL DEFAULT 'NOT_STARTED',
        "risk_level"                 "risk_level",
        "risk_score"                 smallint,
        "risk_check_version"         integer              NOT NULL DEFAULT 0,
        "created_by_id"              uuid                 NOT NULL,
        "assigned_reviewer_id"       uuid,
        "decision_reason"            text,
        "submitted_at"               timestamptz,
        "decided_at"                 timestamptz,
        "created_at"                 timestamptz          NOT NULL DEFAULT now(),
        "updated_at"                 timestamptz          NOT NULL DEFAULT now(),
        CONSTRAINT "pk_merchant_applications" PRIMARY KEY ("id"),
        CONSTRAINT "fk_merchant_applications_created_by"
          FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_merchant_applications_assigned_reviewer"
          FOREIGN KEY ("assigned_reviewer_id") REFERENCES "users" ("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_merchant_applications_volume" CHECK ("expected_monthly_volume" >= 0),
        CONSTRAINT "chk_merchant_applications_avg_amount" CHECK ("average_transaction_amount" > 0),
        CONSTRAINT "chk_merchant_applications_risk_score" CHECK ("risk_score" BETWEEN 0 AND 100),
        CONSTRAINT "chk_merchant_applications_risk_check_version" CHECK ("risk_check_version" >= 0),
        CONSTRAINT "chk_merchant_applications_mcc" CHECK ("merchant_category_code" ~ '^[0-9]{4}$'),
        CONSTRAINT "chk_merchant_applications_currency" CHECK ("currency" ~ '^[A-Z]{3}$'),
        CONSTRAINT "chk_merchant_applications_country" CHECK ("country_code" ~ '^[A-Z]{2}$'),
        -- Invariants the state machine relies on, enforced again by the database:
        CONSTRAINT "chk_merchant_applications_reviewer_required"
          CHECK ("status" NOT IN ('UNDER_REVIEW', 'INFO_REQUESTED', 'APPROVED', 'REJECTED')
                 OR "assigned_reviewer_id" IS NOT NULL),
        CONSTRAINT "chk_merchant_applications_decided_at"
          CHECK ("status" NOT IN ('APPROVED', 'REJECTED') OR "decided_at" IS NOT NULL),
        CONSTRAINT "chk_merchant_applications_approval_risk"
          CHECK ("status" <> 'APPROVED' OR "risk_status" = 'COMPLETED')
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_merchant_applications_status_created" ON "merchant_applications" ("status", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_merchant_applications_creator_created" ON "merchant_applications" ("created_by_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_merchant_applications_reviewer_status" ON "merchant_applications" ("assigned_reviewer_id", "status")`,
    );
    // Partial index for the reconciler's "stuck PENDING checks" sweep.
    await queryRunner.query(
      `CREATE INDEX "idx_merchant_applications_risk_pending" ON "merchant_applications" ("updated_at") WHERE "risk_status" = 'PENDING'`,
    );

    // --- risk_assessments ----------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "risk_assessments" (
        "id"                 uuid         NOT NULL DEFAULT gen_random_uuid(),
        "application_id"     uuid         NOT NULL,
        "check_version"      integer      NOT NULL,
        "provider"           varchar(50)  NOT NULL,
        "provider_reference" varchar(100) NOT NULL,
        "score"              smallint     NOT NULL,
        "level"              "risk_level" NOT NULL,
        "reasons"            jsonb        NOT NULL DEFAULT '[]'::jsonb,
        "attempt"            smallint     NOT NULL,
        "created_at"         timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "pk_risk_assessments" PRIMARY KEY ("id"),
        CONSTRAINT "uq_risk_assessments_application_version" UNIQUE ("application_id", "check_version"),
        CONSTRAINT "fk_risk_assessments_application"
          FOREIGN KEY ("application_id") REFERENCES "merchant_applications" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_risk_assessments_score" CHECK ("score" BETWEEN 0 AND 100),
        CONSTRAINT "chk_risk_assessments_attempt" CHECK ("attempt" >= 1)
      )`);

    // --- audit_logs ------------------------------------------------------------------
    // No FK on actor_id/entity_id on purpose: audit records must outlive the rows they describe.
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id"          uuid           NOT NULL DEFAULT gen_random_uuid(),
        "actor_id"    uuid,
        "action"      "audit_action" NOT NULL,
        "entity_type" varchar(50)    NOT NULL,
        "entity_id"   uuid           NOT NULL,
        "metadata"    jsonb          NOT NULL DEFAULT '{}'::jsonb,
        "request_id"  varchar(64),
        "created_at"  timestamptz    NOT NULL DEFAULT now(),
        CONSTRAINT "pk_audit_logs" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE INDEX "idx_audit_logs_entity" ON "audit_logs" ("entity_type", "entity_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_audit_logs_actor" ON "audit_logs" ("actor_id", "created_at")`,
    );
    await queryRunner.query(`
      CREATE FUNCTION "audit_logs_block_mutation"() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'audit_logs is append-only (% rejected)', TG_OP
          USING ERRCODE = 'insufficient_privilege';
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(`
      CREATE TRIGGER "trg_audit_logs_append_only"
      BEFORE UPDATE OR DELETE ON "audit_logs"
      FOR EACH ROW EXECUTE FUNCTION "audit_logs_block_mutation"()`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER "trg_audit_logs_append_only" ON "audit_logs"`);
    await queryRunner.query(`DROP FUNCTION "audit_logs_block_mutation"()`);
    await queryRunner.query(`DROP TABLE "audit_logs"`);
    await queryRunner.query(`DROP TABLE "risk_assessments"`);
    await queryRunner.query(`DROP TABLE "merchant_applications"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "audit_action"`);
    await queryRunner.query(`DROP TYPE "risk_level"`);
    await queryRunner.query(`DROP TYPE "risk_status"`);
    await queryRunner.query(`DROP TYPE "application_status"`);
    await queryRunner.query(`DROP TYPE "business_type"`);
    await queryRunner.query(`DROP TYPE "user_role"`);
  }
}
