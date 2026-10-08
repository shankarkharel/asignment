import { Module } from '@nestjs/common';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { RiskReviewWorkerModule } from './modules/risk-review/risk-review-worker.module';

/** Background worker process: consumes the risk-review queue. No HTTP server. */
@Module({
  imports: [InfrastructureModule, RiskReviewWorkerModule],
})
export class WorkerModule {}
