'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';
import { THEME_STORAGE_KEY, resolveTheme, type Theme, type ThemePref } from '@/lib/theme';
import './ThemeToggle.css';

const ORDER: ThemePref[] = ['system', 'light', 'dark'];

const LABEL: Record<ThemePref, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

const GLYPH: Record<ThemePref, string> = {
  system: '◐',
  light: '☀',
  dark: '☾',
};

function isPref(value: string | null): value is ThemePref {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** Subscribe to storage changes so the toggle stays honest across tabs. */
function subscribe(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}

/** Returns a primitive, so React's snapshot identity check compares by value. */
function getSnapshot(): ThemePref {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isPref(stored) ? stored : 'system';
  } catch {
    // Private mode or blocked storage: the toggle still works for this page view.
    return 'system';
  }
}

/** No localStorage during SSR; ThemeScript has already painted the right theme. */
function getServerSnapshot(): ThemePref {
  return 'system';
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function apply(pref: ThemePref): Theme {
  const root = document.documentElement;
  // Absent attribute lets the prefers-color-scheme block own 'system'.
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
  return resolveTheme(pref, systemPrefersDark());
}

/**
 * Cycles system -> light -> dark. Three states, not two: a binary toggle cannot
 * express "follow the OS", which is the default.
 *
 * Reads through useSyncExternalStore rather than an effect — localStorage is an
 * external store, and setState inside an effect causes a cascading render.
 */
export function ThemeToggle() {
  const pref = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [saveFailed, setSaveFailed] = useState(false);

  const cycle = useCallback(() => {
    const next = ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length];
    apply(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
      setSaveFailed(false);
    } catch {
      // The theme applied; only remembering it failed. Say so, don't revert.
      setSaveFailed(true);
    }
  }, [pref]);

  return (
    <button
      type="button"
      className="cf-theme-toggle"
      onClick={cycle}
      data-state={saveFailed ? 'error' : undefined}
      aria-label={`Theme: ${LABEL[pref]}. Activate to change.`}
      title={saveFailed ? "Theme applied, but couldn't be saved" : `Theme: ${LABEL[pref]}`}
    >
      <span className="cf-theme-toggle__glyph" aria-hidden="true">
        {GLYPH[pref]}
      </span>
      <span className="cf-theme-toggle__label">{LABEL[pref]}</span>
    </button>
  );
}
