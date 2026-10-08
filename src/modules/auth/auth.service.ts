import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { InvalidCredentialsError } from '../../common/errors/domain.errors';
import { AppConfig } from '../../config/configuration';
import { AuditAction } from '../audit/domain/audit-action.enum';
import { AuditService } from '../audit/audit.service';
import { UsersService } from '../users/users.service';
import { TokenResponseDto } from './dto/login.dto';
import { JwtPayload } from './jwt-payload';

@Injectable()
export class AuthService implements OnModuleInit {
  /**
   * Hash compared against when the email is unknown, so the response time does not
   * reveal whether an account exists (user-enumeration via timing).
   */
  private dummyHash: string;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly auditService: AuditService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    this.dummyHash = await bcrypt.hash(
      'timing-equaliser-not-a-real-password',
      this.config.get('auth.bcryptRounds', { infer: true }),
    );
  }

  async login(email: string, password: string): Promise<TokenResponseDto> {
    const user = await this.usersService.findActiveByEmailWithPassword(email);
    const passwordMatches = await bcrypt.compare(password, user?.passwordHash ?? this.dummyHash);

    if (!user || !passwordMatches) {
      // Deliberately identical error for "no such user" and "wrong password".
      throw new InvalidCredentialsError();
    }

    const payload: JwtPayload = { sub: user.id, role: user.role };
    const accessToken = await this.jwtService.signAsync(payload);
    await this.auditService.record({
      actorId: user.id,
      action: AuditAction.USER_LOGGED_IN,
      entityType: 'user',
      entityId: user.id,
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.config.get('auth.jwtExpiresInSeconds', { infer: true }),
    };
  }
}
