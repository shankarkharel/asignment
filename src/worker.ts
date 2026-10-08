import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { RiskReviewReconciler } from './modules/risk-review/risk-review.reconciler';
import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  // SIGTERM -> module destroy hooks -> BullMQ worker finishes in-flight jobs and closes.
  app.enableShutdownHooks();
  await app.get(RiskReviewReconciler).schedule();
  app.get(Logger).log('Risk-review worker started');
}

void bootstrap();
