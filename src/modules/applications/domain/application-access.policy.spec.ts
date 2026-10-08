import { ForbiddenActionError } from '../../../common/errors/domain.errors';
import type { AuthenticatedUser } from '../../../common/types/authenticated-user';
import { Role } from '../../users/domain/role.enum';
import { ApplicationAccessPolicy } from './application-access.policy';
import { ApplicationStatus } from './application.enums';

const user = (role: Role, id = `${role.toLowerCase()}-1`): AuthenticatedUser => ({
  id,
  email: `${id}@example.test`,
  role,
});

const admin = user(Role.ADMIN);
const sales = user(Role.SALES, 'sales-1');
const otherSales = user(Role.SALES, 'sales-2');
const reviewer = user(Role.REVIEWER, 'reviewer-1');
const otherReviewer = user(Role.REVIEWER, 'reviewer-2');

const application = (
  overrides: Partial<{ status: ApplicationStatus; assignedReviewerId: string | null }> = {},
) => ({
  createdById: sales.id,
  assignedReviewerId: reviewer.id,
  status: ApplicationStatus.UNDER_REVIEW,
  ...overrides,
});

describe('ApplicationAccessPolicy', () => {
  describe('visibility', () => {
    it('admin sees everything (no SQL constraint)', () => {
      expect(ApplicationAccessPolicy.visibilityConstraint(admin)).toBeNull();
      expect(
        ApplicationAccessPolicy.canView(admin, application({ status: ApplicationStatus.DRAFT })),
      ).toBe(true);
    });

    it('sales is scoped to applications they created', () => {
      expect(ApplicationAccessPolicy.visibilityConstraint(sales)).toEqual({
        clause: 'application.createdById = :scopeUserId',
        params: { scopeUserId: sales.id },
      });
      expect(ApplicationAccessPolicy.canView(sales, application())).toBe(true);
      expect(ApplicationAccessPolicy.canView(otherSales, application())).toBe(false);
    });

    it('reviewers see the review queue but not drafts', () => {
      expect(ApplicationAccessPolicy.visibilityConstraint(reviewer)?.params).toEqual({
        scopeDraft: ApplicationStatus.DRAFT,
      });
      expect(ApplicationAccessPolicy.canView(otherReviewer, application())).toBe(true);
      expect(
        ApplicationAccessPolicy.canView(reviewer, application({ status: ApplicationStatus.DRAFT })),
      ).toBe(false);
    });

    it('fails closed for unknown roles', () => {
      const ghost = { ...admin, role: 'GHOST' as Role };
      expect(ApplicationAccessPolicy.visibilityConstraint(ghost)?.clause).toBe('1 = 0');
      expect(ApplicationAccessPolicy.canView(ghost, application())).toBe(false);
    });
  });

  describe('assertCanManage', () => {
    it('allows the creating sales user and admins', () => {
      expect(() => ApplicationAccessPolicy.assertCanManage(sales, application())).not.toThrow();
      expect(() => ApplicationAccessPolicy.assertCanManage(admin, application())).not.toThrow();
    });

    it.each([
      ['another sales user', otherSales],
      ['a reviewer', reviewer],
    ])('rejects %s', (_label, actor) => {
      expect(() => ApplicationAccessPolicy.assertCanManage(actor, application())).toThrow(
        ForbiddenActionError,
      );
    });
  });

  describe('assertCanDecide', () => {
    it('allows only the assigned reviewer', () => {
      expect(() => ApplicationAccessPolicy.assertCanDecide(reviewer, application())).not.toThrow();
    });

    it.each([
      ['a different reviewer', otherReviewer],
      ['an admin', admin],
      ['the creating sales user', sales],
    ])('rejects %s', (_label, actor) => {
      expect(() => ApplicationAccessPolicy.assertCanDecide(actor, application())).toThrow(
        ForbiddenActionError,
      );
    });

    it('rejects everyone when no reviewer is assigned', () => {
      expect(() =>
        ApplicationAccessPolicy.assertCanDecide(
          reviewer,
          application({ assignedReviewerId: null }),
        ),
      ).toThrow(ForbiddenActionError);
    });
  });
});
