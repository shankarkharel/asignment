/* eslint-disable no-console */
import 'reflect-metadata';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { configuration } from '../../config/configuration';
import { Role } from '../../modules/users/domain/role.enum';
import { UserEntity } from '../../modules/users/domain/user.entity';
import { buildDataSourceOptions } from '../data-source-options';

/**
 * Creates demo users for LOCAL DEVELOPMENT ONLY. The password is read from
 * SEED_USER_PASSWORD (generated per developer by `npm run env:init`) so no
 * credential is ever committed to the repository.
 */
const DEMO_USERS: ReadonlyArray<Pick<UserEntity, 'email' | 'fullName' | 'role'>> = [
  { email: 'admin@example.test', fullName: 'Demo Admin', role: Role.ADMIN },
  { email: 'reviewer.one@example.test', fullName: 'Demo Reviewer One', role: Role.REVIEWER },
  { email: 'reviewer.two@example.test', fullName: 'Demo Reviewer Two', role: Role.REVIEWER },
  { email: 'sales.one@example.test', fullName: 'Demo Sales One', role: Role.SALES },
  { email: 'sales.two@example.test', fullName: 'Demo Sales Two', role: Role.SALES },
];

async function seed(): Promise<void> {
  const config = configuration();
  if (config.app.env === 'production') throw new Error('Refusing to seed demo users in production');

  const password = process.env.SEED_USER_PASSWORD;
  if (!password || password.length < 12 || password === 'REPLACE_ME') {
    throw new Error('SEED_USER_PASSWORD must be set (>= 12 chars). Run `npm run env:init`.');
  }

  const dataSource = await new DataSource(buildDataSourceOptions(config.database)).initialize();
  try {
    const passwordHash = await bcrypt.hash(password, config.auth.bcryptRounds);
    await dataSource
      .getRepository(UserEntity)
      .createQueryBuilder()
      .insert()
      .values(DEMO_USERS.map((user) => ({ ...user, passwordHash })))
      .orIgnore() // idempotent: re-running the seed is a no-op
      .execute();
    console.log(`Seeded ${DEMO_USERS.length} demo users:`);
    DEMO_USERS.forEach((user) => console.log(`  ${user.role.padEnd(8)} ${user.email}`));
  } finally {
    await dataSource.destroy();
  }
}

seed().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
