export const RISK_REVIEW_QUEUE = 'risk-review';

export const RiskJobName = {
  ASSESS: 'assess',
  RECONCILE: 'reconcile',
} as const;

export const RECONCILER_SCHEDULER_ID = 'risk-review-reconciler';

export interface AssessRiskJobData {
  applicationId: string;
  checkVersion: number;
  /** Request id of the HTTP call that triggered the check, for end-to-end log/audit correlation. */
  correlationId?: string;
}
