import { Role } from '../users/domain/role.enum';

export interface JwtPayload {
  sub: string;
  role: Role;
}
