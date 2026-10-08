import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { requestContextMiddleware } from './common/request-context/request-context';
import { AppConfig } from './config/configuration';

export const API_PREFIX = 'api/v1';

/** HTTP pipeline configuration, shared by `main.ts` and the e2e tests so they run the same stack. */
export function configureApp(app: INestApplication): void {
  const config = app.get<ConfigService<AppConfig, true>>(ConfigService);

  app.useLogger(app.get(Logger));
  app.use(requestContextMiddleware);
  app.use(helmet());
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown properties...
      forbidNonWhitelisted: true, // ...and reject requests that send them (no mass assignment)
      transform: true,
    }),
  );

  if (config.get('app.env', { infer: true }) !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Merchant Onboarding API')
        .setDescription(
          'Merchant application lifecycle with asynchronous risk review, RBAC and object-level authorization.',
        )
        .setVersion('1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('docs', app, document);
  }
}
