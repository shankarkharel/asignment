import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { RiskReviewQueueModule } from '../risk-review/risk-review-queue.module';
import { HealthController } from './health.controller';

@Module({
  imports: [TerminusModule, RiskReviewQueueModule],
  controllers: [HealthController],
})
export class HealthModule {}
