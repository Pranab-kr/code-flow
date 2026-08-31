'use client';

import { useState, useTransition } from 'react';
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
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    setNotice(null);
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
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? 'auth-error' : undefined}
          disabled={pending}
        />

        {error && (
          // tabIndex + role=alert so a screen reader announces it and focus can land here
          <p className="auth__error" id="auth-error" role="alert" tabIndex={-1}>
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
