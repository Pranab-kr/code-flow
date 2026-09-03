// SERVER-ONLY. Never import this module (or createServiceClient) into a client
// component: it reads and writes provider key material, and bundling it would
// ship that capability to the browser. Keys are encrypted with the envelope
// from `@/lib/crypto/envelope` and must never be logged, only ever returned
// as KeyMeta (provider, label, last4).

import { createServiceClient } from '@/lib/supabase/server';
import { aadFor, decryptSecret, encryptSecret } from '@/lib/crypto/envelope';
import { getProvider } from './providers';

export interface KeyMeta {
  provider: string;
  label: string | null;
  last4: string;
}

interface KeyRow {
  provider: string;
  label: string | null;
  last4: string;
  ciphertext: string;
  iv: string;
  key_version: number;
}

/** Last four characters of the trimmed key — the only fragment ever shown. */
export function last4Of(plaintextKey: string): string {
  return plaintextKey.trim().slice(-4);
}

function requireEnabledProvider(provider: string): void {
  if (!getProvider(provider)) {
    throw new Error(`Unknown or unsupported provider: ${provider}`);
  }
}

/**
 * Encrypt and upsert a provider key. Returns metadata only — the plaintext
 * (and ciphertext) never leave this return type.
 */
export async function saveKey(
  userId: string,
  provider: string,
  plaintextKey: string,
  label?: string,
): Promise<KeyMeta> {
  requireEnabledProvider(provider);
  if (!plaintextKey || !plaintextKey.trim()) {
    throw new Error('Key must not be empty');
  }
  const sealed = encryptSecret(plaintextKey, aadFor(userId, provider));
  const db = createServiceClient();
  const { data, error } = await db
    .from('user_provider_keys')
    .upsert(
      {
        user_id: userId,
        provider,
        label: label ?? null,
        last4: last4Of(plaintextKey),
        ciphertext: sealed.ciphertext,
        iv: sealed.iv,
        key_version: sealed.keyVersion,
      },
      { onConflict: 'user_id,provider' },
    )
    .select('provider,label,last4')
    .single();
  if (error || !data) {
    throw new Error(`Failed to store key for provider ${provider}`);
  }
  const row = data as Pick<KeyRow, 'provider' | 'label' | 'last4'>;
  return { provider: row.provider, label: row.label, last4: row.last4 };
}

/** Metadata for every key this user has stored. No key material. */
export async function listKeys(userId: string): Promise<KeyMeta[]> {
  const db = createServiceClient();
  const { data, error } = await db
    .from('user_provider_keys')
    .select('provider,label,last4')
    .eq('user_id', userId)
    .order('provider');
  if (error) {
    throw new Error('Failed to list provider keys');
  }
  const rows = (data ?? []) as Pick<KeyRow, 'provider' | 'label' | 'last4'>[];
  return rows.map((row) => ({ provider: row.provider, label: row.label, last4: row.last4 }));
}

export async function deleteKey(userId: string, provider: string): Promise<void> {
  const db = createServiceClient();
  const { error } = await db
    .from('user_provider_keys')
    .delete()
    .eq('user_id', userId)
    .eq('provider', provider);
  if (error) {
    throw new Error(`Failed to delete key for provider ${provider}`);
  }
}

/**
 * Decrypt a stored key for server-side use (e.g. the chat route). Returns
 * null when the user has no key for this provider. The caller must never
 * forward the result to the browser or a log.
 */
export async function getDecryptedKey(userId: string, provider: string): Promise<string | null> {
  const db = createServiceClient();
  const { data, error } = await db
    .from('user_provider_keys')
    .select('ciphertext,iv,key_version')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load key for provider ${provider}`);
  }
  if (!data) return null;
  const row = data as Pick<KeyRow, 'ciphertext' | 'iv' | 'key_version'>;
  return decryptSecret(
    { ciphertext: row.ciphertext, iv: row.iv, keyVersion: row.key_version },
    aadFor(userId, provider),
  );
}
