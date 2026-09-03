import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { last4Of, saveKey, listKeys, getDecryptedKey, deleteKey } from './keys';

const SECRET = 'sk-secret-123456789';

describe('key metadata (no database needed)', () => {
  it('derives last4 from the tail of the key', () => {
    expect(last4Of(SECRET)).toBe('6789');
  });

  it('rejects unknown providers without touching the database', async () => {
    await expect(saveKey('user-1', 'no-such-provider', 'sk-x')).rejects.toThrow(/unknown|unsupported/i);
  });

  it('rejects unverified providers without touching the database', async () => {
    await expect(saveKey('user-1', 'opencode-zen', 'sk-x')).rejects.toThrow(
      /unknown|unsupported/i,
    );
  });
});

const hasDb = Boolean(
  process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL,
);

// Needs Supabase + service key (and the 0005 migration applied). Under plain
// `pnpm test` the unit project carries no env, so this skips there by design.
describe.skipIf(!hasDb)('key vault round-trip', () => {
  const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  let userId = '';

  beforeAll(async () => {
    process.env.BYOK_KEK = randomBytes(32).toString('base64');
    process.env.BYOK_KEK_VERSION = '1';
    const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
    const { data, error } = await admin.auth.admin.createUser({
      email: `byok-${process.pid}-${Math.floor(performance.now())}@test.local`,
      password: 'test-password-123',
      email_confirm: true,
    });
    if (error) throw new Error(`createUser: ${error.message}`);
    userId = data.user.id;
  }, 60_000);

  afterAll(async () => {
    if (userId) {
      const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
      await admin.auth.admin.deleteUser(userId).catch(() => {});
    }
  }, 60_000);

  it('the saveKey result contains no part of the key', async () => {
    const res = await saveKey(userId, 'openai', SECRET, 'test');
    const body = JSON.stringify(res);
    expect(body).not.toContain('sk-secret');
    expect(body).toContain('6789'); // last4 only
    expect(res).toEqual({ provider: 'openai', label: 'test', last4: '6789' });
  });

  it('round-trips through list and decrypt', async () => {
    const keys = await listKeys(userId);
    expect(keys).toEqual([{ provider: 'openai', label: 'test', last4: '6789' }]);
    await expect(getDecryptedKey(userId, 'openai')).resolves.toBe(SECRET);
  });

  it('delete removes the key', async () => {
    await deleteKey(userId, 'openai');
    await expect(getDecryptedKey(userId, 'openai')).resolves.toBeNull();
    await expect(listKeys(userId)).resolves.toEqual([]);
  });
});
