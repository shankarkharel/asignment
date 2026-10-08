import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { RISK_REVIEW_QUEUE } from './risk-review.constants';
import { RiskReviewQueue } from './risk-review.queue';

/** Producer-only module: lets the API enqueue jobs without loading worker code. */
@Module({
  imports: [BullModule.registerQueue({ name: RISK_REVIEW_QUEUE })],
  providers: [RiskReviewQueue],
  exports: [RiskReviewQueue, BullModule],
})
export class RiskReviewQueueModule {}
