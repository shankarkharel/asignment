import { SetMetadata } from '@nestjs/common';
import { Role } from '../../modules/users/domain/role.enum';

export const ROLES_KEY = 'roles';

/** Coarse-grained role check. Object-level rules are enforced in the domain policy layer. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
