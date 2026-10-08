import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { API_PREFIX, configureApp } from '../../src/app.setup';
import { RISK_PROVIDER } from '../../src/modules/risk-review/provider/risk-provider.interface';
import { RiskReviewWorkerModule } from '../../src/modules/risk-review/risk-review-worker.module';
import { Role } from '../../src/modules/users/domain/role.enum';
import { UsersService } from '../../src/modules/users/users.service';
import { FakeRiskProvider } from './fake-risk-provider';

export interface TestUser {
  id: string;
  email: string;
  password: string;
  role: Role;
  token: string;
}

export interface TestContext {
  app: INestApplication;
  http: () => TestAgent;
  dataSource: DataSource;
  riskProvider: FakeRiskProvider;
  createUser: (role: Role) => Promise<TestUser>;
  close: () => Promise<void>;
}

export const api = (path: string): string => `/${API_PREFIX}${path}`;

/**
 * Boots the real HTTP pipeline *and* the real BullMQ worker in one process, with only the
 * third-party risk vendor replaced. Everything else (guards, pipes, filter, DB, Redis) is production code.
 */
export async function createTestApp(): Promise<TestContext> {
  const riskProvider = new FakeRiskProvider();
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, RiskReviewWorkerModule],
  })
    .overrideProvider(RISK_PROVIDER)
    .useValue(riskProvider)
    .compile();

  const app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app);
  await app.init();

  const http = () => request(app.getHttpServer());
  const usersService = app.get(UsersService);

  const createUser = async (role: Role): Promise<TestUser> => {
    const email = `${role.toLowerCase()}-${randomUUID()}@example.test`;
    const password = `Pw1-${randomBytes(12).toString('hex')}`;
    const user = await usersService.create({ email, password, fullName: `Test ${role}`, role });
    const res = await http().post(api('/auth/login')).send({ email, password }).expect(200);
    return { id: user.id, email, password, role, token: res.body.accessToken as string };
  };

  return {
    app,
    http,
    dataSource: app.get(DataSource),
    riskProvider,
    createUser,
    close: () => app.close(),
  };
}

export const auth = (user: Pick<TestUser, 'token'>) => ({ Authorization: `Bearer ${user.token}` });

/** Valid, obviously-fake application payload. No real personal or business data. */
export const applicationPayload = (overrides: Record<string, unknown> = {}) => ({
  businessName: 'Test Merchant',
  legalBusinessName: 'Test Merchant Pvt. Ltd.',
  businessType: 'PRIVATE_LIMITED',
  taxId: 'TEST-000123',
  countryCode: 'NP',
  websiteUrl: 'https://merchant.example.test',
  ownerFullName: 'Test Owner',
  ownerEmail: 'owner@example.test',
  ownerPhone: '+9779800000000',
  merchantCategoryCode: '5814',
  expectedMonthlyVolume: 50000,
  averageTransactionAmount: 25.5,
  currency: 'NPR',
  ...overrides,
});

/** Polls until `check` returns a truthy value (async processing is eventually consistent). */
export async function waitFor<T>(
  check: () => Promise<T | undefined | null | false>,
  { timeoutMs = 10_000, intervalMs = 50 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
