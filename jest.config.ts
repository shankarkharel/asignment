import type { Config } from 'jest';

/** Unit tests: fast, no I/O. Co-located next to the code as *.spec.ts. */
const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  collectCoverageFrom: [
    '**/*.ts',
    '!**/*.module.ts',
    '!main.ts',
    '!worker.ts',
    '!database/migrations/**',
    '!database/seeds/**',
  ],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
};

export default config;
