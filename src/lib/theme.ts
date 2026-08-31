export type ThemePref = 'dark' | 'light' | 'system';
export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'codeflow-theme';

/**
 * Resolve a stored preference plus the OS signal into the theme to paint.
 *
 * Aurora Night is the designed default (spec §10), so an absent or unreadable
 * system signal resolves to dark rather than light.
 */
export function resolveTheme(pref: ThemePref, systemDark: boolean): Theme {
  if (pref === 'dark' || pref === 'light') return pref;
  return systemDark === false ? 'light' : 'dark';
}
