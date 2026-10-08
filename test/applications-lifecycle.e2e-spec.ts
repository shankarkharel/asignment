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

describe('Merchant application lifecycle (e2e)', () => {
  let ctx: TestContext;
  let sales: TestUser;
  let admin: TestUser;
  let reviewer: TestUser;

  const get = async (id: string, user: TestUser = admin) =>
    (
      await ctx
        .http()
        .get(api(`/applications/${id}`))
        .set(auth(user))
        .expect(200)
    ).body;

  const waitForRisk = (id: string, status = 'COMPLETED') =>
    waitFor(async () => {
      const app = await get(id);
      return app.riskStatus === status ? app : undefined;
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    [sales, admin, reviewer] = await Promise.all([
      ctx.createUser(Role.SALES),
      ctx.createUser(Role.ADMIN),
      ctx.createUser(Role.REVIEWER),
    ]);
  });
  afterEach(() => ctx.riskProvider.reset());
  afterAll(() => ctx.close());

  it('runs the full happy path: create -> update -> submit -> risk -> assign -> request info -> resubmit -> approve', async () => {
    // Create (DRAFT)
    const created = await ctx
      .http()
      .post(api('/applications'))
      .set(auth(sales))
      .send(applicationPayload())
      .expect(201);
    const id: string = created.body.id;
    expect(created.body).toMatchObject({
      status: 'DRAFT',
      riskStatus: 'NOT_STARTED',
      createdById: sales.id,
      assignedReviewerId: null,
      taxIdMasked: '*******0123',
    });
    expect(created.body).not.toHaveProperty('taxId');

    // Update while editable
    const updated = await ctx
      .http()
      .patch(api(`/applications/${id}`))
      .set(auth(sales))
      .send({ businessName: 'Renamed Merchant', expectedMonthlyVolume: 60000 })
      .expect(200);
    expect(updated.body).toMatchObject({
      businessName: 'Renamed Merchant',
      expectedMonthlyVolume: 60000,
    });

    // Submit -> async risk review
    const submitted = await ctx
      .http()
      .post(api(`/applications/${id}/submit`))
      .set(auth(sales))
      .expect(202);
    expect(submitted.body).toMatchObject({
      status: 'SUBMITTED',
      riskStatus: 'PENDING',
      riskCheckVersion: 1,
    });
    const assessed = await waitForRisk(id);
    expect(assessed).toMatchObject({ riskLevel: 'LOW', riskScore: 15 });

    // No longer editable
    const locked = await ctx
      .http()
      .patch(api(`/applications/${id}`))
      .set(auth(sales))
      .send({ businessName: 'Too late' })
      .expect(409);
    expect(locked.body.code).toBe('INVALID_STATE_TRANSITION');

    // Assign -> UNDER_REVIEW
    const assigned = await ctx
      .http()
      .post(api(`/applications/${id}/assign`))
      .set(auth(admin))
      .send({ reviewerId: reviewer.id })
      .expect(200);
    expect(assigned.body).toMatchObject({
      status: 'UNDER_REVIEW',
      assignedReviewerId: reviewer.id,
    });

    // Request info -> editable again
    const infoRequested = await ctx
      .http()
      .post(api(`/applications/${id}/decision`))
      .set(auth(reviewer))
      .send({ decision: 'REQUEST_INFO', reason: 'Please provide the website URL' })
      .expect(200);
    expect(infoRequested.body).toMatchObject({ status: 'INFO_REQUESTED', decidedAt: null });

    await ctx
      .http()
      .patch(api(`/applications/${id}`))
      .set(auth(sales))
      .send({ websiteUrl: 'https://renamed.example.test' })
      .expect(200);

    // Resubmit -> straight back to the assigned reviewer, with a fresh risk check
    const resubmitted = await ctx
      .http()
      .post(api(`/applications/${id}/submit`))
      .set(auth(sales))
      .expect(202);
    expect(resubmitted.body).toMatchObject({
      status: 'UNDER_REVIEW',
      riskStatus: 'PENDING',
      riskCheckVersion: 2,
    });
    await waitForRisk(id);

    // Approve
    const approved = await ctx
      .http()
      .post(api(`/applications/${id}/decision`))
      .set(auth(reviewer))
      .send({ decision: 'APPROVE' })
      .expect(200);
    expect(approved.body).toMatchObject({ status: 'APPROVED', decidedAt: expect.any(String) });

    // Terminal: nothing else is possible
    await ctx
      .http()
      .post(api(`/applications/${id}/decision`))
      .set(auth(reviewer))
      .send({ decision: 'REJECT', reason: 'changed my mind' })
      .expect(409);
    await ctx
      .http()
      .post(api(`/applications/${id}/submit`))
      .set(auth(sales))
      .expect(409);

    // Two risk checks recorded, newest first
    const history = await ctx
      .http()
      .get(api(`/applications/${id}/risk-assessments`))
      .set(auth(sales))
      .expect(200);
    expect(history.body.map((a: { checkVersion: number }) => a.checkVersion)).toEqual([2, 1]);

    // Audit trail covers every significant action, in order
    const audit = await ctx
      .http()
      .get(api(`/audit-logs?entityId=${id}&limit=100`))
      .set(auth(admin))
      .expect(200);
    const actions = (audit.body.data as Array<{ action: string }>).map((l) => l.action).reverse();
    expect(actions).toEqual([
      'APPLICATION_CREATED',
      'APPLICATION_UPDATED',
      'APPLICATION_SUBMITTED',
      'RISK_REVIEW_COMPLETED',
      'REVIEWER_ASSIGNED',
      'REVIEW_DECISION_RECORDED',
      'APPLICATION_UPDATED',
      'APPLICATION_SUBMITTED',
      'RISK_REVIEW_COMPLETED',
      'REVIEW_DECISION_RECORDED',
    ]);
  });

  it('blocks approval while the risk review is still pending, but allows rejection', async () => {
    ctx.riskProvider.holdNext();
    const { body } = await ctx
      .http()
      .post(api('/applications'))
      .set(auth(sales))
      .send(applicationPayload())
      .expect(201);
    await ctx
      .http()
      .post(api(`/applications/${body.id}/submit`))
      .set(auth(sales))
      .expect(202);
    await ctx
      .http()
      .post(api(`/applications/${body.id}/assign`))
      .set(auth(admin))
      .send({ reviewerId: reviewer.id })
      .expect(200);

    const blocked = await ctx
      .http()
      .post(api(`/applications/${body.id}/decision`))
      .set(auth(reviewer))
      .send({ decision: 'APPROVE' })
      .expect(422);
    expect(blocked.body.code).toBe('BUSINESS_RULE_VIOLATION');

    await ctx
      .http()
      .post(api(`/applications/${body.id}/decision`))
      .set(auth(reviewer))
      .send({ decision: 'REJECT', reason: 'Incomplete documents' })
      .expect(200);

    // Once released, the late risk result is still recorded but the decision stands.
    ctx.riskProvider.releaseHeld();
    const final = await waitForRisk(body.id);
    expect(final.status).toBe('REJECTED');
  });

  it('rejects invalid transitions with 409', async () => {
    const { body } = await ctx
      .http()
      .post(api('/applications'))
      .set(auth(sales))
      .send(applicationPayload())
      .expect(201);

    // Cannot assign or decide on a draft
    await ctx
      .http()
      .post(api(`/applications/${body.id}/assign`))
      .set(auth(admin))
      .send({ reviewerId: reviewer.id })
      .expect(409);

    await ctx
      .http()
      .post(api(`/applications/${body.id}/submit`))
      .set(auth(sales))
      .expect(202);
    // Double submit
    const res = await ctx
      .http()
      .post(api(`/applications/${body.id}/submit`))
      .set(auth(sales))
      .expect(409);
    expect(res.body).toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
      details: { from: 'SUBMITTED' },
    });
  });

  it('requires a reason when rejecting or requesting info', async () => {
    const { body } = await ctx
      .http()
      .post(api('/applications'))
      .set(auth(sales))
      .send(applicationPayload())
      .expect(201);
    await ctx
      .http()
      .post(api(`/applications/${body.id}/submit`))
      .set(auth(sales))
      .expect(202);
    await ctx
      .http()
      .post(api(`/applications/${body.id}/assign`))
      .set(auth(admin))
      .send({ reviewerId: reviewer.id })
      .expect(200);

    for (const decision of ['REJECT', 'REQUEST_INFO']) {
      await ctx
        .http()
        .post(api(`/applications/${body.id}/decision`))
        .set(auth(reviewer))
        .send({ decision })
        .expect(400);
    }
  });

  it('validates the application payload', async () => {
    const res = await ctx
      .http()
      .post(api('/applications'))
      .set(auth(sales))
      .send(
        applicationPayload({
          countryCode: 'XX',
          currency: 'DOLLARS',
          ownerPhone: '12345',
          merchantCategoryCode: 'abc',
          expectedMonthlyVolume: -1,
          averageTransactionAmount: 1.234,
        }),
      )
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.details).toHaveLength(6);
  });

  describe('listing', () => {
    let lister: TestUser;

    beforeAll(async () => {
      lister = await ctx.createUser(Role.SALES);
      for (let i = 0; i < 5; i++) {
        const { body } = await ctx
          .http()
          .post(api('/applications'))
          .set(auth(lister))
          .send(applicationPayload({ businessName: `List ${i}` }))
          .expect(201);
        if (i < 2)
          await ctx
            .http()
            .post(api(`/applications/${body.id}/submit`))
            .set(auth(lister))
            .expect(202);
      }
    });

    it('paginates with stable, newest-first ordering', async () => {
      const page1 = await ctx
        .http()
        .get(api('/applications?page=1&limit=2'))
        .set(auth(lister))
        .expect(200);
      const page3 = await ctx
        .http()
        .get(api('/applications?page=3&limit=2'))
        .set(auth(lister))
        .expect(200);

      expect(page1.body.meta).toEqual({ page: 1, limit: 2, total: 5, totalPages: 3 });
      expect(page1.body.data.map((a: { businessName: string }) => a.businessName)).toEqual([
        'List 4',
        'List 3',
      ]);
      expect(page3.body.data.map((a: { businessName: string }) => a.businessName)).toEqual([
        'List 0',
      ]);
    });

    it('filters by status', async () => {
      const res = await ctx
        .http()
        .get(api('/applications?status=SUBMITTED'))
        .set(auth(lister))
        .expect(200);
      expect(res.body.meta.total).toBe(2);
      expect(res.body.data.every((a: { status: string }) => a.status === 'SUBMITTED')).toBe(true);
    });

    it('rejects out-of-range pagination and unknown filters', async () => {
      await ctx.http().get(api('/applications?limit=1000')).set(auth(lister)).expect(400);
      await ctx.http().get(api('/applications?status=NOPE')).set(auth(lister)).expect(400);
    });
  });

  describe('sensitive data', () => {
    it('stores the tax id encrypted and never writes it to the audit trail in clear text', async () => {
      const { body } = await ctx
        .http()
        .post(api('/applications'))
        .set(auth(sales))
        .send(applicationPayload({ taxId: 'TEST-SECRET-987' }))
        .expect(201);
      await ctx
        .http()
        .patch(api(`/applications/${body.id}`))
        .set(auth(sales))
        .send({ taxId: 'TEST-SECRET-654' })
        .expect(200);

      const [row] = await ctx.dataSource.query(
        `SELECT tax_id_encrypted FROM merchant_applications WHERE id = $1`,
        [body.id],
      );
      expect(row.tax_id_encrypted).toMatch(/^v1:/);
      expect(row.tax_id_encrypted).not.toContain('SECRET');

      const audit = await ctx.dataSource.query(
        `SELECT metadata FROM audit_logs WHERE entity_id = $1`,
        [body.id],
      );
      expect(JSON.stringify(audit)).not.toContain('SECRET');
      expect(
        audit
          .map((r: { metadata: { changedFields?: string[] } }) => r.metadata.changedFields)
          .filter(Boolean),
      ).toEqual([['taxId']]);
    });

    it('audit log rows are immutable at the database level', async () => {
      await expect(
        ctx.dataSource.query(`UPDATE audit_logs SET action = 'USER_LOGGED_IN'`),
      ).rejects.toThrow(/append-only/);
      await expect(ctx.dataSource.query(`DELETE FROM audit_logs`)).rejects.toThrow(/append-only/);
    });

    it('propagates the request id from the HTTP call into the audit trail of the async job', async () => {
      const { body } = await ctx
        .http()
        .post(api('/applications'))
        .set(auth(sales))
        .send(applicationPayload())
        .expect(201);
      await ctx
        .http()
        .post(api(`/applications/${body.id}/submit`))
        .set(auth(sales))
        .set('X-Request-Id', 'test-correlation-123')
        .expect(202)
        .expect('x-request-id', 'test-correlation-123');
      await waitForRisk(body.id);

      const rows: Array<{ action: string; request_id: string }> = await ctx.dataSource.query(
        `SELECT action, request_id FROM audit_logs WHERE entity_id = $1 AND action IN ('APPLICATION_SUBMITTED', 'RISK_REVIEW_COMPLETED')`,
        [body.id],
      );
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.request_id === 'test-correlation-123')).toBe(true);
    });
  });
});
