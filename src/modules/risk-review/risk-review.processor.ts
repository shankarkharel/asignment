import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { runWithRequestId } from '../../common/request-context/request-context';
import { AssessRiskJobData, RISK_REVIEW_QUEUE, RiskJobName } from './risk-review.constants';
import { RiskReviewReconciler } from './risk-review.reconciler';
import { RiskReviewService } from './risk-review.service';

/** Thin BullMQ adapter: translates jobs into service calls. All logic lives in the services. */
@Processor(RISK_REVIEW_QUEUE, { concurrency: 5 })
export class RiskReviewProcessor extends WorkerHost {
  private readonly logger = new Logger(RiskReviewProcessor.name);

  constructor(
    private readonly riskReviewService: RiskReviewService,
    private readonly reconciler: RiskReviewReconciler,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case RiskJobName.ASSESS: {
        const data = job.data as AssessRiskJobData;
        const idempotencyKey = job.id ?? `assess-${data.applicationId}-v${data.checkVersion}`;
        return runWithRequestId(data.correlationId ?? idempotencyKey, () =>
          this.riskReviewService.process(data, {
            attempt: job.attemptsMade + 1,
            maxAttempts: job.opts.attempts ?? 1,
            idempotencyKey,
          }),
        );
      }
      case RiskJobName.RECONCILE:
        return this.reconciler.reconcile();
      default:
        throw new UnrecoverableError(`Unknown job name: ${job.name}`);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.warn(
      { jobId: job?.id, jobName: job?.name, attemptsMade: job?.attemptsMade },
      `Job attempt failed: ${error.message}`,
    );
  }
}
