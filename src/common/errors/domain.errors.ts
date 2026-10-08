/**
 * Framework-agnostic domain errors. Services throw these; the global
 * exception filter is the single place that maps them to HTTP responses.
 * This keeps business logic free of transport concerns (and reusable from the worker).
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ResourceNotFoundError extends DomainError {
  readonly code = 'RESOURCE_NOT_FOUND';

  constructor(resource: string, id: string) {
    super(`${resource} ${id} not found`, { resource, id });
  }
}

/** The caller can see the resource but is not permitted to perform this action on it. */
export class ForbiddenActionError extends DomainError {
  readonly code = 'FORBIDDEN_ACTION';
}

export class InvalidStateTransitionError extends DomainError {
  readonly code = 'INVALID_STATE_TRANSITION';

  constructor(action: string, from: string) {
    super(`Cannot ${action} an application in status ${from}`, { action, from });
  }
}

/** A domain precondition is not met (e.g. approving before risk review completed). */
export class BusinessRuleViolationError extends DomainError {
  readonly code = 'BUSINESS_RULE_VIOLATION';
}

export class InvalidCredentialsError extends DomainError {
  readonly code = 'INVALID_CREDENTIALS';

  constructor() {
    super('Invalid email or password');
  }
}

export class ConflictError extends DomainError {
  readonly code = 'CONFLICT';
}
