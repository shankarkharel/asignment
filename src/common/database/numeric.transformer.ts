import type { ValueTransformer } from 'typeorm';

/** PostgreSQL returns NUMERIC as string to avoid precision loss; values here fit safely in a double. */
export const numericTransformer: ValueTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};
