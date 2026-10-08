import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MerchantApplicationEntity } from '../applications/domain/merchant-application.entity';
import { AuditModule } from '../audit/audit.module';
import { RiskAssessmentEntity } from './domain/risk-assessment.entity';
import { RISK_PROVIDER } from './provider/risk-provider.interface';
import { SimulatedRiskProvider } from './provider/simulated-risk.provider';
import { RiskReviewProcessor } from './risk-review.processor';
import { RiskReviewReconciler } from './risk-review.reconciler';
import { RiskReviewService } from './risk-review.service';
import { RiskReviewQueueModule } from './risk-review-queue.module';

/** Consumer side: the BullMQ worker, the vendor client and the reconciler. */
@Module({
  imports: [
    TypeOrmModule.forFeature([MerchantApplicationEntity, RiskAssessmentEntity]),
    RiskReviewQueueModule,
    AuditModule,
  ],
  providers: [
    RiskReviewService,
    RiskReviewReconciler,
    RiskReviewProcessor,
    { provide: RISK_PROVIDER, useClass: SimulatedRiskProvider },
  ],
  exports: [RiskReviewService, RiskReviewReconciler],
})
export class RiskReviewWorkerModule {}
