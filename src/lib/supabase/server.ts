import { createServerClient as create } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

/** Server client bound to the request's cookies, so RLS sees the real user. */
export async function createServerClient() {
  const store = await cookies(); // async since Next 15
  return create(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Middleware refreshes the session instead, so this is not an error.
          }
        },
      },
    },
  );
}

/**
 * BYPASSES RLS. Server-only.
 *
 * Never import this into a client component: bundling it would ship a key that
 * can read every user's rows. It exists for the Inngest job and for the BYOK key
 * table, which no client may touch.
 */
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
