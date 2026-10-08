import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppConfig } from '../../config/configuration';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';

@Module({
  imports: [
    UsersModule,
    AuditModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const auth = config.get('auth', { infer: true });
        return {
          secret: auth.jwtSecret,
          signOptions: {
            algorithm: 'HS256',
            expiresIn: auth.jwtExpiresInSeconds,
            issuer: auth.jwtIssuer,
            audience: auth.jwtAudience,
          },
          // Pin the algorithm on verify to rule out `alg: none` / algorithm-confusion tokens.
          verifyOptions: {
            algorithms: ['HS256'],
            issuer: auth.jwtIssuer,
            audience: auth.jwtAudience,
          },
        };
      },
    }),
    // Brute-force protection for the login endpoint only (applied via @UseGuards there).
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => [
        {
          ttl: config.get('auth.loginThrottleTtlMs', { infer: true }),
          limit: config.get('auth.loginThrottleLimit', { infer: true }),
        },
      ],
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    // Order matters: authenticate first, then authorise.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
