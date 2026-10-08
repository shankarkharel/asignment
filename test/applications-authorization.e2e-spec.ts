import { randomUUID } from 'node:crypto';
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

/**
 * Explicitly attempts every known way to read or change someone else's application.
 * Cross-tenant access must return 404 (indistinguishable from "does not exist").
 */
describe('Object-level authorization (e2e)', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let otherSales: TestUser;
  let admin: TestUser;
  let assignedReviewer: TestUser;
  let otherReviewer: TestUser;
  let draftId: string;
  let underReviewId: string;

  const create = async (user: TestUser, overrides = {}) =>
    (
      await ctx
        .http()
        .post(api('/applications'))
        .set(auth(user))
        .send(applicationPayload(overrides))
        .expect(201)
    ).body.id as string;

  beforeAll(async () => {
    ctx = await createTestApp();
    [owner, otherSales, admin, assignedReviewer, otherReviewer] = await Promise.all([
      ctx.createUser(Role.SALES),
      ctx.createUser(Role.SALES),
      ctx.createUser(Role.ADMIN),
      ctx.createUser(Role.REVIEWER),
      ctx.createUser(Role.REVIEWER),
    ]);

    draftId = await create(owner, { businessName: 'Owner Draft' });

    underReviewId = await create(owner, { businessName: 'Owner Under Review' });
    await ctx
      .http()
      .post(api(`/applications/${underReviewId}/submit`))
      .set(auth(owner))
      .expect(202);
    await ctx
      .http()
      .post(api(`/applications/${underReviewId}/assign`))
      .set(auth(admin))
      .send({ reviewerId: assignedReviewer.id })
      .expect(200);
    await waitFor(async () => {
      const res = await ctx
        .http()
        .get(api(`/applications/${underReviewId}`))
        .set(auth(admin));
      return res.body.riskStatus === 'COMPLETED';
    });
  });
  afterAll(() => ctx.close());

  describe("SALES user cannot access another SALES user's application", () => {
    it('cannot read it by id (404, not 403)', async () => {
      const res = await ctx
        .http()
        .get(api(`/applications/${draftId}`))
        .set(auth(otherSales))
        .expect(404);
      expect(res.body.code).toBe('RESOURCE_NOT_FOUND');
      expect(JSON.stringify(res.body)).not.toContain('Owner Draft');
    });

    it('cannot update it', async () => {
      await ctx
        .http()
        .patch(api(`/applications/${draftId}`))
        .set(auth(otherSales))
        .send({ businessName: 'Hijacked' })
        .expect(404);

      const fresh = await ctx
        .http()
        .get(api(`/applications/${draftId}`))
        .set(auth(owner))
        .expect(200);
      expect(fresh.body.businessName).toBe('Owner Draft');
    });

    it('cannot submit it', async () => {
      await ctx
        .http()
        .post(api(`/applications/${draftId}/submit`))
        .set(auth(otherSales))
        .expect(404);
      const fresh = await ctx
        .http()
        .get(api(`/applications/${draftId}`))
        .set(auth(owner))
        .expect(200);
      expect(fresh.body.status).toBe('DRAFT');
    });

    it('cannot read its risk assessments', async () => {
      await ctx
        .http()
        .get(api(`/applications/${underReviewId}/risk-assessments`))
        .set(auth(otherSales))
        .expect(404);
    });

    it('does not see it in list results, even when filtering', async () => {
      await create(otherSales, { businessName: 'Other Sales Own' });
      const res = await ctx
        .http()
        .get(api('/applications?status=DRAFT,UNDER_REVIEW&limit=100'))
        .set(auth(otherSales))
        .expect(200);

      const ids = (res.body.data as Array<{ id: string; createdById: string }>).map((a) => a.id);
      expect(ids).not.toContain(draftId);
      expect(ids).not.toContain(underReviewId);
      expect(
        res.body.data.every((a: { createdById: string }) => a.createdById === otherSales.id),
      ).toBe(true);
    });

    it('the owner can still read and edit their own application', async () => {
      await ctx
        .http()
        .get(api(`/applications/${draftId}`))
        .set(auth(owner))
        .expect(200);
      await ctx
        .http()
        .patch(api(`/applications/${draftId}`))
        .set(auth(owner))
        .send({ businessName: 'Owner Draft' })
        .expect(200);
    });
  });

  describe('SALES role limits', () => {
    it('cannot assign reviewers', async () => {
      await ctx
        .http()
        .post(api(`/applications/${underReviewId}/assign`))
        .set(auth(owner))
        .send({ reviewerId: otherReviewer.id })
        .expect(403);
    });

    it('cannot approve, even their own application', async () => {
      await ctx
        .http()
        .post(api(`/applications/${underReviewId}/decision`))
        .set(auth(owner))
        .send({ decision: 'APPROVE' })
        .expect(403);
    });

    it('cannot set workflow fields through the update body (mass assignment)', async () => {
      const res = await ctx
        .http()
        .patch(api(`/applications/${draftId}`))
        .set(auth(owner))
        .send({ status: 'APPROVED', riskStatus: 'COMPLETED', createdById: otherSales.id })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('REVIEWER rules', () => {
    it('cannot see drafts', async () => {
      await ctx
        .http()
        .get(api(`/applications/${draftId}`))
        .set(auth(assignedReviewer))
        .expect(404);
    });

    it('cannot create or edit applications', async () => {
      await ctx
        .http()
        .post(api('/applications'))
        .set(auth(assignedReviewer))
        .send(applicationPayload())
        .expect(403);
      await ctx
        .http()
        .patch(api(`/applications/${underReviewId}`))
        .set(auth(assignedReviewer))
        .send({ businessName: 'x' })
        .expect(403);
    });

    it('a reviewer who is not assigned cannot record a decision', async () => {
      const res = await ctx
        .http()
        .post(api(`/applications/${underReviewId}/decision`))
        .set(auth(otherReviewer))
        .send({ decision: 'APPROVE' })
        .expect(403);
      expect(res.body.code).toBe('FORBIDDEN_ACTION');
    });

    it('an ADMIN cannot record a decision either (only the assigned reviewer)', async () => {
      await ctx
        .http()
        .post(api(`/applications/${underReviewId}/decision`))
        .set(auth(admin))
        .send({ decision: 'APPROVE' })
        .expect(403);
    });

    it('the assigned reviewer can record the decision', async () => {
      const res = await ctx
        .http()
        .post(api(`/applications/${underReviewId}/decision`))
        .set(auth(assignedReviewer))
        .send({ decision: 'REJECT', reason: 'Test rejection' })
        .expect(200);
      expect(res.body.status).toBe('REJECTED');
    });
  });

  describe('Input hardening', () => {
    it('rejects non-UUID ids before touching the database', async () => {
      await ctx.http().get(api('/applications/1%20OR%201=1')).set(auth(admin)).expect(400);
    });

    it('returns 404 for a random id', async () => {
      await ctx
        .http()
        .get(api(`/applications/${randomUUID()}`))
        .set(auth(admin))
        .expect(404);
    });

    it('cannot assign a non-reviewer as reviewer', async () => {
      const id = await create(owner);
      await ctx
        .http()
        .post(api(`/applications/${id}/submit`))
        .set(auth(owner))
        .expect(202);
      const res = await ctx
        .http()
        .post(api(`/applications/${id}/assign`))
        .set(auth(admin))
        .send({ reviewerId: otherSales.id })
        .expect(422);
      expect(res.body.code).toBe('BUSINESS_RULE_VIOLATION');
    });
  });
});
