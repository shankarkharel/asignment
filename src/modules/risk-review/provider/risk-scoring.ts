import { BusinessType, RiskLevel } from '../../applications/domain/application.enums';

/** MCCs commonly treated as high-risk by acquirers (gambling, crypto, telemarketing, ...). */
export const HIGH_RISK_MCCS: ReadonlySet<string> = new Set([
  '4829', // money transfer
  '5967', // direct marketing - inbound telemarketing
  '6051', // quasi-cash / crypto
  '7273', // dating services
  '7995', // gambling
]);

const BUSINESS_TYPE_WEIGHT: Readonly<Record<BusinessType, number>> = {
  [BusinessType.SOLE_PROPRIETORSHIP]: 15,
  [BusinessType.PARTNERSHIP]: 10,
  [BusinessType.PRIVATE_LIMITED]: 5,
  [BusinessType.PUBLIC_LIMITED]: 0,
  [BusinessType.NON_PROFIT]: 5,
};

export interface ScoringInput {
  businessType: BusinessType;
  merchantCategoryCode: string;
  expectedMonthlyVolume: number;
  averageTransactionAmount: number;
}

export interface ScoringOutput {
  score: number;
  level: RiskLevel;
  reasons: string[];
}

export const levelForScore = (score: number): RiskLevel =>
  score >= 60 ? RiskLevel.HIGH : score >= 30 ? RiskLevel.MEDIUM : RiskLevel.LOW;

/** Deterministic rules standing in for a vendor's model, so results are reproducible in tests. */
export function scoreApplication(input: ScoringInput): ScoringOutput {
  const reasons: string[] = [];
  let score = 10;

  const typeWeight = BUSINESS_TYPE_WEIGHT[input.businessType];
  if (typeWeight > 0) {
    score += typeWeight;
    reasons.push(`BUSINESS_TYPE_${input.businessType}`);
  }
  if (HIGH_RISK_MCCS.has(input.merchantCategoryCode)) {
    score += 40;
    reasons.push('HIGH_RISK_MCC');
  }
  if (input.expectedMonthlyVolume > 1_000_000) {
    score += 25;
    reasons.push('VERY_HIGH_MONTHLY_VOLUME');
  } else if (input.expectedMonthlyVolume > 250_000) {
    score += 10;
    reasons.push('HIGH_MONTHLY_VOLUME');
  }
  if (input.averageTransactionAmount > 5_000) {
    score += 10;
    reasons.push('HIGH_AVERAGE_TICKET');
  }

  const bounded = Math.min(score, 100);
  return { score: bounded, level: levelForScore(bounded), reasons };
}
