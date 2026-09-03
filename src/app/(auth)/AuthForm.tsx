'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import type { AuthResult } from './actions';
import './auth.css';

interface Props {
  mode: 'signin' | 'signup';
  action: (formData: FormData) => Promise<AuthResult>;
  next?: string;
}

const COPY = {
  signin: {
    heading: 'Sign in',
    submit: 'Sign in',
    busy: 'Signing in…',
    altPrompt: 'No account yet?',
    altHref: '/signup',
    altLabel: 'Create one',
    passwordAutocomplete: 'current-password',
  },
  signup: {
    heading: 'Create an account',
    submit: 'Create account',
    busy: 'Creating…',
    altPrompt: 'Already have one?',
    altHref: '/login',
    altLabel: 'Sign in',
    passwordAutocomplete: 'new-password',
  },
} as const;

export function AuthForm({ mode, action, next }: Props) {
  const copy = COPY[mode];
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Controlled so a failed submit keeps what was typed: React resets
  // uncontrolled inputs when a form action finishes.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, startTransition] = useTransition();
  const errorRef = useRef<HTMLParagraphElement>(null);

  // Move focus to the error so a screen reader announces it (Plan 6 Task 2).
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  function onSubmit(formData: FormData) {
    setError(null);
    setNotice(null);
    // Client-side email check before the round trip: kinder than a server
    // rejection. Typed values stay put (controlled inputs, above).
    const address = String(formData.get('email') ?? '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError('Enter an email address shaped like you@example.com.');
      return;
    }
    startTransition(async () => {
      // A redirect means success. Control returns here for a failure OR for a
      // success that still needs the user to do something (confirm an email).
      const result = await action(formData);
      if (result?.error) setError(result.error);
      else if (result?.notice) setNotice(result.notice);
    });
  }

  return (
    <main className="auth">
      <form
        className="auth__card"
        action={onSubmit}
        // Native validation off: our own messages are kinder than the browser's.
        noValidate
      >
        <p className="auth__brand">code-flow</p>
        <h1 className="auth__heading">{copy.heading}</h1>

        {next && <input type="hidden" name="next" value={next} />}

        <label className="auth__label" htmlFor="email">
          Email
        </label>
        <input
          className="auth__input"
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? 'auth-error' : undefined}
          disabled={pending}
        />

        <label className="auth__label" htmlFor="password">
          Password
        </label>
        <input
          className="auth__input"
          id="password"
          name="password"
          type="password"
          autoComplete={copy.passwordAutocomplete}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? 'auth-error' : undefined}
          disabled={pending}
        />

        {error && (
          // tabIndex + role=alert so a screen reader announces it and focus can land here
          <p
            className="auth__error"
            id="auth-error"
            role="alert"
            tabIndex={-1}
            ref={errorRef}
          >
            {error}
          </p>
        )}

        {notice && (
          // role=status, not alert: this is an outcome to read, not a problem.
          <p className="auth__notice" role="status" tabIndex={-1}>
            {notice}
          </p>
        )}

        <button className="auth__submit" type="submit" disabled={pending}>
          {pending ? copy.busy : copy.submit}
        </button>

        <p className="auth__alt">
          {copy.altPrompt}{' '}
          <Link className="auth__link" href={copy.altHref}>
            {copy.altLabel}
          </Link>
        </p>
      </form>
    </main>
  );
}
