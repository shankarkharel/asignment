import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { RiskAssessmentEntity } from '../risk-review/domain/risk-assessment.entity';
import { RiskReviewQueueModule } from '../risk-review/risk-review-queue.module';
import { UsersModule } from '../users/users.module';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { MerchantApplicationEntity } from './domain/merchant-application.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([MerchantApplicationEntity, RiskAssessmentEntity]),
    UsersModule,
    AuditModule,
    RiskReviewQueueModule,
  ],
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
})
export class ApplicationsModule {}
