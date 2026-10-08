import { maskEmail, maskValue, redact, REDACTED } from './redact';

describe('redact', () => {
  it('removes secrets regardless of key casing or separators', () => {
    const output = redact({
      password: 'placeholder-value',
      access_token: 'eyJ...',
      Authorization: 'Bearer abc',
      clientSecret: 's3cr3t',
      safe: 'kept',
    });
    expect(output).toEqual({
      password: REDACTED,
      access_token: REDACTED,
      Authorization: REDACTED,
      clientSecret: REDACTED,
      safe: 'kept',
    });
  });

  it('masks PII but keeps it recognisable', () => {
    expect(
      redact({ taxId: 'TEST-000123', ownerEmail: 'jane@acme.test', ownerPhone: '+9779800000000' }),
    ).toEqual({
      taxId: '*******0123',
      ownerEmail: 'j***@acme.test',
      ownerPhone: '**********0000',
    });
  });

  it('recurses into nested objects and arrays without mutating the input', () => {
    const input = { nested: { items: [{ password: 'x' }, { ok: 1 }] }, when: new Date(0) };
    const output = redact(input);
    expect(output).toEqual({
      nested: { items: [{ password: REDACTED }, { ok: 1 }] },
      when: new Date(0),
    });
    expect(input.nested.items[0].password).toBe('x');
  });

  it('passes primitives through', () => {
    expect(redact('plain')).toBe('plain');
    expect(redact(null)).toBeNull();
  });
});

describe('maskValue / maskEmail', () => {
  it('keeps the last 4 characters', () => {
    expect(maskValue('123456789')).toBe('*****6789');
    expect(maskValue('123')).toBe('***');
  });

  it('masks the local part of an email', () => {
    expect(maskEmail('someone@example.test')).toBe('s***@example.test');
    expect(maskEmail('not-an-email')).toBe('********mail');
  });
});
