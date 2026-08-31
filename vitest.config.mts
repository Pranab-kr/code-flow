import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const alias = { '@': path.resolve(import.meta.dirname, './src') };

/**
 * Read .env.local into a plain object.
 *
 * Vitest does NOT load .env.local into process.env, so the RLS test would see
 * `undefined` for every Supabase variable and throw inside createClient before
 * asserting anything — a security test that cannot fail is worse than no test.
 *
 * Deliberately not vite's `loadEnv`: importing 'vite' here depends on a hoisted
 * symlink that pnpm's peer-dependency hashing can leave dangling, and the failure
 * mode is a silently unresolved import. node:fs has no such dependency.
 */
function readEnvLocal(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const raw = readFileSync(path.resolve(import.meta.dirname, '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
  } catch {
    // Absent .env.local is fine: the unit project needs no env, and the rls
    // project fails loudly on the missing variable, which is the right signal.
  }
  return out;
}

// Two projects, deliberately: a CLI path argument FILTERS `include`, it never
// widens it, so `vitest run tests/rls.test.ts` finds nothing unless tests/ has
// its own project.
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'jsdom',
          setupFiles: ['./vitest.setup.ts'],
          include: ['src/**/*.test.{ts,tsx}'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'rls',
          environment: 'node',
          include: ['tests/*.test.ts'],
          env: readEnvLocal(),
        },
      },
    ],
  },
});
