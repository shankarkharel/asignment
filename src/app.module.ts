import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { UsersModule } from './modules/users/users.module';

/** HTTP API process. */
@Module({
  imports: [
    InfrastructureModule,
    AuthModule,
    UsersModule,
    ApplicationsModule,
    AuditModule,
    HealthModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
