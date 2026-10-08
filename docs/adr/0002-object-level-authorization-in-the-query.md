# ADR-0002: Object-level authorization is enforced inside the SQL query

- **Status:** Accepted
- **Date:** 2026-10-08

## Context

SALES users must only see and edit applications they created. The usual failure mode (IDOR/BOLA,
OWASP API #1) is loading a row by id and *forgetting* the ownership check on one code path, or
filtering after the fetch in list endpoints, which breaks pagination counts and leaks totals.

## Decision

Authorization has three layers, each with a single owner:

1. **Authentication** – global `JwtAuthGuard`, deny-by-default (`@Public()` to opt out). The user is
   re-loaded from the DB on each request, so role changes and deactivation apply immediately, and
   role claims in the token are never trusted.
2. **Role (coarse)** – global `RolesGuard` + `@Roles(...)` on routes.
3. **Object (fine)** – `ApplicationAccessPolicy`:
   - `visibilityConstraint(user)` returns a SQL predicate that is **added to every read and every
     `SELECT … FOR UPDATE`** in `ApplicationsService`. Out-of-scope rows are never loaded.
   - `assertCanManage` / `assertCanDecide` check *actions* on rows the user is allowed to see.

An out-of-scope id returns **404, not 403**, so the API does not reveal whether another user's
application exists. A row that is visible but where the action isn't allowed (e.g. a non-assigned
reviewer deciding) returns 403.

Visibility per role:

| Role     | Sees                                   |
| -------- | -------------------------------------- |
| ADMIN    | all applications                       |
| SALES    | `created_by_id = me`                   |
| REVIEWER | all applications with `status <> DRAFT` (the review queue) |

## Consequences

- Every use-case goes through `findVisibleForUpdate`/`findOne`, so there is no unscoped code path to forget.
- The policy is pure and fully unit-tested; integration tests attack every endpoint across tenants.
- Reviewers can read any non-draft application. If business wants "assigned only", it is a
  one-line change to the predicate.
