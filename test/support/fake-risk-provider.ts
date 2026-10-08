import {
  RiskAssessmentRequest,
  RiskAssessmentResult,
  RiskProvider,
  RiskProviderPermanentError,
  RiskProviderTransientError,
} from '../../src/modules/risk-review/provider/risk-provider.interface';
import { scoreApplication } from '../../src/modules/risk-review/provider/risk-scoring';

type Step = 'transient' | 'permanent' | 'hold';

/**
 * Scriptable stand-in for the KYB vendor. Each call consumes the next scripted step;
 * when the script is empty it succeeds with the deterministic score.
 */
export class FakeRiskProvider implements RiskProvider {
  readonly calls: RiskAssessmentRequest[] = [];
  private script: Step[] = [];
  private release?: () => void;

  failTransiently(times: number): this {
    this.script.push(...Array<Step>(times).fill('transient'));
    return this;
  }

  failPermanently(): this {
    this.script.push('permanent');
    return this;
  }

  /** The next call blocks until `releaseHeld()` - used to observe the PENDING window. */
  holdNext(): this {
    this.script.push('hold');
    return this;
  }

  releaseHeld(): void {
    this.release?.();
  }

  reset(): void {
    this.calls.length = 0;
    this.script = [];
    this.releaseHeld();
  }

  async assess(request: RiskAssessmentRequest): Promise<RiskAssessmentResult> {
    this.calls.push(request);
    const step = this.script.shift();
    if (step === 'transient') throw new RiskProviderTransientError('vendor timeout (fake)');
    if (step === 'permanent')
      throw new RiskProviderPermanentError('vendor rejected request (fake)');
    if (step === 'hold') await new Promise<void>((resolve) => (this.release = resolve));

    return {
      provider: 'fake-kyb',
      providerReference: `FAKE-${request.idempotencyKey}`,
      ...scoreApplication(request),
    };
  }
}
