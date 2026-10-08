/**
 * Keys whose values must never be written to logs or the audit trail in clear text.
 * Matching is case-insensitive and ignores `_`/`-` so `access_token`, `accessToken`
 * and `Access-Token` are all caught.
 */
const SECRET_KEYS = [
  'password',
  'passwordhash',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'secret',
  'apikey',
];

/** PII that is useful in an audit trail in partially masked form. */
const MASKED_KEYS = [
  'taxid',
  'taxidentificationnumber',
  'owneremail',
  'ownerphone',
  'email',
  'phone',
];

export const REDACTED = '[REDACTED]';

const normalise = (key: string): string => key.toLowerCase().replace(/[_-]/g, '');

/** Keeps the last 4 characters: `123456789` -> `*****6789`. */
export function maskValue(value: string, visible = 4): string {
  if (value.length <= visible) return '*'.repeat(value.length);
  return '*'.repeat(value.length - visible) + value.slice(-visible);
}

/** Keeps the first character of the local part and the domain: `jane@acme.test` -> `j***@acme.test`. */
export function maskEmail(value: string): string {
  const at = value.indexOf('@');
  if (at <= 0) return maskValue(value);
  return `${value[0]}***${value.slice(at)}`;
}

/**
 * Returns a deep copy of `input` with secrets removed and PII masked.
 * Used for audit metadata and anywhere arbitrary objects are logged.
 */
export function redact<T>(input: T, depth = 0): T {
  if (depth > 8 || input === null || typeof input !== 'object') return input;
  if (input instanceof Date) return input;
  if (Array.isArray(input)) return (input as unknown[]).map((item) => redact(item, depth + 1)) as T;

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const k = normalise(key);
    if (SECRET_KEYS.some((secret) => k.includes(secret))) {
      output[key] = REDACTED;
    } else if (MASKED_KEYS.includes(k) && typeof value === 'string') {
      output[key] = k.includes('email') ? maskEmail(value) : maskValue(value);
    } else {
      output[key] = redact(value, depth + 1);
    }
  }
  return output as T;
}

/** pino `redact.paths` for HTTP logs: request headers/bodies that may carry credentials. */
export const PINO_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'req.body.password',
  'res.body.accessToken',
  '*.password',
  '*.accessToken',
  '*.taxId',
];
