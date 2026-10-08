import type { DataSourceOptions } from 'typeorm';
import type { AppConfig } from '../config/configuration';
import { MerchantApplicationEntity } from '../modules/applications/domain/merchant-application.entity';
import { AuditLogEntity } from '../modules/audit/domain/audit-log.entity';
import { RiskAssessmentEntity } from '../modules/risk-review/domain/risk-assessment.entity';
import { UserEntity } from '../modules/users/domain/user.entity';

export const ENTITIES = [
  UserEntity,
  MerchantApplicationEntity,
  RiskAssessmentEntity,
  AuditLogEntity,
];

/**
 * Single source of truth for DB options, shared by the Nest app and the TypeORM CLI.
 * `synchronize` is always off: the schema only changes through reviewed migrations.
 */
export const buildDataSourceOptions = (db: AppConfig['database']): DataSourceOptions => ({
  type: 'postgres',
  host: db.host,
  port: db.port,
  username: db.user,
  password: db.password,
  database: db.name,
  entities: ENTITIES,
  migrations: [`${__dirname}/migrations/*.{ts,js}`],
  migrationsTableName: 'typeorm_migrations',
  synchronize: false,
  uuidExtension: 'pgcrypto', // gen_random_uuid() - built into PostgreSQL 13+
  // Tests assert on expected DB errors (e.g. the audit trigger); keep their output clean.
  logging: process.env.NODE_ENV === 'test' ? false : ['error', 'warn', 'migration'],
  applicationName: 'merchant-onboarding-api',
  extra: { max: 10 },
});
