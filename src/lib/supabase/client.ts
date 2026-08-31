import { createBrowserClient as create } from '@supabase/ssr';

/**
 * Browser client. Uses the publishable key, which is safe to ship: RLS is what
 * protects the data, not this key's secrecy.
 */
export function createBrowserClient() {
  return create(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
