'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';

interface Item {
  group: string;
  label: string;
  hint?: string;
  href: string;
}

const ITEMS: Item[] = [
  { group: 'Product', label: 'How it works', href: '/#how' },
  { group: 'Product', label: 'Languages', href: '/#languages' },
  { group: 'Product', label: 'Scope', href: '/#scope' },
  { group: 'Product', label: 'Live demo', hint: 'no account needed', href: '/demo' },
  { group: 'Account', label: 'Sign in', href: '/login' },
  { group: 'Account', label: 'Create an account', href: '/signup' },
  { group: 'Account', label: 'Your projects', href: '/projects' },
];

/**
 * N13 inline ⌘K pill. The pill is real: it opens a grouped, keyboard-navigable
 * palette over this site's own destinations (sections + routes). No dead
 * affordances — a pill that opened nothing would fail the plan's Step 5 rule.
 */
export function Nav() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setActive(0);
    pillRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (open) close();
        else setOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  const q = query.trim().toLowerCase();
  const results = q
    ? ITEMS.filter(
        (i) => i.label.toLowerCase().includes(q) || i.group.toLowerCase().includes(q),
      )
    : ITEMS;

  const onQuery = useCallback((value: string) => {
    setQuery(value);
    setActive(0);
  }, []);

  const groups: { name: string; items: { item: Item; index: number }[] }[] = [];
  for (const item of results) {
    const index = results.indexOf(item);
    const g = groups.find((g) => g.name === item.group);
    if (g) g.items.push({ item, index });
    else groups.push({ name: item.group, items: [{ item, index }] });
  }

  return (
    <>
      <header className="mnav">
        <div className="mnav__inner">
          <Link className="mnav__brand" href="/">
            code-flow
          </Link>
          <button
            ref={pillRef}
            type="button"
            className="mnav__pill"
            aria-label="Search this site (Command K)"
            aria-haspopup="dialog"
            onClick={() => setOpen(true)}
          >
            <span className="mnav__pill-ico" aria-hidden="true">
              ⌕
            </span>
            <span className="mnav__pill-text">Search…</span>
            <span className="mnav__pill-kbd" aria-hidden="true">
              <kbd>⌘</kbd>
              <kbd>K</kbd>
            </span>
          </button>
          <nav className="mnav__right" aria-label="Primary">
            <Link className="mnav__link" href="/demo">
              Demo
            </Link>
            <Link className="mnav__link" href="/login">
              Sign in
            </Link>
            <Link className="mnav__cta" href="/signup">
              Get started
            </Link>
          </nav>
        </div>
      </header>

      <div className={`cmdk${open ? ' is-open' : ''}`} aria-hidden={!open}>
        <div className="cmdk__backdrop" data-close onClick={close} />
        <div className="cmdk__panel" role="dialog" aria-modal="true" aria-label="Site search">
          <div className="cmdk__field">
            <span aria-hidden="true">⌕</span>
            <input
              ref={inputRef}
              id="cmdk-input"
              placeholder="Search sections and pages…"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, results.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  const hit = results[active];
                  if (hit) {
                    setOpen(false);
                    window.location.href = hit.href;
                  }
                }
              }}
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={`cmdk-item-${active}`}
              autoComplete="off"
            />
            <kbd>esc</kbd>
          </div>
          <div className="cmdk__results" role="listbox" id={listId} aria-label="Results">
            {groups.map((g) => (
              <div key={g.name}>
                <p className="cmdk__group">{g.name}</p>
                {g.items.map(({ item, index }) => (
                  <Link
                    key={item.href}
                    id={`cmdk-item-${index}`}
                    role="option"
                    aria-selected={index === active}
                    className={`cmdk__item${index === active ? ' is-active' : ''}`}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    onMouseEnter={() => setActive(index)}
                  >
                    {item.label}
                    {item.hint && <span className="cmdk__hint">{item.hint}</span>}
                  </Link>
                ))}
              </div>
            ))}
            {results.length === 0 && <p className="cmdk__empty">Nothing here. Try “demo”.</p>}
          </div>
          <div className="cmdk__foot" aria-hidden="true">
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> navigate
            </span>
            <span>
              <kbd>↵</kbd> open
            </span>
            <span>
              <kbd>esc</kbd> close
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
