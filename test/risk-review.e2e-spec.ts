import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { RISK_REVIEW_QUEUE } from '../src/modules/risk-review/risk-review.constants';
import { RiskReviewQueue } from '../src/modules/risk-review/risk-review.queue';
import { RiskReviewReconciler } from '../src/modules/risk-review/risk-review.reconciler';
import { RiskReviewService } from '../src/modules/risk-review/risk-review.service';
import { Role } from '../src/modules/users/domain/role.enum';
import {
  api,
  applicationPayload,
  auth,
  createTestApp,
  TestContext,
  TestUser,
  waitFor,
} from './support/test-app';

describe('Asynchronous risk review (e2e)', () => {
  let ctx: TestContext;
  let sales: TestUser;
  let admin: TestUser;

  const getApp = async (id: string) =>
    (
      await ctx
        .http()
        .get(api(`/applications/${id}`))
        .set(auth(admin))
        .expect(200)
    ).body;

  const waitForRisk = (id: string, status: string) =>
    waitFor(async () => {
      const app = await getApp(id);
      return app.riskStatus === status ? app : undefined;
    });

  const assessmentCount = async (id: string): Promise<number> =>
    Number(
      (
        await ctx.dataSource.query(
          `SELECT count(*) FROM risk_assessments WHERE application_id = $1`,
          [id],
        )
      )[0].count,
    );

  const createDraft = async (overrides = {}) =>
    (
      await ctx
        .http()
        .post(api('/applications'))
        .set(auth(sales))
        .send(applicationPayload(overrides))
        .expect(201)
    ).body.id as string;

  const submit = (id: string) =>
    ctx
      .http()
      .post(api(`/applications/${id}/submit`))
      .set(auth(sales))
      .expect(202);

  beforeAll(async () => {
    ctx = await createTestApp();
    [sales, admin] = await Promise.all([ctx.createUser(Role.SALES), ctx.createUser(Role.ADMIN)]);
  });
  afterEach(() => ctx.riskProvider.reset());
  afterAll(() => ctx.close());

  it('persists the vendor result and updates the application', async () => {
    const id = await createDraft({
      merchantCategoryCode: '7995',
      expectedMonthlyVolume: 2_000_000,
    });
    await submit(id);

    const app = await waitForRisk(id, 'COMPLETED');
    expect(app).toMatchObject({ riskLevel: 'HIGH', riskScore: 80 });

    const [assessment] = await ctx.dataSource.query(
      `SELECT * FROM risk_assessments WHERE application_id = $1`,
      [id],
    );
    expect(assessment).toMatchObject({
      check_version: 1,
      provider: 'fake-kyb',
      level: 'HIGH',
      attempt: 1,
      reasons: ['BUSINESS_TYPE_PRIVATE_LIMITED', 'HIGH_RISK_MCC', 'VERY_HIGH_MONTHLY_VOLUME'],
    });
    // The vendor received the decrypted tax id and a stable idempotency key.
    expect(ctx.riskProvider.calls[0]).toMatchObject({
      taxId: 'TEST-000123',
      idempotencyKey: RiskReviewQueue.jobId(id, 1),
    });
  });

  it('retries transient vendor failures with backoff, then succeeds', async () => {
    ctx.riskProvider.failTransiently(2); // attempts 1 and 2 fail, 3 succeeds
    const id = await createDraft();
    await submit(id);

    await waitForRisk(id, 'COMPLETED');
    expect(ctx.riskProvider.calls).toHaveLength(3);
    // Every retry reused the same idempotency key.
    expect(new Set(ctx.riskProvider.calls.map((c) => c.idempotencyKey)).size).toBe(1);
    const [assessment] = await ctx.dataSource.query(
      `SELECT attempt FROM risk_assessments WHERE application_id = $1`,
      [id],
    );
    expect(assessment.attempt).toBe(3);
  });

  it('marks the check FAILED once retries are exhausted, and an admin can retry it', async () => {
    ctx.riskProvider.failTransiently(3); // RISK_JOB_ATTEMPTS = 3 in tests
    const id = await createDraft();
    await submit(id);

    await waitForRisk(id, 'FAILED');
    expect(ctx.riskProvider.calls).toHaveLength(3);
    expect(await assessmentCount(id)).toBe(0);

    const [failure] = await ctx.dataSource.query(
      `SELECT metadata FROM audit_logs WHERE entity_id = $1 AND action = 'RISK_REVIEW_FAILED'`,
      [id],
    );
    expect(failure.metadata).toMatchObject({
      checkVersion: 1,
      reason: expect.stringMatching(/^RETRIES_EXHAUSTED/),
    });

    // Only admins may retry, and only from FAILED.
    await ctx
      .http()
      .post(api(`/applications/${id}/risk-review/retry`))
      .set(auth(sales))
      .expect(403);
    const retried = await ctx
      .http()
      .post(api(`/applications/${id}/risk-review/retry`))
      .set(auth(admin))
      .expect(202);
    expect(retried.body).toMatchObject({ riskStatus: 'PENDING', riskCheckVersion: 2 });

    const app = await waitForRisk(id, 'COMPLETED');
    expect(app.riskCheckVersion).toBe(2);
    await ctx
      .http()
      .post(api(`/applications/${id}/risk-review/retry`))
      .set(auth(admin))
      .expect(422);
  });

  it('does not retry permanent vendor errors', async () => {
    ctx.riskProvider.failPermanently();
    const id = await createDraft();
    await submit(id);

    await waitForRisk(id, 'FAILED');
    // Give a would-be retry time to happen, then confirm it did not.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(ctx.riskProvider.calls).toHaveLength(1);
  });

  describe('idempotency', () => {
    it('ignores duplicate enqueues of the same check (deterministic job id)', async () => {
      ctx.riskProvider.holdNext();
      const id = await createDraft();
      await submit(id);

      const queue = ctx.app.get<Queue>(getQueueToken(RISK_REVIEW_QUEUE));
      const producer = ctx.app.get(RiskReviewQueue);
      await producer.enqueueAssessment(id, 1);
      await producer.enqueueAssessment(id, 1);

      const jobs = await queue.getJobs(['waiting', 'active', 'delayed']);
      expect(jobs.filter((job) => job.id === RiskReviewQueue.jobId(id, 1))).toHaveLength(1);

      ctx.riskProvider.releaseHeld();
      await waitForRisk(id, 'COMPLETED');
      expect(await assessmentCount(id)).toBe(1);
    });

    it('records a check exactly once under concurrent and repeated delivery', async () => {
      const id = await createDraft();
      await submit(id);
      await waitForRisk(id, 'COMPLETED');
      ctx.riskProvider.reset();

      // Simulate the same job being redelivered (e.g. after a worker crash / stalled-job recovery).
      await ctx.dataSource.query(
        `UPDATE merchant_applications SET risk_status = 'PENDING', risk_check_version = 2 WHERE id = $1`,
        [id],
      );
      const service = ctx.app.get(RiskReviewService);
      const deliver = (attempt: number) =>
        service.process(
          { applicationId: id, checkVersion: 2 },
          { attempt, maxAttempts: 3, idempotencyKey: `dup-${id}` },
        );

      const outcomes = await Promise.all([deliver(1), deliver(1), deliver(1)]);
      const replay = await deliver(2);

      expect(outcomes.filter((o) => o.status === 'completed')).toHaveLength(1);
      expect(replay).toEqual({ status: 'skipped', reason: 'NOT_AWAITING_CHECK' });
      expect(await assessmentCount(id)).toBe(2); // v1 + v2, never a duplicate v2
    });

    it('discards results of superseded checks', async () => {
      const id = await createDraft();
      await submit(id);
      await waitForRisk(id, 'COMPLETED');
      ctx.riskProvider.reset();

      const outcome = await ctx.app
        .get(RiskReviewService)
        .process(
          { applicationId: id, checkVersion: 1 },
          { attempt: 1, maxAttempts: 3, idempotencyKey: 'stale' },
        );

      expect(outcome).toEqual({ status: 'skipped', reason: 'NOT_AWAITING_CHECK' });
      expect(ctx.riskProvider.calls).toHaveLength(0); // no wasted vendor call
    });
  });

  describe('reconciler', () => {
    it('re-enqueues a PENDING check whose job was lost (DB commit succeeded, enqueue did not)', async () => {
      const id = await createDraft();
      // Simulate the crash window: state committed as PENDING, but no job in Redis.
      await ctx.dataSource.query(
        `UPDATE merchant_applications
            SET status = 'SUBMITTED', risk_status = 'PENDING', risk_check_version = 1,
                submitted_at = now(), updated_at = now() - interval '1 hour'
          WHERE id = $1`,
        [id],
      );

      const result = await ctx.app.get(RiskReviewReconciler).reconcile();
      expect(result.requeued).toBeGreaterThanOrEqual(1);

      await waitForRisk(id, 'COMPLETED');
      expect(await assessmentCount(id)).toBe(1);
    });

    it('leaves fresh PENDING checks alone', async () => {
      ctx.riskProvider.holdNext();
      const id = await createDraft();
      await submit(id);

      const result = await ctx.app.get(RiskReviewReconciler).reconcile();
      const queue = ctx.app.get<Queue>(getQueueToken(RISK_REVIEW_QUEUE));
      const job = await queue.getJob(RiskReviewQueue.jobId(id, 1));

      expect(result.requeued).toBe(0);
      expect(await job?.getState()).toBe('active');
      ctx.riskProvider.releaseHeld();
      await waitForRisk(id, 'COMPLETED');
    });
  });
});
