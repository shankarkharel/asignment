import { randomBytes } from 'node:crypto';
import { FieldEncryptor } from './field-encryption';

describe('FieldEncryptor (AES-256-GCM)', () => {
  const encryptor = new FieldEncryptor(randomBytes(32).toString('base64'));

  it('round-trips plaintext', () => {
    expect(encryptor.decrypt(encryptor.encrypt('TEST-000123'))).toBe('TEST-000123');
  });

  it('uses a fresh IV per encryption (no deterministic ciphertext)', () => {
    expect(encryptor.encrypt('same')).not.toBe(encryptor.encrypt('same'));
  });

  it('never contains the plaintext and is versioned', () => {
    const ciphertext = encryptor.encrypt('TEST-000123');
    expect(ciphertext.startsWith('v1:')).toBe(true);
    expect(ciphertext).not.toContain('TEST-000123');
  });

  it('detects tampering via the auth tag', () => {
    const [version, iv, tag, data] = encryptor.encrypt('TEST-000123').split(':');
    const flipped = Buffer.from(data, 'base64');
    flipped[0] ^= 0xff;
    expect(() =>
      encryptor.decrypt([version, iv, tag, flipped.toString('base64')].join(':')),
    ).toThrow();
  });

  it('cannot be decrypted with a different key', () => {
    const other = new FieldEncryptor(randomBytes(32).toString('base64'));
    expect(() => other.decrypt(encryptor.encrypt('TEST-000123'))).toThrow();
  });

  it('rejects keys that are not 32 bytes', () => {
    expect(() => new FieldEncryptor(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });
});
