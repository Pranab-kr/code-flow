import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { listKeys } from '@/lib/ai/keys';
import { ENABLED_PROVIDERS } from '@/lib/ai/providers';
import { KeyForm } from './KeyForm';
import { removeKeyAction } from './actions';
import './keys.css';

export const metadata = { title: 'API keys · code-flow' };

/**
 * BYOK settings. This server component sees key METADATA only
 * (provider, label, last4) — the plaintext never leaves the vault, so there
 * is nothing here that could leak it into HTML.
 */
export default async function KeysPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const keys = await listKeys(user.id);

  return (
    <main className="keys">
      <header className="keys__bar">
        <Link className="keys__back" href="/projects">
          ← Projects
        </Link>
        <span className="keys__brand">code-flow</span>
      </header>

      <div className="keys__body">
        <h1 className="keys__heading">API keys</h1>
        <p className="keys__lede">
          Bring your own provider key to ask about your diagrams. Keys are encrypted
          before they are stored and are only ever decrypted inside the chat request —
          this page can show no more than the last four characters.
        </p>

        <section aria-label="Saved keys">
          <h2 className="keys__subheading">Saved keys</h2>
          {keys.length > 0 ? (
            <ul className="keys__list">
              {keys.map((k) => {
                const meta = ENABLED_PROVIDERS.find((p) => p.id === k.provider);
                return (
                  <li key={k.provider} className="keys__row">
                    <span className="keys__meta">
                      <span className="keys__provider">{meta?.label ?? k.provider}</span>
                      {k.label && <span className="keys__label">{k.label}</span>}
                      <span className="keys__last4">••••{k.last4}</span>
                    </span>
                    <form action={removeKeyAction.bind(null, k.provider)}>
                      <button className="keys__remove" type="submit">
                        Remove
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="keys__empty">
              No keys saved yet. Add one below and the Ask pane will light up.
            </p>
          )}
        </section>

        <KeyForm />

        <section aria-label="Where to get a key">
          <h2 className="keys__subheading">Where to get a key</h2>
          <ul className="keys__list">
            {ENABLED_PROVIDERS.map((p) => (
              <li key={p.id} className="keys__row">
                <span className="keys__meta">
                  <span className="keys__provider">{p.label}</span>
                  {p.keyHint && <span className="keys__label">{p.keyHint}</span>}
                </span>
                <a className="keys__link" href={p.consoleUrl} target="_blank" rel="noreferrer">
                  Get a key
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
