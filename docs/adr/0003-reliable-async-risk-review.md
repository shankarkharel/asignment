# ADR-0003: Reliable asynchronous risk review (idempotency, retries, reconciliation)

- **Status:** Accepted
- **Date:** 2026-10-08

## Context

Submitting an application must trigger a risk/KYB check with a third-party vendor that is slow and
sometimes fails. Queues deliver *at least once*: jobs may be retried, redelivered after a worker
crash (stalled jobs), or enqueued twice by a double-click. Writing to PostgreSQL and Redis is a
dual write: one can succeed while the other fails.

## Decision

**State lives in PostgreSQL; Redis only carries work.** Each requested check gets a monotonically
increasing `risk_check_version` on the application. `(application_id, risk_check_version)` is the
identity of a check and its idempotency key.

Idempotency is layered (defence in depth):

1. **Deterministic job id** `assess-<applicationId>-v<version>`: BullMQ drops duplicate adds.
2. **Pre-check** in the worker: skip if the application no longer awaits *this* version (superseded
   by a resubmission or already completed). This also avoids a wasted vendor call.
3. **Row lock + re-check**: the result is written in a transaction that `SELECT … FOR UPDATE`s
   the application, so concurrent deliveries serialise.
4. **Unique constraint** `uq_risk_assessments_application_version` + `INSERT … ON CONFLICT DO NOTHING`:
   the database is the final backstop.
5. The **vendor call happens outside the transaction** (no lock held during network I/O) and
   receives the job id as its idempotency key, so a retried call is not billed or processed twice.

**Retries:** exponential backoff with jitter (`RISK_JOB_ATTEMPTS`, `RISK_JOB_BACKOFF_MS`).
Errors are classified: `RiskProviderTransientError` is retried; `RiskProviderPermanentError` becomes
`UnrecoverableError` (no retries). On a permanent error or the final attempt, the worker marks the
check `FAILED` and audits it. An admin can then `POST /applications/:id/risk-review/retry`, which
bumps the version.

**Dual write:** the API commits `risk_status = PENDING` and *then* enqueues. If the enqueue fails,
the request still succeeds (the submit is durable) and a **reconciler** (a BullMQ job scheduler,
one run per interval across all workers) finds checks that have been PENDING longer than
`RISK_RECONCILE_STALE_AFTER_MS`:

- no job / completed job → enqueue again (idempotent thanks to the deterministic id)
- failed job but status never persisted → mark FAILED
- waiting / active / delayed → leave alone

## Alternatives considered

- **Transactional outbox table + relay.** Stronger, general-purpose guarantee. More moving parts:
  an extra table, a relay loop, and cleanup. Here the application row already *is* the outbox
  (`PENDING` + version), so the reconciler gives the same at-least-once guarantee with less code.
  If more event types appear (webhooks, notifications), I would introduce a real outbox.
- **Enqueue inside the DB transaction.** Doesn't help: Redis isn't part of the transaction.

## Consequences

- Exactly-once *effect* on top of at-least-once delivery, verified by integration tests
  (duplicate enqueue, concurrent redelivery, stale versions, retries, exhaustion, lost-job recovery).
- A late result for a superseded check is discarded, never applied to newer data.
- Risk processing is eventually consistent: clients poll `GET /applications/:id` (or use webhooks
  in a future iteration).
