/**
 * The token contract between the theme and the exporter.
 *
 * Export reads COMPUTED token values at export time (whichever theme is
 * active), never hardcoded hex — so a future theme needs no export change.
 * Every name here must exist in `src/styles/tokens.css` in both drops.
 */
export const TOKEN_NAMES = [
  '--color-node',
  '--color-node-brdr',
  '--color-ink',
  '--color-ink-2',
  '--color-ink-3',
  '--color-edge',
  '--color-edge-back',
  '--color-accent',
  '--color-danger',
  '--color-warn',
  '--color-canvas',
  '--color-paper-3',
  '--font-mono',
] as const;

/** Snapshot the export-relevant tokens from the live theme. Client-only. */
export function readTokens(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  return Object.fromEntries(TOKEN_NAMES.map((n) => [n, style.getPropertyValue(n).trim()]));
}
