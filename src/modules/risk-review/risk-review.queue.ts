import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { currentRequestId } from '../../common/request-context/request-context';
import { AppConfig } from '../../config/configuration';
import { AssessRiskJobData, RISK_REVIEW_QUEUE, RiskJobName } from './risk-review.constants';

/** Producer side of the risk-review queue. Used by the API and by the reconciler. */
@Injectable()
export class RiskReviewQueue {
  constructor(
    @InjectQueue(RISK_REVIEW_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /**
   * Deterministic job id = idempotency key. BullMQ ignores an `add` whose id already
   * exists, so double-submits and reconciler re-enqueues never create duplicate work.
   */
  static jobId(applicationId: string, checkVersion: number): string {
    return `assess-${applicationId}-v${checkVersion}`;
  }

  async enqueueAssessment(applicationId: string, checkVersion: number): Promise<void> {
    const { jobAttempts, jobBackoffMs } = this.config.get('risk', { infer: true });
    const data: AssessRiskJobData = {
      applicationId,
      checkVersion,
      correlationId: currentRequestId(),
    };

    await this.queue.add(RiskJobName.ASSESS, data, {
      jobId: RiskReviewQueue.jobId(applicationId, checkVersion),
      attempts: jobAttempts,
      backoff: { type: 'exponential', delay: jobBackoffMs, jitter: 0.5 },
      // Keep history for debugging, but bound Redis memory.
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    });
  }

  getAssessmentJob(applicationId: string, checkVersion: number) {
    return this.queue.getJob(RiskReviewQueue.jobId(applicationId, checkVersion));
  }
}
