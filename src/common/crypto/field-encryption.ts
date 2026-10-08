import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { ValueTransformer } from 'typeorm';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce, recommended for GCM
const AUTH_TAG_LENGTH = 16;
const VERSION = 'v1';

/**
 * Authenticated field-level encryption (AES-256-GCM).
 *
 * Ciphertext format: `v1:<iv b64>:<authTag b64>:<ciphertext b64>`.
 * The version prefix allows key/algorithm rotation without a big-bang migration.
 * In production the key would come from a KMS (envelope encryption) rather than env.
 */
export class FieldEncryptor {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32) {
      throw new Error('Field encryption key must be 32 bytes (base64-encoded)');
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv, { authTagLength: AUTH_TAG_LENGTH });
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      VERSION,
      iv.toString('base64'),
      tag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  decrypt(payload: string): string {
    const [version, iv, tag, ciphertext] = payload.split(':');
    if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
      throw new Error('Unsupported encrypted payload format');
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(iv, 'base64'), {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}

/**
 * TypeORM column transformer. Entities are declared at import time, before Nest DI exists,
 * so the encryptor is resolved lazily from the environment on first use.
 */
let encryptor: FieldEncryptor | undefined;
const getEncryptor = (): FieldEncryptor => {
  encryptor ??= new FieldEncryptor(process.env.FIELD_ENCRYPTION_KEY ?? '');
  return encryptor;
};

export const encryptedColumnTransformer: ValueTransformer = {
  to: (value: string | null | undefined) =>
    value === null || value === undefined ? value : getEncryptor().encrypt(value),
  from: (value: string | null) => (value === null ? null : getEncryptor().decrypt(value)),
};
