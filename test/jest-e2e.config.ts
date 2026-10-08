import type { Config } from 'jest';

/**
 * Integration/API tests. Real PostgreSQL and Redis are started once via Testcontainers
 * (Docker required) - no mocks for the database, queue or HTTP stack.
 */
const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '..',
  testRegex: 'test/.*\\.e2e-spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  testEnvironment: 'node',
  globalSetup: '<rootDir>/test/setup/global-setup.ts',
  globalTeardown: '<rootDir>/test/setup/global-teardown.ts',
  testTimeout: 60_000,
};

export default config;
