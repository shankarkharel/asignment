import * as Joi from 'joi';

/**
 * Fail-fast validation of process environment. The app refuses to boot with a
 * missing or weak secret rather than silently falling back to an insecure default.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
    .default('info'),
  /** Human-readable logs for local `npm run start:dev` (requires the pino-pretty dev dependency). */
  LOG_PRETTY: Joi.boolean().default(false),

  DATABASE_HOST: Joi.string().required(),
  DATABASE_PORT: Joi.number().port().default(5432),
  DATABASE_USER: Joi.string().required(),
  DATABASE_PASSWORD: Joi.string().required(),
  DATABASE_NAME: Joi.string().required(),

  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().port().default(6379),

  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN_SECONDS: Joi.number().integer().positive().default(900),
  JWT_ISSUER: Joi.string().default('merchant-onboarding-api'),
  JWT_AUDIENCE: Joi.string().default('merchant-onboarding-clients'),
  BCRYPT_ROUNDS: Joi.number().integer().min(4).max(15).default(12),

  /** 32 bytes, base64-encoded. Used for AES-256-GCM field-level encryption. */
  FIELD_ENCRYPTION_KEY: Joi.string()
    .base64()
    .required()
    .custom((value: string, helpers) =>
      Buffer.from(value, 'base64').length === 32 ? value : helpers.error('any.invalid'),
    )
    .messages({ 'any.invalid': 'FIELD_ENCRYPTION_KEY must decode to exactly 32 bytes' }),

  RISK_JOB_ATTEMPTS: Joi.number().integer().min(1).default(5),
  RISK_JOB_BACKOFF_MS: Joi.number().integer().min(1).default(2000),
  RISK_PROVIDER_TRANSIENT_FAILURE_RATE: Joi.number().min(0).max(1).default(0.2),
  RISK_PROVIDER_LATENCY_MS: Joi.number().integer().min(0).default(300),
  RISK_RECONCILE_INTERVAL_MS: Joi.number().integer().min(1000).default(60000),
  RISK_RECONCILE_STALE_AFTER_MS: Joi.number().integer().min(1000).default(120000),

  LOGIN_THROTTLE_LIMIT: Joi.number().integer().min(1).default(5),
  LOGIN_THROTTLE_TTL_MS: Joi.number().integer().min(1000).default(60000),
});
