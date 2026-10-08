import {
  BusinessRuleViolationError,
  InvalidStateTransitionError,
} from '../../../common/errors/domain.errors';
import { ApplicationStatus, ReviewDecision, RiskStatus } from './application.enums';

export enum ApplicationAction {
  UPDATE = 'UPDATE',
  SUBMIT = 'SUBMIT',
  ASSIGN_REVIEWER = 'ASSIGN_REVIEWER',
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
  REQUEST_INFO = 'REQUEST_INFO',
  RETRY_RISK_REVIEW = 'RETRY_RISK_REVIEW',
}

const { DRAFT, SUBMITTED, UNDER_REVIEW, INFO_REQUESTED, APPROVED, REJECTED } = ApplicationStatus;

/**
 * The complete lifecycle as data: `TRANSITIONS[from][action] = to`.
 * Anything not listed is an invalid transition. Keeping this a pure table makes the
 * rules trivially reviewable and exhaustively unit-testable.
 *
 *   DRAFT ──submit──▶ SUBMITTED ──assign──▶ UNDER_REVIEW ──approve──▶ APPROVED
 *                                              │  ▲     └──reject───▶ REJECTED
 *                                   request_info  │ resubmit
 *                                              ▼  │
 *                                          INFO_REQUESTED
 */
const TRANSITIONS: Readonly<
  Record<ApplicationStatus, Partial<Record<ApplicationAction, ApplicationStatus>>>
> = {
  [DRAFT]: {
    [ApplicationAction.UPDATE]: DRAFT,
    [ApplicationAction.SUBMIT]: SUBMITTED,
  },
  [SUBMITTED]: {
    [ApplicationAction.ASSIGN_REVIEWER]: UNDER_REVIEW,
    [ApplicationAction.RETRY_RISK_REVIEW]: SUBMITTED,
  },
  [UNDER_REVIEW]: {
    [ApplicationAction.ASSIGN_REVIEWER]: UNDER_REVIEW, // re-assignment
    [ApplicationAction.APPROVE]: APPROVED,
    [ApplicationAction.REJECT]: REJECTED,
    [ApplicationAction.REQUEST_INFO]: INFO_REQUESTED,
    [ApplicationAction.RETRY_RISK_REVIEW]: UNDER_REVIEW,
  },
  [INFO_REQUESTED]: {
    [ApplicationAction.UPDATE]: INFO_REQUESTED,
    [ApplicationAction.SUBMIT]: UNDER_REVIEW, // reviewer is already assigned
    [ApplicationAction.ASSIGN_REVIEWER]: INFO_REQUESTED,
  },
  [APPROVED]: {},
  [REJECTED]: {},
};

export const TERMINAL_STATUSES: readonly ApplicationStatus[] = [APPROVED, REJECTED];

export function canTransition(from: ApplicationStatus, action: ApplicationAction): boolean {
  return TRANSITIONS[from][action] !== undefined;
}

/** Returns the target status or throws `InvalidStateTransitionError`. */
export function transition(from: ApplicationStatus, action: ApplicationAction): ApplicationStatus {
  const to = TRANSITIONS[from][action];
  if (to === undefined) throw new InvalidStateTransitionError(action, from);
  return to;
}

export const isEditable = (status: ApplicationStatus): boolean =>
  canTransition(status, ApplicationAction.UPDATE);

export const decisionToAction: Readonly<Record<ReviewDecision, ApplicationAction>> = {
  [ReviewDecision.APPROVE]: ApplicationAction.APPROVE,
  [ReviewDecision.REJECT]: ApplicationAction.REJECT,
  [ReviewDecision.REQUEST_INFO]: ApplicationAction.REQUEST_INFO,
};

/**
 * Business preconditions beyond the status graph.
 * An application can only be approved once the automated risk review has completed;
 * rejecting or requesting info is always allowed so reviewers are never blocked.
 */
export function assertDecisionPreconditions(
  decision: ReviewDecision,
  riskStatus: RiskStatus,
): void {
  if (decision === ReviewDecision.APPROVE && riskStatus !== RiskStatus.COMPLETED) {
    throw new BusinessRuleViolationError(
      'Cannot approve an application before its risk review has completed',
      { riskStatus },
    );
  }
}

export function assertRiskRetryAllowed(riskStatus: RiskStatus): void {
  if (riskStatus !== RiskStatus.FAILED) {
    throw new BusinessRuleViolationError('Risk review can only be retried after it has failed', {
      riskStatus,
    });
  }
}
