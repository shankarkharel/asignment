import { ForbiddenActionError } from '../../../common/errors/domain.errors';
import type { AuthenticatedUser } from '../../../common/types/authenticated-user';
import { Role } from '../../users/domain/role.enum';
import { ApplicationStatus } from './application.enums';

interface OwnedApplication {
  createdById: string;
  assignedReviewerId: string | null;
  status: ApplicationStatus;
}

export interface VisibilityConstraint {
  /** SQL fragment against the `application` alias. */
  clause: string;
  params: Record<string, unknown>;
}

/**
 * Object-level authorization rules for merchant applications, in one place.
 *
 * Visibility is enforced *inside the SQL query* (not by filtering after fetch), so
 * an out-of-scope row is indistinguishable from a missing one: callers get 404 and
 * learn nothing about the existence of other users' applications.
 *
 *  - ADMIN    sees everything.
 *  - SALES    sees only applications they created.
 *  - REVIEWER sees everything past DRAFT (the review queue); drafts are private to sales.
 */
export const ApplicationAccessPolicy = {
  visibilityConstraint(user: AuthenticatedUser): VisibilityConstraint | null {
    switch (user.role) {
      case Role.ADMIN:
        return null;
      case Role.SALES:
        return {
          clause: 'application.createdById = :scopeUserId',
          params: { scopeUserId: user.id },
        };
      case Role.REVIEWER:
        return {
          clause: 'application.status <> :scopeDraft',
          params: { scopeDraft: ApplicationStatus.DRAFT },
        };
      default: {
        // Unknown roles see nothing (fail closed).
        const exhaustive: never = user.role;
        return { clause: '1 = 0', params: { exhaustive } };
      }
    }
  },

  canView(user: AuthenticatedUser, application: OwnedApplication): boolean {
    switch (user.role) {
      case Role.ADMIN:
        return true;
      case Role.SALES:
        return application.createdById === user.id;
      case Role.REVIEWER:
        return application.status !== ApplicationStatus.DRAFT;
      default:
        return false;
    }
  },

  /** Editing content and submitting: the creating SALES user, or an ADMIN. */
  assertCanManage(user: AuthenticatedUser, application: OwnedApplication): void {
    const allowed =
      user.role === Role.ADMIN || (user.role === Role.SALES && application.createdById === user.id);
    if (!allowed) {
      throw new ForbiddenActionError(
        'Only the creating sales user or an admin can modify this application',
      );
    }
  },

  /** Recording a review decision: strictly the assigned REVIEWER (not even ADMIN). */
  assertCanDecide(user: AuthenticatedUser, application: OwnedApplication): void {
    if (user.role !== Role.REVIEWER || application.assignedReviewerId !== user.id) {
      throw new ForbiddenActionError(
        'Only the assigned reviewer can record a decision on this application',
      );
    }
  },
} as const;
