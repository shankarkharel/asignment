import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { AppConfig } from '../../../config/configuration';
import {
  RiskAssessmentRequest,
  RiskAssessmentResult,
  RiskProvider,
  RiskProviderTransientError,
} from './risk-provider.interface';
import { scoreApplication } from './risk-scoring';

/**
 * Simulates a third-party KYB/risk vendor: network latency, a configurable rate of
 * transient failures (to exercise retries), and a deterministic score.
 */
@Injectable()
export class SimulatedRiskProvider implements RiskProvider {
  private readonly logger = new Logger(SimulatedRiskProvider.name);

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  async assess(request: RiskAssessmentRequest): Promise<RiskAssessmentResult> {
    const { providerLatencyMs, providerTransientFailureRate } = this.config.get('risk', {
      infer: true,
    });

    await sleep(providerLatencyMs);

    if (Math.random() < providerTransientFailureRate) {
      this.logger.warn({ idempotencyKey: request.idempotencyKey }, 'Simulated provider timeout');
      throw new RiskProviderTransientError('Risk provider timed out (simulated)');
    }

    // A real vendor returns the same reference for a repeated idempotency key.
    const providerReference =
      'SIM-' + createHash('sha256').update(request.idempotencyKey).digest('hex').slice(0, 16);

    return { provider: 'simulated-kyb', providerReference, ...scoreApplication(request) };
  }
}
