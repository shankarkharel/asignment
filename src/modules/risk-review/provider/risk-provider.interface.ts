import { BusinessType, RiskLevel } from '../../applications/domain/application.enums';

export const RISK_PROVIDER = Symbol('RISK_PROVIDER');

/** The minimum data a KYB/risk vendor needs. Built from the application at call time. */
export interface RiskAssessmentRequest {
  /** Forwarded to the vendor so a retried call is not billed or processed twice. */
  idempotencyKey: string;
  legalBusinessName: string;
  businessType: BusinessType;
  taxId: string;
  countryCode: string;
  merchantCategoryCode: string;
  expectedMonthlyVolume: number;
  averageTransactionAmount: number;
}

export interface RiskAssessmentResult {
  provider: string;
  providerReference: string;
  score: number;
  level: RiskLevel;
  reasons: string[];
}

/** Network blip, timeout, 5xx, 429: worth retrying with backoff. */
export class RiskProviderTransientError extends Error {
  override readonly name = 'RiskProviderTransientError';
}

/** 4xx-style error (bad input, account disabled): retrying cannot help. */
export class RiskProviderPermanentError extends Error {
  override readonly name = 'RiskProviderPermanentError';
}

/**
 * Port for third-party risk/KYB vendors. The worker depends on this interface only,
 * so a real HTTP client (with timeouts and a circuit breaker) can replace the
 * simulator without touching orchestration code.
 */
export interface RiskProvider {
  assess(request: RiskAssessmentRequest): Promise<RiskAssessmentResult>;
}
