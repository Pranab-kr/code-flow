import { describe, it, expect, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { aadFor, decryptSecret, encryptSecret } from './envelope';

beforeAll(() => {
  process.env.BYOK_KEK = randomBytes(32).toString('base64');
  process.env.BYOK_KEK_VERSION = '1';
});

const SECRET = 'sk-test-abcdef0123456789';

describe('envelope encryption', () => {
  it('round-trips a secret', () => {
    const aad = aadFor('user-1', 'openai');
    expect(decryptSecret(encryptSecret(SECRET, aad), aad)).toBe(SECRET);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const aad = aadFor('user-1', 'openai');
    const a = encryptSecret(SECRET, aad);
    const b = encryptSecret(SECRET, aad);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
  });

  it('FAILS to decrypt when the AAD user differs', () => {
    // The whole point of binding AAD: a ciphertext copied into another user's row
    // must not decrypt. Without this it would silently work.
    const rec = encryptSecret(SECRET, aadFor('user-1', 'openai'));
    expect(() => decryptSecret(rec, aadFor('user-2', 'openai'))).toThrow();
  });

  it('FAILS to decrypt when the AAD provider differs', () => {
    const rec = encryptSecret(SECRET, aadFor('user-1', 'openai'));
    expect(() => decryptSecret(rec, aadFor('user-1', 'anthropic'))).toThrow();
  });

  it('FAILS on a tampered ciphertext (authentication, not just encryption)', () => {
    const aad = aadFor('user-1', 'openai');
    const rec = encryptSecret(SECRET, aad);
    const raw = Buffer.from(rec.ciphertext, 'base64');
    raw[0] ^= 0xff;
    expect(() => decryptSecret({ ...rec, ciphertext: raw.toString('base64') }, aad)).toThrow();
  });

  it('FAILS on a tampered IV', () => {
    const aad = aadFor('user-1', 'openai');
    const rec = encryptSecret(SECRET, aad);
    const iv = Buffer.from(rec.iv, 'base64');
    iv[0] ^= 0xff;
    expect(() => decryptSecret({ ...rec, iv: iv.toString('base64') }, aad)).toThrow();
  });

  it('stamps the key version so rotation is possible', () => {
    expect(encryptSecret(SECRET, aadFor('u', 'openai')).keyVersion).toBe(1);
  });

  it('refuses to run without a KEK rather than falling back to a weak default', () => {
    const saved = process.env.BYOK_KEK;
    delete process.env.BYOK_KEK;
    expect(() => encryptSecret(SECRET, aadFor('u', 'openai'))).toThrow(/BYOK_KEK/);
    process.env.BYOK_KEK = saved;
  });

  it('rejects a KEK that is not 32 bytes', () => {
    const saved = process.env.BYOK_KEK;
    process.env.BYOK_KEK = Buffer.from('too short').toString('base64');
    expect(() => encryptSecret(SECRET, aadFor('u', 'openai'))).toThrow(/32 bytes/);
    process.env.BYOK_KEK = saved;
  });

  it('never embeds the plaintext in its own output', () => {
    const rec = encryptSecret(SECRET, aadFor('u', 'openai'));
    expect(JSON.stringify(rec)).not.toContain(SECRET);
    expect(JSON.stringify(rec)).not.toContain('sk-test');
  });
});
