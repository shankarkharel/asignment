import { BusinessType, RiskLevel } from '../../applications/domain/application.enums';
import { levelForScore, scoreApplication } from './risk-scoring';

const base = {
  businessType: BusinessType.PUBLIC_LIMITED,
  merchantCategoryCode: '5814',
  expectedMonthlyVolume: 10_000,
  averageTransactionAmount: 20,
};

describe('scoreApplication', () => {
  it('scores a plain low-volume merchant as LOW with no reasons', () => {
    expect(scoreApplication(base)).toEqual({ score: 10, level: RiskLevel.LOW, reasons: [] });
  });

  it('flags high-risk MCCs, volume and ticket size', () => {
    const result = scoreApplication({
      businessType: BusinessType.SOLE_PROPRIETORSHIP,
      merchantCategoryCode: '7995',
      expectedMonthlyVolume: 2_000_000,
      averageTransactionAmount: 9_000,
    });
    expect(result.level).toBe(RiskLevel.HIGH);
    expect(result.score).toBe(100); // capped
    expect(result.reasons).toEqual([
      'BUSINESS_TYPE_SOLE_PROPRIETORSHIP',
      'HIGH_RISK_MCC',
      'VERY_HIGH_MONTHLY_VOLUME',
      'HIGH_AVERAGE_TICKET',
    ]);
  });

  it('is deterministic', () => {
    expect(scoreApplication(base)).toEqual(scoreApplication(base));
  });

  it.each([
    [0, RiskLevel.LOW],
    [29, RiskLevel.LOW],
    [30, RiskLevel.MEDIUM],
    [59, RiskLevel.MEDIUM],
    [60, RiskLevel.HIGH],
  ])('score %i -> %s', (score, level) => {
    expect(levelForScore(score)).toBe(level);
  });
});
