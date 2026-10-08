import {
  BusinessRuleViolationError,
  InvalidStateTransitionError,
} from '../../../common/errors/domain.errors';
import {
  ApplicationAction,
  assertDecisionPreconditions,
  assertRiskRetryAllowed,
  canTransition,
  isEditable,
  TERMINAL_STATUSES,
  transition,
} from './application-state-machine';
import { ApplicationStatus, ReviewDecision, RiskStatus } from './application.enums';

const S = ApplicationStatus;
const A = ApplicationAction;

describe('application state machine', () => {
  describe('valid transitions', () => {
    it.each([
      [S.DRAFT, A.UPDATE, S.DRAFT],
      [S.DRAFT, A.SUBMIT, S.SUBMITTED],
      [S.SUBMITTED, A.ASSIGN_REVIEWER, S.UNDER_REVIEW],
      [S.SUBMITTED, A.RETRY_RISK_REVIEW, S.SUBMITTED],
      [S.UNDER_REVIEW, A.ASSIGN_REVIEWER, S.UNDER_REVIEW],
      [S.UNDER_REVIEW, A.APPROVE, S.APPROVED],
      [S.UNDER_REVIEW, A.REJECT, S.REJECTED],
      [S.UNDER_REVIEW, A.REQUEST_INFO, S.INFO_REQUESTED],
      [S.UNDER_REVIEW, A.RETRY_RISK_REVIEW, S.UNDER_REVIEW],
      [S.INFO_REQUESTED, A.UPDATE, S.INFO_REQUESTED],
      [S.INFO_REQUESTED, A.SUBMIT, S.UNDER_REVIEW],
      [S.INFO_REQUESTED, A.ASSIGN_REVIEWER, S.INFO_REQUESTED],
    ])('%s --%s--> %s', (from, action, to) => {
      expect(transition(from, action)).toBe(to);
    });
  });

  describe('invalid transitions', () => {
    it.each([
      [S.DRAFT, A.APPROVE],
      [S.DRAFT, A.ASSIGN_REVIEWER], // cannot review a draft
      [S.SUBMITTED, A.UPDATE], // locked once submitted
      [S.SUBMITTED, A.SUBMIT], // double submit
      [S.SUBMITTED, A.APPROVE], // must be assigned first
      [S.UNDER_REVIEW, A.UPDATE],
      [S.UNDER_REVIEW, A.SUBMIT],
      [S.INFO_REQUESTED, A.APPROVE],
    ])('%s --%s--> rejected', (from, action) => {
      expect(() => transition(from, action)).toThrow(InvalidStateTransitionError);
    });

    it.each(TERMINAL_STATUSES)('%s is terminal: no action is allowed', (status) => {
      for (const action of Object.values(ApplicationAction)) {
        expect(canTransition(status, action)).toBe(false);
      }
    });
  });

  it('only DRAFT and INFO_REQUESTED are editable', () => {
    const editable = Object.values(ApplicationStatus).filter(isEditable);
    expect(editable.sort()).toEqual([S.DRAFT, S.INFO_REQUESTED].sort());
  });

  describe('decision preconditions', () => {
    it('blocks approval until the risk review has completed', () => {
      for (const risk of [RiskStatus.NOT_STARTED, RiskStatus.PENDING, RiskStatus.FAILED]) {
        expect(() => assertDecisionPreconditions(ReviewDecision.APPROVE, risk)).toThrow(
          BusinessRuleViolationError,
        );
      }
      expect(() =>
        assertDecisionPreconditions(ReviewDecision.APPROVE, RiskStatus.COMPLETED),
      ).not.toThrow();
    });

    it('never blocks rejecting or requesting info', () => {
      for (const risk of Object.values(RiskStatus)) {
        expect(() => assertDecisionPreconditions(ReviewDecision.REJECT, risk)).not.toThrow();
        expect(() => assertDecisionPreconditions(ReviewDecision.REQUEST_INFO, risk)).not.toThrow();
      }
    });
  });

  it('allows a risk retry only after a failure', () => {
    expect(() => assertRiskRetryAllowed(RiskStatus.FAILED)).not.toThrow();
    for (const risk of [RiskStatus.NOT_STARTED, RiskStatus.PENDING, RiskStatus.COMPLETED]) {
      expect(() => assertRiskRetryAllowed(risk)).toThrow(BusinessRuleViolationError);
    }
  });
});
