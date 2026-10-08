import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import { Role } from '../src/modules/users/domain/role.enum';
import { api, auth, createTestApp, TestContext, TestUser } from './support/test-app';

/** Generated per run so no password-like literal lives in the repository. */
const generatedPassword = () => `Gen1-${randomBytes(12).toString('hex')}`;

describe('Authentication & role guards (e2e)', () => {
  let ctx: TestContext;
  let sales: TestUser;
  let admin: TestUser;

  beforeAll(async () => {
    ctx = await createTestApp();
    [sales, admin] = await Promise.all([ctx.createUser(Role.SALES), ctx.createUser(Role.ADMIN)]);
  });
  afterAll(() => ctx.close());

  describe('POST /auth/login', () => {
    it('issues a bearer token for valid credentials', async () => {
      const res = await ctx
        .http()
        .post(api('/auth/login'))
        .send({ email: sales.email, password: sales.password })
        .expect(200);

      expect(res.body).toEqual({
        accessToken: expect.any(String),
        tokenType: 'Bearer',
        expiresIn: 900,
      });
    });

    it('returns an identical 401 for wrong password and unknown email (no user enumeration)', async () => {
      const wrongPassword = await ctx
        .http()
        .post(api('/auth/login'))
        .send({ email: sales.email, password: generatedPassword() })
        .expect(401);
      const unknownUser = await ctx
        .http()
        .post(api('/auth/login'))
        .send({ email: 'nobody@example.test', password: generatedPassword() })
        .expect(401);

      expect(wrongPassword.body.code).toBe('INVALID_CREDENTIALS');
      expect(unknownUser.body.message).toBe(wrongPassword.body.message);
    });

    it('rejects malformed payloads with a validation error', async () => {
      const res = await ctx
        .http()
        .post(api('/auth/login'))
        .send({ email: 'not-an-email' })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('records the login in the audit trail without the password or token', async () => {
      const rows: Array<{ metadata: unknown }> = await ctx.dataSource.query(
        `SELECT metadata FROM audit_logs WHERE actor_id = $1 AND action = 'USER_LOGGED_IN'`,
        [sales.id],
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(JSON.stringify(rows)).not.toContain(sales.password);
      expect(JSON.stringify(rows)).not.toContain(sales.token);
    });
  });

  describe('JWT guard (deny by default)', () => {
    it('rejects requests without a token', async () => {
      await ctx.http().get(api('/applications')).expect(401);
    });

    it('rejects a token with a forged signature', async () => {
      const [header, payload] = sales.token.split('.');
      await ctx
        .http()
        .get(api('/auth/me'))
        .set({ Authorization: `Bearer ${header}.${payload}.forged-signature` })
        .expect(401);
    });

    it('rejects an unsigned (alg=none) token claiming ADMIN', async () => {
      const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const unsigned = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: admin.id, role: 'ADMIN' })}.`;
      await ctx
        .http()
        .get(api('/users'))
        .set({ Authorization: `Bearer ${unsigned}` })
        .expect(401);
    });

    it('rejects an expired token', async () => {
      const expired = await ctx.app
        .get(JwtService)
        .signAsync({ sub: sales.id, role: sales.role }, { expiresIn: -10 });
      await ctx
        .http()
        .get(api('/auth/me'))
        .set({ Authorization: `Bearer ${expired}` })
        .expect(401);
    });

    it('takes the role from the database, not from token claims', async () => {
      // A validly signed token that *claims* ADMIN for a SALES user must not grant admin access.
      const escalated = await ctx.app
        .get(JwtService)
        .signAsync({ sub: sales.id, role: Role.ADMIN });
      await ctx
        .http()
        .get(api('/users'))
        .set({ Authorization: `Bearer ${escalated}` })
        .expect(403);
    });

    it('revokes access immediately when a user is deactivated', async () => {
      const victim = await ctx.createUser(Role.SALES);
      await ctx.http().get(api('/auth/me')).set(auth(victim)).expect(200);
      await ctx.dataSource.query(`UPDATE users SET is_active = false WHERE id = $1`, [victim.id]);
      await ctx.http().get(api('/auth/me')).set(auth(victim)).expect(401);
    });

    it('GET /auth/me returns the principal and never the password hash', async () => {
      const res = await ctx.http().get(api('/auth/me')).set(auth(sales)).expect(200);
      expect(res.body).toEqual({ id: sales.id, email: sales.email, role: Role.SALES });
    });

    it('leaves health endpoints public', async () => {
      await ctx.http().get(api('/health/live')).expect(200);
    });
  });

  describe('Role guard', () => {
    it('forbids non-admins from user management', async () => {
      await ctx.http().get(api('/users')).set(auth(sales)).expect(403);
      await ctx
        .http()
        .post(api('/users'))
        .set(auth(sales))
        .send({
          email: 'x@example.test',
          password: generatedPassword(),
          fullName: 'X',
          role: 'ADMIN',
        })
        .expect(403);
    });

    it('lets admins create users, never echoing the password hash', async () => {
      const res = await ctx
        .http()
        .post(api('/users'))
        .set(auth(admin))
        .send({
          email: 'New.Reviewer@Example.test',
          password: generatedPassword(),
          fullName: 'New Reviewer',
          role: 'REVIEWER',
        })
        .expect(201);
      expect(res.body.email).toBe('new.reviewer@example.test');
      expect(res.body).not.toHaveProperty('passwordHash');
    });

    it('forbids non-admins from reading the audit trail', async () => {
      await ctx.http().get(api('/audit-logs')).set(auth(sales)).expect(403);
      await ctx.http().get(api('/audit-logs')).set(auth(admin)).expect(200);
    });
  });
});
