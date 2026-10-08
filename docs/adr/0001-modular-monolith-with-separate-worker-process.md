# ADR-0001: Modular monolith with a separate worker process

- **Status:** Accepted
- **Date:** 2026-10-08

## Context

The platform has two kinds of workload: low-latency HTTP requests (CRUD, decisions) and slow,
failure-prone calls to a third-party risk/KYB vendor. They scale differently. A vendor outage must
not degrade the API, and a traffic spike on the API must not starve risk processing.

## Decision

One codebase and one Docker image, with **two entrypoints**:

| Process  | Entrypoint      | Root module      | Contains                                                         |
| -------- | --------------- | ---------------- | ---------------------------------------------------------------- |
| `api`    | `dist/main.js`  | `AppModule`      | Controllers, guards, use-cases, queue **producer**               |
| `worker` | `dist/worker.js`| `WorkerModule`   | BullMQ **consumer**, vendor client, reconciler (no HTTP server)  |

Both share `InfrastructureModule` (config, logging, TypeORM, Redis connection). Risk-review code is
split into `RiskReviewQueueModule` (producer only, imported by the API) and `RiskReviewWorkerModule`
(consumer), so the API never loads worker code.

Within the codebase, modules follow feature boundaries (`auth`, `users`, `applications`,
`risk-review`, `audit`). Business rules (state machine, access policy, scoring) are framework-free
functions, so they can be unit-tested without Nest or a database.

## Consequences

- API and worker scale and deploy independently (`docker compose up --scale worker=3`).
- No network hop or contract versioning between services, unlike microservices; one deploy artifact.
- The integration tests compose both root modules into one process, so the real worker runs in the tests.
- If a module later needs to become a separate service, the boundaries are already explicit.
