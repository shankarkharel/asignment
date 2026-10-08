import { Role } from '../../modules/users/domain/role.enum';

/** The principal attached to `request.user` by the JWT guard. Loaded fresh from the DB per request. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
}
