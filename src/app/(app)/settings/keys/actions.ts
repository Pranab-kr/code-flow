'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { deleteKey, saveKey } from '@/lib/ai/keys';
import { getProvider } from '@/lib/ai/providers';

const MAX_LABEL_LENGTH = 60;

export interface KeyFormResult {
  error?: string;
  saved?: string;
}

/**
 * Validate and store a provider key. Returns metadata-derived confirmation
 * only — the plaintext is never echoed back, and the input is never
 * repopulated: the client form resets on success.
 */
export async function addKeyAction(formData: FormData): Promise<KeyFormResult> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const provider = String(formData.get('provider') ?? '').trim();
  const label = String(formData.get('label') ?? '').trim();
  const key = String(formData.get('key') ?? '');

  const meta = getProvider(provider);
  if (!meta) return { error: 'Choose a provider.' };
  if (!key.trim()) return { error: 'Paste a key first.' };
  if (label.length > MAX_LABEL_LENGTH) {
    return { error: `Keep the label under ${MAX_LABEL_LENGTH} characters.` };
  }

  try {
    // Upsert: saving again for the same provider REPLACES the stored key.
    const saved = await saveKey(user.id, provider, key, label || undefined);
    revalidatePath('/settings/keys');
    // last4 is the only fragment the client is ever allowed to see.
    return { saved: `Saved your ${meta.label} key ending in ••••${saved.last4}.` };
  } catch {
    return { error: `Could not save that ${meta.label} key. Check it and try again.` };
  }
}

/** Remove a stored key. Bound with the provider id, like the project actions. */
export async function removeKeyAction(provider: string): Promise<void> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  if (!getProvider(provider)) return;
  await deleteKey(user.id, provider);
  revalidatePath('/settings/keys');
}
