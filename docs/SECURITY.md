# Security & sensitive data

## Secrets

- No secret, key or credential is committed. `.env` is git-ignored; `.env.example` contains only
  `REPLACE_ME` placeholders.
- `npm run env:init` generates a per-developer `.env` with random values (`openssl rand`).
- Integration tests generate ephemeral JWT and encryption keys at runtime (`test/setup/global-setup.ts`)
  and run against throw-away containers.
- Demo users get their password from `SEED_USER_PASSWORD` (generated, never committed). The seed
  refuses to run when `NODE_ENV=production`.
- Boot fails fast if a secret is missing or weak (Joi schema: `JWT_SECRET` ≥ 32 chars,
  `FIELD_ENCRYPTION_KEY` must decode to exactly 32 bytes).
- **Production:** secrets come from a secret manager (AWS Secrets Manager / Vault), and the field
  encryption key from a KMS using envelope encryption.

## Authentication

- Passwords are hashed with bcrypt (cost 12; configurable). The hash column is `select: false`, and
  only the login query adds it.
- Login always runs a bcrypt compare, against a dummy hash for unknown emails, and returns the same
  error for unknown emails and wrong passwords. This prevents user enumeration by message or timing.
- Login is rate-limited (`LOGIN_THROTTLE_LIMIT` per `LOGIN_THROTTLE_TTL_MS`, per IP).
- JWTs are HS256, short-lived (15 min), and checked for issuer and audience. The algorithm is pinned
  on verify, so `alg: none` and algorithm-confusion tokens are rejected.
- The user is re-loaded on every request: deactivation and role changes take effect immediately, and
  role claims inside the token are never trusted for authorization.

## Authorization

See [ADR-0002](adr/0002-object-level-authorization-in-the-query.md). Summary:

| Action                         | ADMIN | SALES            | REVIEWER                 |
| ------------------------------ | ----- | ---------------- | ------------------------ |
| Create application             | ✅    | ✅               | ❌                       |
| Read / list                    | all   | own only         | all non-draft            |
| Update (DRAFT, INFO_REQUESTED) | ✅    | own only         | ❌                       |
| Submit / resubmit              | ✅    | own only         | ❌                       |
| Assign reviewer                | ✅    | ❌               | ❌                       |
| Approve / reject / request info| ❌    | ❌               | **assigned reviewer only** |
| Retry failed risk review       | ✅    | ❌               | ❌                       |
| Manage users, read audit log   | ✅    | ❌               | ❌                       |

Cross-tenant ids return 404. `ValidationPipe` uses `whitelist` + `forbidNonWhitelisted`, so
workflow fields (`status`, `createdById`, `riskStatus` …) can never be set through request bodies
(mass assignment). Ids are validated as UUIDs before reaching the database.

## Sensitive data inventory

| Field                                 | Classification     | At rest                         | In API responses | In logs / audit                 |
| ------------------------------------- | ------------------ | ------------------------------- | ---------------- | ------------------------------- |
| `users.password_hash`                 | Credential         | bcrypt hash                     | never            | never                           |
| JWT access token                      | Credential         | not stored                      | login only       | redacted (`authorization` header) |
| `merchant_applications.tax_id`        | Sensitive business identifier | **AES-256-GCM encrypted** (`tax_id_encrypted`) | masked `*******0123` | masked; updates log the field *name* only |
| `owner_email`, `owner_phone`          | PII                | plaintext *(see below)*         | full (authorized users only) | masked (`j***@acme.test`, `******0000`) |
| `owner_full_name`                     | PII                | plaintext *(see below)*         | full             | not logged                      |
| Risk vendor response                  | Confidential       | score, level, reason codes only | yes              | reason codes only               |

### Field-level encryption

**Implemented:** `tax_id` uses AES-256-GCM with a random 96-bit IV per value and an authentication
tag (tamper detection). It is stored in a versioned format (`v1:iv:tag:ciphertext`) so keys and
algorithms can be rotated gradually (`src/common/crypto/field-encryption.ts`).

**Also requires field-level encryption before production** (left as plaintext in this time-box):

| Field | Why | Approach |
| ----- | --- | -------- |
| `owner_email`, `owner_phone` | Direct PII (GDPR/privacy laws) | Encrypt, plus a keyed HMAC "blind index" column for exact-match lookup/dedup |
| `owner_full_name` | PII | Encrypt |
| Bank account / settlement details *(not modelled yet)* | Financial data | Encrypt; ideally tokenise via a vault |
| Owner national ID / DOB *(not modelled yet)* | High-risk PII used by KYB | Encrypt; restrict to the risk worker |
| Card data | **Never stored**: out of PCI scope by design | n/a |

Production key management: a data key per environment, wrapped by a KMS master key (envelope
encryption), rotated by re-encrypting under a new `v2:` prefix in the background.

## Logging and audit

- HTTP logs (pino) redact `Authorization`, cookies and any `password` / `accessToken` / `taxId`
  path. Request bodies are not logged.
- Audit metadata passes through `redact()`, which removes secrets by key name and masks PII.
- `audit_logs` is append-only, enforced by a database trigger that rejects `UPDATE`/`DELETE`.
- Each audit row carries the `request_id` (also echoed as `X-Request-Id`). The id is propagated
  into queue jobs, so a submission and its asynchronous risk result share one correlation id.
- Errors returned to clients never include stack traces or SQL; unexpected errors are logged
  server-side and return a generic 500.

## HTTP hardening

Helmet security headers. No CORS (no browser client in scope). Postgres and Redis bind to
`127.0.0.1` in Docker Compose. Containers run as the non-root `node` user. Swagger is disabled
when `NODE_ENV=production`.

## Test data

All fixtures are fictitious (`example.test` domain, `TEST-` tax ids, `+97798000…` numbers).
No real personal, customer or card data is used anywhere.
