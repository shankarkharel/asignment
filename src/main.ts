import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { AppConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApp(app);
  app.enableShutdownHooks();

  const port = app
    .get<ConfigService<AppConfig, true>>(ConfigService)
    .get('app.port', { infer: true });
  await app.listen(port);
}

void bootstrap();
