import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { randomBytes } from 'node:crypto';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { configuration } from '../../src/config/configuration';
import { buildDataSourceOptions } from '../../src/database/data-source-options';

/**
 * Starts disposable PostgreSQL + Redis containers, exports their coordinates via env
 * (inherited by the test workers) and applies the real migrations - the same path production uses.
 */
export default async function globalSetup(): Promise<void> {
  const [postgres, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:16-alpine').start(),
    new RedisContainer('redis:7-alpine').start(),
  ]);
  (globalThis as Record<string, unknown>).__CONTAINERS__ = [postgres, redis];

  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_HOST: postgres.getHost(),
    DATABASE_PORT: String(postgres.getPort()),
    DATABASE_USER: postgres.getUsername(),
    DATABASE_PASSWORD: postgres.getPassword(),
    DATABASE_NAME: postgres.getDatabase(),
    REDIS_HOST: redis.getHost(),
    REDIS_PORT: String(redis.getMappedPort(6379)),
    // Ephemeral per-run secrets: nothing sensitive is checked into the repo, even for tests.
    JWT_SECRET: randomBytes(32).toString('hex'),
    FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    BCRYPT_ROUNDS: '4',
    RISK_JOB_ATTEMPTS: '3',
    RISK_JOB_BACKOFF_MS: '20',
    RISK_PROVIDER_LATENCY_MS: '0',
    RISK_PROVIDER_TRANSIENT_FAILURE_RATE: '0',
    RISK_RECONCILE_INTERVAL_MS: '600000',
    RISK_RECONCILE_STALE_AFTER_MS: '1000',
    LOGIN_THROTTLE_LIMIT: '1000',
  });

  const dataSource = await new DataSource(
    buildDataSourceOptions(configuration().database),
  ).initialize();
  await dataSource.runMigrations();
  await dataSource.destroy();
}
