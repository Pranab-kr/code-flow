/**
 * BYOK envelope encryption (spec §9, Plan 5 Task 1).
 *
 * Users' provider API keys are encrypted at rest with AES-256-GCM, one random
 * 96-bit IV per record, with AAD bound to `user_id|provider` — so a ciphertext
 * copied into another user's (or provider's) row fails to decrypt rather than
 * silently working. Decryption happens only inside a server route; keys never
 * reach the browser after submission.
 *
 * Honest limit (spec §9): an env-var KEK means a *database* leak alone does not
 * expose keys, but a *full server* compromise does — the KEK is in the same
 * process. Supabase Vault or a cloud KMS is the upgrade path.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const IV_BYTES = 12; // 96-bit, the GCM standard
const TAG_BYTES = 16;

function kek(): Buffer {
  const raw = process.env.BYOK_KEK;
  if (!raw) throw new Error('BYOK_KEK is not set; refusing to encrypt with no key');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('BYOK_KEK must decode to 32 bytes for AES-256');
  return key;
}

/** Binds a ciphertext to one user AND one provider. */
export function aadFor(userId: string, provider: string): string {
  return `${userId}|${provider}`;
}

export interface SealedSecret {
  ciphertext: string; // base64: ciphertext || authTag
  iv: string; // base64
  keyVersion: number;
}

export function encryptSecret(plaintext: string, aad: string): SealedSecret {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', kek(), iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: Buffer.concat([body, cipher.getAuthTag()]).toString('base64'),
    iv: iv.toString('base64'),
    keyVersion: Number(process.env.BYOK_KEK_VERSION ?? '1'),
  };
}

export function decryptSecret(rec: SealedSecret, aad: string): string {
  const raw = Buffer.from(rec.ciphertext, 'base64');
  const body = raw.subarray(0, raw.length - TAG_BYTES);
  const tag = raw.subarray(raw.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', kek(), Buffer.from(rec.iv, 'base64'));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  // Throws on any mismatch: wrong AAD, tampered body, tampered IV.
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}
