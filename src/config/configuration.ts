/**
 * Typed configuration tree. Values are read once at boot (after Joi validation)
 * and injected via `ConfigService<AppConfig, true>` so callers get type safety.
 */
export interface AppConfig {
  app: {
    env: 'development' | 'test' | 'production';
    port: number;
    logLevel: string;
    logPretty: boolean;
  };
  database: { host: string; port: number; user: string; password: string; name: string };
  redis: { host: string; port: number };
  auth: {
    jwtSecret: string;
    jwtExpiresInSeconds: number;
    jwtIssuer: string;
    jwtAudience: string;
    bcryptRounds: number;
    loginThrottleLimit: number;
    loginThrottleTtlMs: number;
  };
  crypto: { fieldEncryptionKey: string };
  risk: {
    jobAttempts: number;
    jobBackoffMs: number;
    providerTransientFailureRate: number;
    providerLatencyMs: number;
    reconcileIntervalMs: number;
    reconcileStaleAfterMs: number;
  };
}

export const configuration = (): AppConfig => {
  const env = process.env;
  const num = (key: string, fallback: number): number =>
    env[key] !== undefined ? Number(env[key]) : fallback;

  return {
    app: {
      env: (env.NODE_ENV as AppConfig['app']['env']) ?? 'development',
      port: num('PORT', 3000),
      logLevel: env.LOG_LEVEL ?? 'info',
      logPretty: env.LOG_PRETTY === 'true',
    },
    database: {
      host: env.DATABASE_HOST as string,
      port: num('DATABASE_PORT', 5432),
      user: env.DATABASE_USER as string,
      password: env.DATABASE_PASSWORD as string,
      name: env.DATABASE_NAME as string,
    },
    redis: { host: env.REDIS_HOST as string, port: num('REDIS_PORT', 6379) },
    auth: {
      jwtSecret: env.JWT_SECRET as string,
      jwtExpiresInSeconds: num('JWT_EXPIRES_IN_SECONDS', 900),
      jwtIssuer: env.JWT_ISSUER ?? 'merchant-onboarding-api',
      jwtAudience: env.JWT_AUDIENCE ?? 'merchant-onboarding-clients',
      bcryptRounds: num('BCRYPT_ROUNDS', 12),
      loginThrottleLimit: num('LOGIN_THROTTLE_LIMIT', 5),
      loginThrottleTtlMs: num('LOGIN_THROTTLE_TTL_MS', 60000),
    },
    crypto: { fieldEncryptionKey: env.FIELD_ENCRYPTION_KEY as string },
    risk: {
      jobAttempts: num('RISK_JOB_ATTEMPTS', 5),
      jobBackoffMs: num('RISK_JOB_BACKOFF_MS', 2000),
      providerTransientFailureRate: num('RISK_PROVIDER_TRANSIENT_FAILURE_RATE', 0.2),
      providerLatencyMs: num('RISK_PROVIDER_LATENCY_MS', 300),
      reconcileIntervalMs: num('RISK_RECONCILE_INTERVAL_MS', 60000),
      reconcileStaleAfterMs: num('RISK_RECONCILE_STALE_AFTER_MS', 120000),
    },
  };
};
