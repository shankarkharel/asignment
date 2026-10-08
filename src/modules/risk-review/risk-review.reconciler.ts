import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { LessThan, Repository } from 'typeorm';
import { AppConfig } from '../../config/configuration';
import { RiskStatus } from '../applications/domain/application.enums';
import { MerchantApplicationEntity } from '../applications/domain/merchant-application.entity';
import { RECONCILER_SCHEDULER_ID, RISK_REVIEW_QUEUE, RiskJobName } from './risk-review.constants';
import { RiskReviewQueue } from './risk-review.queue';
import { RiskReviewService } from './risk-review.service';

export interface ReconcileResult {
  scanned: number;
  requeued: number;
  markedFailed: number;
}

const BATCH_SIZE = 100;

/**
 * Safety net for the dual-write between PostgreSQL and Redis.
 *
 * Submitting commits the application as `riskStatus = PENDING` *then* enqueues the job.
 * If the process dies (or Redis is down) between those steps, the job is lost. The
 * application row is the source of truth, so this periodic sweep finds checks that have
 * been PENDING for too long and repairs them. Because job ids are deterministic,
 * re-enqueueing is idempotent. (A transactional outbox is the heavier alternative - see ADR-003.)
 */
@Injectable()
export class RiskReviewReconciler {
  private readonly logger = new Logger(RiskReviewReconciler.name);

  constructor(
    @InjectRepository(MerchantApplicationEntity)
    private readonly applications: Repository<MerchantApplicationEntity>,
    @InjectQueue(RISK_REVIEW_QUEUE) private readonly queue: Queue,
    private readonly riskReviewQueue: RiskReviewQueue,
    private readonly riskReviewService: RiskReviewService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /** Registers the repeatable sweep. A job scheduler guarantees one sweep per interval across all workers. */
  async schedule(): Promise<void> {
    await this.queue.upsertJobScheduler(
      RECONCILER_SCHEDULER_ID,
      { every: this.config.get('risk.reconcileIntervalMs', { infer: true }) },
      { name: RiskJobName.RECONCILE, opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
  }

  async reconcile(): Promise<ReconcileResult> {
    const staleBefore = new Date(
      Date.now() - this.config.get('risk.reconcileStaleAfterMs', { infer: true }),
    );
    const stale = await this.applications.find({
      select: { id: true, riskCheckVersion: true },
      where: { riskStatus: RiskStatus.PENDING, updatedAt: LessThan(staleBefore) },
      order: { updatedAt: 'ASC' },
      take: BATCH_SIZE,
    });

    const result: ReconcileResult = { scanned: stale.length, requeued: 0, markedFailed: 0 };

    for (const { id, riskCheckVersion } of stale) {
      const job = await this.riskReviewQueue.getAssessmentJob(id, riskCheckVersion);
      const state = job ? await job.getState() : 'missing';

      if (state === 'failed') {
        // Retries were exhausted but the FAILED status was never persisted (e.g. crash).
        const marked = await this.riskReviewService.markFailed(
          { applicationId: id, checkVersion: riskCheckVersion },
          'RECONCILER: job failed without status update',
        );
        if (marked) result.markedFailed++;
      } else if (state === 'missing' || state === 'completed' || state === 'unknown') {
        // Job lost, or finished without effect: drop the stale entry and enqueue afresh.
        if (job && state === 'completed') await job.remove();
        await this.riskReviewQueue.enqueueAssessment(id, riskCheckVersion);
        result.requeued++;
      }
      // waiting / delayed / active / prioritized: the job is still in flight - leave it alone.
    }

    if (result.requeued || result.markedFailed) {
      this.logger.warn(result, 'Reconciler repaired stuck risk reviews');
    }
    return result;
  }
}
