'use client';

import { useRef, useState, useTransition } from 'react';
import { ENABLED_PROVIDERS } from '@/lib/ai/providers';
import { addKeyAction } from './actions';

/**
 * Client wrapper around the save-key server action. Uncontrolled inputs, so a
 * successful save can `reset()` the form — the key field clears and is never
 * repopulated, and no key material is ever stored in React state.
 */
export function KeyForm() {
  const [providerId, setProviderId] = useState<string>(ENABLED_PROVIDERS[0]?.id ?? 'openai');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement | null>(null);

  const active = ENABLED_PROVIDERS.find((p) => p.id === providerId) ?? ENABLED_PROVIDERS[0];

  function onSubmit(formData: FormData) {
    setError(null);
    setSaved(null);
    startTransition(async () => {
      const result = await addKeyAction(formData);
      if (result?.error) {
        setError(result.error);
      } else {
        // The select is controlled, so it needs an explicit reset alongside
        // the form's uncontrolled fields.
        formRef.current?.reset();
        setProviderId(ENABLED_PROVIDERS[0]?.id ?? 'openai');
        if (result?.saved) setSaved(result.saved);
      }
    });
  }

  return (
    <form ref={formRef} className="keys__form" action={onSubmit}>
      <h2 className="keys__subheading">Add or replace a key</h2>
      <label className="keys__field" htmlFor="keys-provider">
        <span className="keys__label">Provider</span>
        <select
          id="keys-provider"
          name="provider"
          className="keys__select"
          value={providerId}
          disabled={pending}
          onChange={(event) => setProviderId(event.target.value)}
        >
          {ENABLED_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      {active && (
        <p className="keys__hint">
          {active.keyHint ? `${active.keyHint}. ` : ''}
          <a
            className="keys__link"
            href={active.consoleUrl}
            target="_blank"
            rel="noreferrer"
          >
            Get a {active.label} key
          </a>
        </p>
      )}
      <label className="keys__field" htmlFor="keys-label">
        <span className="keys__label">Label (optional)</span>
        <input
          id="keys-label"
          name="label"
          className="keys__input"
          placeholder="Personal"
          maxLength={60}
          autoComplete="off"
          disabled={pending}
        />
      </label>
      <label className="keys__field" htmlFor="keys-key">
        <span className="keys__label">Key</span>
        <input
          id="keys-key"
          name="key"
          className="keys__input"
          type="password"
          autoComplete="new-password"
          placeholder="Paste your key — it clears after saving"
          required
          disabled={pending}
        />
      </label>
      <button className="keys__save" type="submit" disabled={pending} data-state={saved ? 'success' : undefined}>
        {pending ? 'Saving…' : 'Save key'}
      </button>
      {error && (
        <p className="keys__error" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="keys__success" role="status">
          {saved}
        </p>
      )}
    </form>
  );
}
