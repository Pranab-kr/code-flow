import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { deleteKey, listKeys, saveKey } from '@/lib/ai/keys';

// nodejs, not edge: decryption needs node:crypto via the envelope module.
export const runtime = 'nodejs';

interface KeysBody {
  provider?: unknown;
  key?: unknown;
  label?: unknown;
}

/** The request's user, or null when not signed in. */
async function requireUserId(): Promise<string | null> {
  const supabase = await createServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/** GET /api/keys — list key metadata only. Never key material. */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }
  try {
    const keys = await listKeys(userId);
    return NextResponse.json({ keys });
  } catch {
    return NextResponse.json({ error: 'Failed to list keys' }, { status: 500 });
  }
}

/**
 * POST /api/keys { provider, key, label? } — encrypt and upsert.
 * Returns { provider, label, last4 } only.
 */
export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }
  const body = (await req.json()) as KeysBody;
  const provider = typeof body.provider === 'string' ? body.provider : '';
  const key = typeof body.key === 'string' ? body.key : '';
  const label = typeof body.label === 'string' ? body.label : undefined;
  if (!provider || !key) {
    return NextResponse.json({ error: 'provider and key are required' }, { status: 400 });
  }
  try {
    const meta = await saveKey(userId, provider, key, label);
    return NextResponse.json(meta);
  } catch (err) {
    // Unknown/unverified provider or bad input: say so plainly. Storage
    // failures stay generic. Either way the response never echoes the key.
    const message = err instanceof Error ? err.message : 'Failed to save key';
    const status = message.startsWith('Unknown or unsupported provider') ? 400 : 500;
    const safe = status === 400 ? message : 'Failed to save key';
    return NextResponse.json({ error: safe }, { status });
  }
}

/** DELETE /api/keys { provider } — remove a stored key. */
export async function DELETE(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }
  const body = (await req.json()) as KeysBody;
  const provider = typeof body.provider === 'string' ? body.provider : '';
  if (!provider) {
    return NextResponse.json({ error: 'provider is required' }, { status: 400 });
  }
  try {
    await deleteKey(userId, provider);
    return NextResponse.json({ provider, deleted: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete key' }, { status: 500 });
  }
}
