import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Request } from 'express';
import { LoggerModule } from 'nestjs-pino';
import { PINO_REDACT_PATHS } from '../common/logging/redact';
import { resolveRequestId } from '../common/request-context/request-context';
import { AppConfig, configuration } from '../config/configuration';
import { envValidationSchema } from '../config/env.validation';
import { buildDataSourceOptions } from '../database/data-source-options';

/** Cross-cutting infrastructure shared by the API and the worker processes. */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const app = config.get('app', { infer: true });
        return {
          pinoHttp: {
            level: app.logLevel,
            genReqId: (req) => resolveRequestId(req as Request),
            redact: { paths: PINO_REDACT_PATHS, censor: '[REDACTED]' },
            autoLogging: { ignore: (req) => req.url?.includes('/health') ?? false },
            serializers: {
              req: (req: { id: string; method: string; url: string }) => ({
                id: req.id,
                method: req.method,
                url: req.url,
              }),
            },
            transport: app.logPretty
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
          },
        };
      },
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) =>
        buildDataSourceOptions(config.get('database', { infer: true })),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        connection: {
          host: config.get('redis.host', { infer: true }),
          port: config.get('redis.port', { infer: true }),
          // Required by BullMQ workers: blocking commands must not time out.
          maxRetriesPerRequest: null,
        },
      }),
    }),
  ],
})
export class InfrastructureModule {}
