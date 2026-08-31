'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';

export interface AuthResult {
  error?: string;
  /** A non-failure outcome that still needs the user to act. Rendered as a
   *  notice, NOT as an error: "your account exists, go confirm it" is good news
   *  wearing a red box otherwise. */
  notice?: string;
}

/**
 * Provider errors are mapped to plain language on purpose. "Invalid login
 * credentials" is Supabase's phrasing, not something a learner should have to
 * decode, and a raw provider body can carry account details.
 */
function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) {
    return 'That email and password did not match an account.';
  }
  if (m.includes('email not confirmed')) {
    return 'Check your inbox and confirm your email first.';
  }
  if (m.includes('already registered') || m.includes('already been registered')) {
    return 'An account with that email already exists. Try signing in.';
  }
  if (m.includes('password') && m.includes('6')) {
    return 'Passwords need at least 6 characters.';
  }
  if (m.includes('rate limit') || m.includes('too many')) {
    return 'Too many attempts. Wait a moment and try again.';
  }
  return 'Something went wrong signing you in. Try again in a moment.';
}

function credentials(formData: FormData): { email: string; password: string } | null {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return null;
  return { email, password };
}

export async function signIn(formData: FormData): Promise<AuthResult> {
  const creds = credentials(formData);
  if (!creds) return { error: 'Enter both an email and a password.' };

  const supabase = await createServerClient();
  const { error } = await supabase.auth.signInWithPassword(creds);
  if (error) return { error: friendly(error.message) };

  revalidatePath('/', 'layout');
  const next = String(formData.get('next') ?? '/projects');
  // Only ever redirect within this app: an attacker-supplied absolute URL here
  // would turn our login into an open redirect.
  redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/projects');
}

export async function signUp(formData: FormData): Promise<AuthResult> {
  const creds = credentials(formData);
  if (!creds) return { error: 'Enter both an email and a password.' };
  if (creds.password.length < 8) {
    return { error: 'Use at least 8 characters, so the account is worth having.' };
  }

  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.signUp(creds);
  if (error) return { error: friendly(error.message) };

  // With email confirmation on, signUp returns no session, so redirecting would
  // bounce straight back here. This is a SUCCESS: the account was created.
  if (!data.session) {
    return {
      notice:
        'Account created. Check your email for a confirmation link, then sign in.',
    };
  }

  revalidatePath('/', 'layout');
  redirect('/projects');
}

export async function signOut(): Promise<void> {
  const supabase = await createServerClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}
