# code-flow P1 — Plan 1: Auth, Python IR, Canvas

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working vertical slice — a user signs up, creates a project, pastes Python, and sees a correct control-flow diagram they can click through.

**Architecture:** Next.js 16 app router with Supabase for auth and RLS-protected persistence. A portable IR module (`src/lib/ir/`, zero React/Next imports) parses source via `web-tree-sitter` into a normalized `ProgramIR` of basic blocks, runs in a web worker, and is laid out by `elkjs` for rendering in React Flow. The diagram is a derived view — code is the only source of truth.

**Tech Stack:** Next.js 16, TypeScript (strict), Supabase (Postgres/Auth/RLS), CodeMirror 6, `@xyflow/react`, `elkjs`, `web-tree-sitter`, Tailwind v4, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-31-code-flow-p1-design.md`

## Global Constraints

- **Node 20+**, `pnpm` as package manager, TypeScript `strict: true`, no `any` in committed code.
- **`src/lib/ir/**` must not import React, Next, or any DOM global.** Enforced by an ESLint `no-restricted-imports` rule (Task 5). This is what lets the same module run in a browser worker and an Inngest job.
- **The client never uploads a graph.** It uploads source only; the server re-derives. (Spec §14.5)
- **No code mutation from the diagram** anywhere in P1. (Spec §3)
- **All Hallmark colours/fonts referenced as tokens** (`var(--color-*)`, `var(--font-*)`). Never inline hex/OKLCH. (Hallmark locked-tokens rule)
- **Every interactive component ships all 8 states**: default, hover, `:focus-visible`, `:active`, disabled, loading, error, success.
- **Motion**: only `transform`/`opacity`, max 3 primitives, named easings, `prefers-reduced-motion` honoured. Focus rings never animated.
- **Node meaning never carried by colour alone** — shape + label required. (Spec §10)
- **RLS on every table**; every table gets a negative test proving user A cannot read user B's rows.
- IR node IDs are structural per Spec §6: `{functionId}/{structuralPath}#{role}`.
- `irVersion` constant starts at `1`; bump invalidates persisted graphs.

---

## File Structure

| Path | Responsibility |
|---|---|
| `src/lib/ir/types.ts` | IR type definitions only. No logic. |
| `src/lib/ir/ids.ts` | Structural ID construction + the `IdBuilder` sibling counter. |
| `src/lib/ir/builder.ts` | Language-agnostic CFG assembly: block splitting, edge wiring, exit collection. |
| `src/lib/ir/languages/python.ts` | Python tree-sitter node-kind → IR mapping. |
| `src/lib/ir/languages/registry.ts` | `language → { grammarUrl, adapter }` lookup. |
| `src/lib/ir/parse.ts` | Public entry: `parseToIR(source, language)`. |
| `src/lib/layout/elk.ts` | IR → positioned nodes/edges via elkjs. |
| `src/workers/parse.worker.ts` | Worker wrapper around `parseToIR` + layout. |
| `src/lib/supabase/{client,server,middleware}.ts` | Supabase client factories per context. |
| `supabase/migrations/*.sql` | Schema + RLS policies. |
| `src/components/canvas/*` | React Flow custom nodes, edges, canvas shell. |
| `src/components/editor/CodeEditor.tsx` | CodeMirror 6 wrapper. |
| `src/app/**` | Routes: `(auth)`, `(app)/projects`, `(app)/projects/[id]`. |
| `src/styles/tokens.css` | Hallmark tokens, both Aurora drops. |

---

## Task 1: Scaffold, tokens, and both themes

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `vitest.config.ts`
- Create: `src/app/layout.tsx`, `src/app/page.tsx`, `src/styles/tokens.css`, `src/styles/globals.css`
- Create: `src/components/ThemeScript.tsx`, `src/lib/theme.ts`
- Test: `src/lib/theme.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `resolveTheme(pref: ThemePref, systemDark: boolean): 'dark' | 'light'` where `type ThemePref = 'dark' | 'light' | 'system'`. Token names in `tokens.css` used by every later component.

- [ ] **Step 1: Initialize the project**

`create-next-app` **refuses to run in a non-empty directory**, and this repo already has
`docs/`, `.claude/`, `PROGRESS.md`, `CLAUDE.md`, `AGENTS.md`, `.mcp.json`, `.gitignore`.
Verified behaviour: it prints "contains files that could conflict", writes nothing, and
**exits 0** — so a script that only checks the exit code will think it succeeded.

Scaffold into a temp directory and move the result in:

```bash
cd /tmp && rm -rf cf-scaffold
pnpm dlx create-next-app@latest cf-scaffold \
  --typescript --tailwind --eslint --app --src-dir \
  --import-alias "@/*" --use-pnpm --skip-install --yes
cd /home/pranab/proj/codeflow

# Move everything except the files we already own. Note the excludes:
#   AGENTS.md  — create-next-app writes its own (--agents-md is a DEFAULT in v16)
#   .gitignore — merge by hand; ours already covers .env.local and settings.local.json
rsync -a --exclude 'AGENTS.md' --exclude '.gitignore' --exclude '.git' \
  /tmp/cf-scaffold/ ./
# Fold in Next's gitignore additions without losing our secret rules:
cat /tmp/cf-scaffold/.gitignore >> .gitignore
sort -u -o .gitignore .gitignore
rm -rf /tmp/cf-scaffold

pnpm add geist
pnpm add -D vitest @vitejs/plugin-react jsdom \
  @testing-library/react @testing-library/jest-dom
pnpm install
```

Notes on flags that changed: **`--no-turbopack` no longer exists** — Turbopack is the default
bundler in Next 16, and passing a removed flag is an error. `--yes` accepts the remaining
defaults. `geist` is the font package the token block's `--font-display` / `--font-mono`
reference; without it those names fall through to the system stack and the design is wrong.

- [ ] **Step 2: Configure Vitest**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';          // from 'vite', NOT 'vitest/config'
import path from 'node:path';

const alias = { '@': path.resolve(import.meta.dirname, './src') };

// Two projects, deliberately:
//  - a CLI path arg FILTERS `include`, it never widens it, so tests/ needs its own project
//    or `pnpm vitest run tests/rls.test.ts` prints "No test files found" and exits 1.
//  - Vitest does not read .env.local into process.env, so the RLS test needs loadEnv.
export default defineConfig(({ mode }) => ({
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
          env: loadEnv(mode, process.cwd(), ''),   // '' is required or only VITE_* load
        },
      },
    ],
  },
}));
```

Create `vitest.setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

Add to `package.json` scripts — `test` is scoped to `unit` so `pnpm test` never requires
live Supabase credentials:

```json
"test":       "vitest run --project unit",
"test:watch": "vitest --project unit",
"test:rls":   "vitest run --project rls"
```

`pnpm vitest run tests/rls.test.ts` then works, because the path filter lands inside the
`rls` project.

- [ ] **Step 3: Write the failing theme test**

Create `src/lib/theme.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveTheme } from './theme';

describe('resolveTheme', () => {
  it('returns the explicit preference regardless of system', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('follows the system when preference is system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('defaults to dark for system preference with no signal', () => {
    // Aurora Night is the designed default (spec sec.10)
    expect(resolveTheme('system', undefined as unknown as boolean)).toBe('dark');
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm test src/lib/theme.test.ts`
Expected: FAIL — "Failed to resolve import ./theme"

- [ ] **Step 5: Implement `resolveTheme`**

Create `src/lib/theme.ts`:

```ts
export type ThemePref = 'dark' | 'light' | 'system';
export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'codeflow-theme';

export function resolveTheme(pref: ThemePref, systemDark: boolean): Theme {
  if (pref === 'dark' || pref === 'light') return pref;
  return systemDark === false ? 'light' : 'dark';
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test src/lib/theme.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 7: Write the Hallmark tokens**

Create `src/styles/tokens.css`. Per Spec §10: light palette on bare `:root`, dark redefined under both a media query and `[data-theme]`.

```css
/* Hallmark · macrostructure: n/a (component scope) · theme: Aurora · genre: atmospheric
 * tone: technical/atmospheric · anchor hue: cool cyan ~200
 * drops: Night (default, blooms allowed) · Day (light, blooms dropped)
 * axes: paper-band=dark · display-style=grotesk-sans · accent-hue=cool
 *
 * CONTRAST-VERIFIED 2026-08-31 (OKLCH -> sRGB -> WCAG relative luminance).
 * All 27 text/non-text pairs pass in BOTH drops. Verified pairs include every
 * ink/accent on every paper tier and on --color-node, accent-ink on accent fill,
 * focus on every surface, node-brdr on canvas AND node (3:1 — node shape carries
 * meaning per spec §10, so an invisible border is an a11y defect), edges on canvas,
 * and danger/warn/ok on paper.
 * --color-rule is a DECORATIVE divider (1.71:1 day / 1.94:1 night) and is exempt
 * from WCAG 1.4.11 — do not "fix" it to 3:1; that reads as heavy-handed.
 * If you change any L value, re-run the contrast check before committing.
 */

:root {
  /* --- Aurora Day (light) is the bare-root definition --- */
  --color-paper:      oklch(97% 0.006 200);
  --color-paper-2:    oklch(94% 0.008 200);
  --color-paper-3:    oklch(90% 0.010 200);
  --color-ink:        oklch(22% 0.015 200);
  --color-ink-2:      oklch(42% 0.012 200);
  --color-ink-3:      oklch(49% 0.010 200);
  --color-accent:     oklch(49% 0.135 200);
  --color-accent-ink: oklch(99% 0.002 200);
  --color-rule:       oklch(80% 0.008 200);
  --color-focus:      oklch(55% 0.150 200);
  --color-danger:     oklch(56% 0.170 25);
  --color-warn:       oklch(55% 0.130 70);
  --color-ok:         oklch(53% 0.120 150);

  /* Diagram-specific surfaces */
  --color-canvas:     oklch(95% 0.005 200);
  --color-node:       oklch(99% 0.002 200);
  --color-node-brdr:  oklch(62% 0.010 200);
  --color-edge:       oklch(62% 0.012 200);
  --color-edge-back:  oklch(63% 0.100 300);

  /* Type */
  --font-display: 'Geist', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-body:    'Geist', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-mono:    'Geist Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;

  --text-xs: 0.75rem;  --text-sm: 0.875rem; --text-base: 1rem;
  --text-lg: 1.125rem; --text-xl: 1.375rem; --text-2xl: 1.75rem;
  --text-3xl: 2.25rem; --text-4xl: 3rem;
  --text-display-s: clamp(2.25rem, 4vw + 0.5rem, 3.5rem);
  --text-display:   clamp(3rem, 6vw + 1rem, 6rem);

  /* 4pt space scale */
  --space-2xs: 0.25rem; --space-xs: 0.5rem;  --space-sm: 0.75rem;
  --space-md: 1rem;     --space-lg: 1.5rem;  --space-xl: 2.5rem;
  --space-2xl: 4rem;    --space-3xl: 6rem;

  --radius-sm: 4px; --radius-md: 8px; --radius-lg: 14px; --radius-pill: 999px;
  --rule-hair: 1px;

  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in: cubic-bezier(0.7, 0, 0.84, 0);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --dur-fast: 140ms; --dur-mid: 180ms;

  /* Night-only; neutralized in Day so the anti-pattern cannot appear */
  --bloom-1: transparent;
  --bloom-2: transparent;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --color-paper:      oklch(16% 0.018 240);
    --color-paper-2:    oklch(21% 0.020 240);
    --color-paper-3:    oklch(26% 0.022 240);
    --color-ink:        oklch(95% 0.006 200);
    --color-ink-2:      oklch(78% 0.008 200);
    --color-ink-3:      oklch(64% 0.010 200);
    --color-accent:     oklch(74% 0.135 200);
    --color-accent-ink: oklch(16% 0.018 240);
    --color-rule:       oklch(38% 0.016 240);
    --color-focus:      oklch(78% 0.140 200);
    --color-danger:     oklch(70% 0.150 25);
    --color-warn:       oklch(78% 0.120 70);
    --color-ok:         oklch(74% 0.110 150);

    --color-canvas:     oklch(13% 0.016 240);
    --color-node:       oklch(20% 0.020 240);
    --color-node-brdr:  oklch(50% 0.018 240);
    --color-edge:       oklch(55% 0.014 220);
    --color-edge-back:  oklch(66% 0.110 300);

    /* Atmospheric allows up to two fixed radial blooms, never animated */
    --bloom-1: oklch(40% 0.090 200 / 0.28);
    --bloom-2: oklch(38% 0.070 300 / 0.20);
  }
}

:root[data-theme="dark"] {
  --color-paper:      oklch(16% 0.018 240);
  --color-paper-2:    oklch(21% 0.020 240);
  --color-paper-3:    oklch(26% 0.022 240);
  --color-ink:        oklch(95% 0.006 200);
  --color-ink-2:      oklch(78% 0.008 200);
  --color-ink-3:      oklch(64% 0.010 200);
  --color-accent:     oklch(74% 0.135 200);
  --color-accent-ink: oklch(16% 0.018 240);
  --color-rule:       oklch(38% 0.016 240);
  --color-focus:      oklch(78% 0.140 200);
  --color-danger:     oklch(70% 0.150 25);
  --color-warn:       oklch(78% 0.120 70);
  --color-ok:         oklch(74% 0.110 150);
  --color-canvas:     oklch(13% 0.016 240);
  --color-node:       oklch(20% 0.020 240);
  --color-node-brdr:  oklch(50% 0.018 240);
  --color-edge:       oklch(55% 0.014 220);
  --color-edge-back:  oklch(66% 0.110 300);
  --bloom-1: oklch(40% 0.090 200 / 0.28);
  --bloom-2: oklch(38% 0.070 300 / 0.20);
}
```

- [ ] **Step 8: Write `globals.css`**

Create `src/styles/globals.css`:

```css
@import "tailwindcss";
@import "./tokens.css";

@theme inline {
  --color-paper: var(--color-paper);
  --color-ink: var(--color-ink);
  --color-accent: var(--color-accent);
  --font-display: var(--font-display);
  --font-body: var(--font-body);
  --font-mono: var(--font-mono);
}

html, body { overflow-x: clip; }

body {
  background-color: var(--color-paper);
  color: var(--color-ink);
  font-family: var(--font-body);
  /* Two fixed blooms; transparent in Day so nothing renders there */
  background-image:
    radial-gradient(ellipse 70% 50% at 15% 0%, var(--bloom-1), transparent 70%),
    radial-gradient(ellipse 60% 45% at 85% 15%, var(--bloom-2), transparent 70%);
  background-attachment: fixed;
  background-repeat: no-repeat;
}

*:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
  /* never animated — Hallmark rule */
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 150ms !important;
    transition-property: opacity !important;
  }
}

/* Display headers must wrap inside long words (gate 51) */
h1, h2, h3 { overflow-wrap: anywhere; min-width: 0; font-style: normal; }
```

- [ ] **Step 9: Add the pre-paint theme script**

Create `src/components/ThemeScript.tsx`. This runs before first paint to avoid a flash:

```tsx
import { THEME_STORAGE_KEY } from '@/lib/theme';

export function ThemeScript() {
  const js = `
(function(){
  try {
    var p = localStorage.getItem('${THEME_STORAGE_KEY}') || 'system';
    var d = p === 'dark' || (p === 'system' &&
      (!window.matchMedia || window.matchMedia('(prefers-color-scheme: dark)').matches));
    if (p !== 'system') document.documentElement.setAttribute('data-theme', d ? 'dark' : 'light');
  } catch (e) {}
})();`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}
```

Wire it into `src/app/layout.tsx` inside `<head>`, import `globals.css`, and load the fonts
so `--font-display` / `--font-mono` resolve to real faces:

```tsx
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import '@/styles/globals.css';
import { ThemeScript } from '@/components/ThemeScript';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head><ThemeScript /></head>
      <body>{children}</body>
    </html>
  );
}
```

Then point the tokens at the CSS variables the package defines, replacing the bare
family names in `tokens.css`:

```css
  --font-display: var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif;
  --font-body:    var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif;
  --font-mono:    var(--font-geist-mono), ui-monospace, 'SF Mono', Menlo, monospace;
```

- [ ] **Step 10: Verify both themes render**

Run: `pnpm dev`, open `http://localhost:3000`.
Expected: dark background by default. In devtools, set `data-theme="light"` on `<html>` → light palette, and **no bloom visible**.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js app with Hallmark Aurora tokens, both themes"
```

---

## Task 2: Supabase schema, RLS, and negative-path tests

**Files:**
- Create: `supabase/migrations/0001_init.sql`, `supabase/migrations/0002_rls.sql`
- Create: `src/lib/supabase/{client,server,middleware}.ts`, `src/middleware.ts`
- Test: `tests/rls.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `createBrowserClient()`, `createServerClient()`, `createServiceClient()`. Table names and columns used by every later task.

- [ ] **Step 1: Install dependencies and start Supabase locally**

```bash
pnpm add @supabase/supabase-js @supabase/ssr
pnpm add -D supabase
pnpm dlx supabase init
pnpm dlx supabase start   # prints local URL + anon/service keys
```

Copy the printed values into `.env.local` as `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

- [ ] **Step 2: Write the schema migration**

Create `supabase/migrations/0001_init.sql`:

```sql
create extension if not exists "pgcrypto";

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  theme_pref text not null default 'system'
    check (theme_pref in ('dark','light','system')),
  created_at timestamptz not null default now()
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled',
  language text not null default 'python'
    check (language in ('cpp','java','python')),
  current_snapshot_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_user_id_idx on projects(user_id, updated_at desc);

create table snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  source text not null,
  language text not null check (language in ('cpp','java','python')),
  status text not null default 'queued'
    check (status in ('queued','parsing','ready','failed')),
  error text,
  created_at timestamptz not null default now()
);
create index snapshots_project_idx on snapshots(project_id, created_at desc);

alter table projects
  add constraint projects_current_snapshot_fk
  foreign key (current_snapshot_id) references snapshots(id) on delete set null;

create table graphs (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null unique references snapshots(id) on delete cascade,
  ir jsonb not null,
  layout jsonb not null,
  ir_version int not null,
  created_at timestamptz not null default now()
);

create table layout_overrides (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  node_id text not null,
  x double precision not null,
  y double precision not null,
  collapsed boolean not null default false,
  orphaned_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (project_id, node_id)
);
create index layout_overrides_project_idx on layout_overrides(project_id);

create table annotations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  node_id text,
  body text not null,
  x double precision not null,
  y double precision not null,
  created_at timestamptz not null default now()
);

-- Auto-create a profile row on signup
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

- [ ] **Step 3: Write the RLS migration**

Create `supabase/migrations/0002_rls.sql`. Every table is owner-scoped through `projects.user_id`:

```sql
alter table profiles          enable row level security;
alter table projects          enable row level security;
alter table snapshots         enable row level security;
alter table graphs            enable row level security;
alter table layout_overrides  enable row level security;
alter table annotations       enable row level security;

create policy profiles_own on profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

create policy projects_own on projects
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Helper: does the caller own this project?
create function public.owns_project(pid uuid) returns boolean
language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.projects p
    where p.id = pid and p.user_id = auth.uid()
  );
$$;

create policy snapshots_own on snapshots
  for all using (public.owns_project(project_id))
  with check (public.owns_project(project_id));

create policy graphs_own on graphs
  for all using (exists (
    select 1 from snapshots s
    where s.id = graphs.snapshot_id and public.owns_project(s.project_id)
  ))
  with check (exists (
    select 1 from snapshots s
    where s.id = graphs.snapshot_id and public.owns_project(s.project_id)
  ));

create policy layout_overrides_own on layout_overrides
  for all using (public.owns_project(project_id))
  with check (public.owns_project(project_id));

create policy annotations_own on annotations
  for all using (public.owns_project(project_id))
  with check (public.owns_project(project_id));
```

- [ ] **Step 4: Apply the migrations**

Run: `pnpm dlx supabase db reset`
Expected: both migrations apply with no error.

- [ ] **Step 5: Write the Supabase client factories**

Create `src/lib/supabase/client.ts`:

```ts
import { createBrowserClient as create } from '@supabase/ssr';

export function createBrowserClient() {
  return create(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

Create `src/lib/supabase/server.ts`:

```ts
import { createServerClient as create } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

export async function createServerClient() {
  const store = await cookies();
  return create(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch { /* called from a Server Component — middleware refreshes instead */ }
        },
      },
    },
  );
}

/** Service-role client. NEVER import this into a client component. */
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
```

- [ ] **Step 6: Write the failing RLS test**

Create `tests/rls.test.ts`. This is the negative-path test the spec requires — positive-only auth tests are how leaks ship:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function makeUser(email: string) {
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
  await admin.auth.admin.createUser({
    email, password: 'test-password-123', email_confirm: true,
  });
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({
    email, password: 'test-password-123',
  });
  if (error) throw error;
  return { client, userId: data.user!.id };
}

describe('RLS isolation', () => {
  let a: { client: SupabaseClient; userId: string };
  let b: { client: SupabaseClient; userId: string };
  let projectA: string;

  beforeAll(async () => {
    a = await makeUser(`a-${Date.now()}@test.local`);
    b = await makeUser(`b-${Date.now()}@test.local`);
    const { data, error } = await a.client
      .from('projects').insert({ user_id: a.userId, title: 'A project' })
      .select('id').single();
    if (error) throw error;
    projectA = data.id;
  });

  it("user B cannot read user A's project", async () => {
    const { data } = await b.client.from('projects').select('*').eq('id', projectA);
    expect(data).toEqual([]);
  });

  it("user B cannot write a snapshot into user A's project", async () => {
    const { error } = await b.client.from('snapshots')
      .insert({ project_id: projectA, source: 'x=1', language: 'python' });
    expect(error).not.toBeNull();
  });

  it("user B cannot write a layout override into user A's project", async () => {
    const { error } = await b.client.from('layout_overrides')
      .insert({ project_id: projectA, node_id: 'fake#b0', x: 0, y: 0 });
    expect(error).not.toBeNull();
  });

  it("user B cannot delete user A's project", async () => {
    await b.client.from('projects').delete().eq('id', projectA);
    const { data } = await a.client.from('projects').select('id').eq('id', projectA);
    expect(data).toHaveLength(1);   // still there
  });

  it('user A can read their own project', async () => {
    const { data } = await a.client.from('projects').select('id').eq('id', projectA);
    expect(data).toHaveLength(1);
  });
});
```

- [ ] **Step 7: Run the RLS test**

Run: `pnpm vitest run tests/rls.test.ts`
Expected: PASS (5 tests). If any negative test **passes when it should fail**, the RLS policy is wrong — fix `0002_rls.sql`, `db reset`, re-run. Do not proceed with a failing isolation test.

- [ ] **Step 8: Add auth middleware**

Create `src/lib/supabase/middleware.ts` and `src/middleware.ts` to refresh the session cookie and redirect unauthenticated users away from `/projects`:

```ts
// src/middleware.ts
import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|woff2)$).*)'],
};
```

```ts
// src/lib/supabase/middleware.ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user && request.nextUrl.pathname.startsWith('/projects')) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  return response;
}
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: Supabase schema with RLS and negative-path isolation tests"
```

---

## Task 3: IR types and structural IDs

**Files:**
- Create: `src/lib/ir/types.ts`, `src/lib/ir/ids.ts`
- Test: `src/lib/ir/ids.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: all types from Spec §5 (`NodeKind`, `EdgeKind`, `IRNode`, `IREdge`, `FunctionGraph`, `ProgramIR`, `Diagnostic`), plus:
  - `class IdBuilder` with `enter(kind: string): string`, `exit(): void`, `block(role?: string): string`, `path(): string`
  - `makeNodeId(functionId: string, structuralPath: string, role: string): string`

- [ ] **Step 1: Write the IR types**

Create `src/lib/ir/types.ts`:

```ts
export const IR_VERSION = 1;

export type Language = 'cpp' | 'java' | 'python';

export type NodeKind =
  | 'entry' | 'exit' | 'basic' | 'branch' | 'loop-header'
  | 'switch' | 'return' | 'throw' | 'call-site';

export type EdgeKind =
  | 'seq' | 'true' | 'false' | 'case' | 'default'
  | 'back' | 'break' | 'continue' | 'exception' | 'call';

export type LoopKind = 'while' | 'for' | 'do-while' | 'foreach';

export interface Span { startLine: number; endLine: number }  // 1-based, inclusive

export interface IRNode {
  id: string;
  kind: NodeKind;
  label: string;
  statements: string[];
  span: Span;
  meta?: { loopKind?: LoopKind; caseValue?: string; unsupported?: string };
}

export interface IREdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  label?: string;
}

export interface FunctionGraph {
  id: string;
  name: string;
  params: string[];
  nodes: IRNode[];
  edges: IREdge[];
  entryId: string;
  exitIds: string[];
}

export interface Diagnostic {
  severity: 'error' | 'warning';
  message: string;
  span: Span;
}

export interface CallEdge { from: string; to: string; nodeId: string }

export interface ProgramIR {
  language: Language;
  functions: FunctionGraph[];
  callEdges: CallEdge[];
  diagnostics: Diagnostic[];
  irVersion: number;
}
```

- [ ] **Step 2: Write the failing ID test**

Create `src/lib/ir/ids.test.ts`. These tests encode Spec §6's consequences table as executable spec:

```ts
import { describe, it, expect } from 'vitest';
import { IdBuilder, makeNodeId } from './ids';

describe('makeNodeId', () => {
  it('composes function, path, and role', () => {
    expect(makeNodeId('binarySearch(int*,int)', 'while@0/if@1/then', 'b0'))
      .toBe('binarySearch(int*,int)/while@0/if@1/then#b0');
  });

  it('handles an empty path (function-level block)', () => {
    expect(makeNodeId('main()', '', 'b0')).toBe('main()#b0');
  });
});

describe('IdBuilder', () => {
  it('indexes same-kind siblings independently in a scope', () => {
    const b = new IdBuilder('f()');
    b.enter('if');            // if@0
    b.exit();
    b.enter('if');            // if@1
    b.exit();
    b.enter('while');         // while@0 — separate counter per kind
    expect(b.path()).toBe('while@0');
    b.exit();
  });

  it('nests paths and resets child counters per scope', () => {
    const b = new IdBuilder('f()');
    b.enter('while');                     // while@0
    b.enter('if');                        // while@0/if@0
    expect(b.path()).toBe('while@0/if@0');
    b.exit();
    b.exit();
    b.enter('if');                        // if@0 at top level — not if@1
    expect(b.path()).toBe('if@0');
  });

  it('numbers blocks sequentially within the current scope', () => {
    const b = new IdBuilder('f()');
    expect(b.block()).toBe('f()#b0');
    expect(b.block()).toBe('f()#b1');
    b.enter('if');
    expect(b.block('then')).toBe('f()/if@0#then-b0');
  });

  // --- Spec sec.6 consequences, as tests ---

  it('SURVIVES: editing statements inside a block keeps the same ids', () => {
    const ids = (stmtCount: number) => {
      const b = new IdBuilder('f()');
      const out: string[] = [];
      b.enter('while');
      for (let i = 0; i < stmtCount; i++) out.push(b.block());
      b.exit();
      return out[0];
    };
    // more statements in the same block does not change the first block's id
    expect(ids(1)).toBe(ids(5));
  });

  it('SHIFTS: inserting a structure before another re-indexes the later one', () => {
    const withoutLeading = new IdBuilder('f()');
    withoutLeading.enter('while');
    const before = withoutLeading.path();

    const withLeading = new IdBuilder('f()');
    withLeading.enter('while'); withLeading.exit();   // a new leading while
    withLeading.enter('while');
    const after = withLeading.path();

    expect(before).toBe('while@0');
    expect(after).toBe('while@1');   // documented, expected shift
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test src/lib/ir/ids.test.ts`
Expected: FAIL — "Failed to resolve import ./ids"

- [ ] **Step 4: Implement the ID builder**

Create `src/lib/ir/ids.ts`:

```ts
export function makeNodeId(functionId: string, structuralPath: string, role: string): string {
  return structuralPath
    ? `${functionId}/${structuralPath}#${role}`
    : `${functionId}#${role}`;
}

interface Scope {
  /** kind -> next index, for sibling numbering within this scope */
  counters: Map<string, number>;
  /** next block ordinal within this scope */
  blockOrdinal: number;
  /** this scope's own path segment, e.g. 'while@0' */
  segment: string;
}

/**
 * Builds structural node ids as a CFG is walked.
 *
 * Ids are deliberately position-dependent among same-kind siblings:
 * editing statements inside a block preserves ids (layout survives), while
 * inserting or reordering control structures re-indexes later siblings.
 * See spec sec.6 for the full consequences table.
 */
export class IdBuilder {
  private stack: Scope[];

  constructor(private readonly functionId: string) {
    this.stack = [{ counters: new Map(), blockOrdinal: 0, segment: '' }];
  }

  /** Enter a control structure, allocating its sibling index. */
  enter(kind: string): string {
    const parent = this.stack[this.stack.length - 1];
    const index = parent.counters.get(kind) ?? 0;
    parent.counters.set(kind, index + 1);
    this.stack.push({
      counters: new Map(),
      blockOrdinal: 0,
      segment: `${kind}@${index}`,
    });
    return this.path();
  }

  exit(): void {
    if (this.stack.length === 1) throw new Error('IdBuilder: unbalanced exit()');
    this.stack.pop();
  }

  /** The current structural path, e.g. 'while@0/if@1'. */
  path(): string {
    return this.stack.map((s) => s.segment).filter(Boolean).join('/');
  }

  /** Allocate a block id in the current scope. `role` prefixes branch arms. */
  block(role?: string): string {
    const scope = this.stack[this.stack.length - 1];
    const ordinal = scope.blockOrdinal++;
    const suffix = role ? `${role}-b${ordinal}` : `b${ordinal}`;
    return makeNodeId(this.functionId, this.path(), suffix);
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/lib/ir/ids.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Add the IR isolation lint rule**

Add to `eslint.config.mjs` — this enforces the Global Constraint that `src/lib/ir/` stays portable:

```js
{
  files: ['src/lib/ir/**/*.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [
        { group: ['react', 'react-*', 'next', 'next/*', '@/components/*'],
          message: 'src/lib/ir must stay portable: it runs in a worker AND in a Node job. No React/Next imports.' },
      ],
    }],
  },
},
```

- [ ] **Step 7: Verify the lint rule fires**

Temporarily add `import { useState } from 'react';` to `src/lib/ir/ids.ts`, then run `pnpm lint`.
Expected: error "src/lib/ir must stay portable". **Remove the import.**

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: IR types and structural node ids with layout-stability tests"
```

---

## Task 4: CFG builder core (language-agnostic, no WASM)

The builder is tested against a hand-written syntax tree so its logic is proven *before* any
grammar is involved. This keeps the hardest logic in fast, deterministic unit tests.

**Files:**
- Create: `src/lib/ir/builder.ts`
- Test: `src/lib/ir/builder.test.ts`

**Interfaces:**
- Consumes: `IdBuilder`, `makeNodeId` (Task 3); all types from `types.ts` (Task 3).
- Produces:
  - `interface SynNode { kind: SynKind; children: SynNode[]; span: Span; text: string; meta?: {...} }`
  - `type SynKind = 'func' | 'stmt' | 'if' | 'loop' | 'switch' | 'case' | 'return' | 'throw' | 'break' | 'continue' | 'try' | 'goto' | 'label' | 'call'`
  - `buildFunctionGraph(fn: SynNode, functionId: string, name: string, params: string[]): FunctionGraph`
  - `buildProgramIR(funcs: SynFunction[], language: Language, diagnostics: Diagnostic[]): ProgramIR`

`SynNode` is the **normalized** tree each language adapter produces. The builder never sees
tree-sitter types — that is what keeps it language-agnostic and testable.

- [ ] **Step 1: Write the failing builder tests**

Create `src/lib/ir/builder.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildFunctionGraph, type SynNode } from './builder';
import type { FunctionGraph, EdgeKind } from './types';

/** Test helper — build a normalized syntax node. */
function n(kind: SynNode['kind'], text: string, children: SynNode[] = [],
           meta?: SynNode['meta']): SynNode {
  return { kind, text, children, span: { startLine: 1, endLine: 1 }, meta };
}

function edgeKinds(g: FunctionGraph): EdgeKind[] {
  return g.edges.map((e) => e.kind).sort();
}
function kindsOf(g: FunctionGraph) {
  return g.nodes.map((x) => x.kind).sort();
}
/** Follow an edge of a given kind out of a node. */
function via(g: FunctionGraph, from: string, kind: EdgeKind) {
  const e = g.edges.find((x) => x.source === from && x.kind === kind);
  if (!e) throw new Error(`no ${kind} edge out of ${from}. edges: ${JSON.stringify(g.edges)}`);
  return g.nodes.find((x) => x.id === e.target)!;
}

describe('buildFunctionGraph — straight line', () => {
  it('collapses consecutive statements into ONE basic block', () => {
    const fn = n('func', 'f', [
      n('stmt', 'lo = 0'), n('stmt', 'hi = n - 1'), n('stmt', 'mid = 0'),
    ]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    const basics = g.nodes.filter((x) => x.kind === 'basic');
    expect(basics).toHaveLength(1);
    expect(basics[0].statements).toEqual(['lo = 0', 'hi = n - 1', 'mid = 0']);
  });

  it('always has an entry and at least one exit', () => {
    const g = buildFunctionGraph(n('func', 'f', [n('stmt', 'x = 1')]), 'f()', 'f', []);
    expect(g.nodes.find((x) => x.id === g.entryId)!.kind).toBe('entry');
    expect(g.exitIds.length).toBeGreaterThanOrEqual(1);
  });
});

describe('buildFunctionGraph — branches', () => {
  it('emits a branch node with true and false edges', () => {
    const fn = n('func', 'f', [
      // children = then arm ONLY; the else arm travels in meta.elseBody
      n('if', 'x > 0', [n('stmt', 'a = 1')], { elseBody: [n('stmt', 'a = 2')] }),
    ]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    const branch = g.nodes.find((x) => x.kind === 'branch')!;
    expect(branch.label).toBe('x > 0');
    expect(via(g, branch.id, 'true').statements).toEqual(['a = 1']);
    expect(via(g, branch.id, 'false').statements).toEqual(['a = 2']);
  });

  it('keeps a MULTI-statement else arm intact', () => {
    // Regression guard: an earlier design sliced then/else out of one `children` array,
    // which silently moved the extra else statements into the THEN arm.
    const fn = n('func', 'f', [
      n('if', 'x > 0', [n('stmt', 'a = 1')], {
        elseBody: [n('stmt', 'b = 1'), n('stmt', 'b = 2'), n('stmt', 'b = 3')],
      }),
    ]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    const branch = g.nodes.find((x) => x.kind === 'branch')!;
    expect(via(g, branch.id, 'true').statements).toEqual(['a = 1']);
    expect(via(g, branch.id, 'false').statements).toEqual(['b = 1', 'b = 2', 'b = 3']);
  });

  it('an if with no else still emits a false edge (to the join)', () => {
    const fn = n('func', 'f', [
      n('if', 'x > 0', [n('stmt', 'a = 1')]),      // no else arm
      n('stmt', 'after = 1'),
    ]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    const branch = g.nodes.find((x) => x.kind === 'branch')!;
    expect(via(g, branch.id, 'false').statements).toEqual(['after = 1']);
  });
});

describe('buildFunctionGraph — loops', () => {
  it('emits a loop-header with a BACK edge from the body', () => {
    const fn = n('func', 'f', [
      n('loop', 'lo <= hi', [n('stmt', 'lo = lo + 1')], { loopKind: 'while' }),
    ]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    const header = g.nodes.find((x) => x.kind === 'loop-header')!;
    expect(header.meta?.loopKind).toBe('while');
    expect(edgeKinds(g)).toContain('back');
    const back = g.edges.find((e) => e.kind === 'back')!;
    expect(back.target).toBe(header.id);      // back edge returns to the header
  });

  it('break exits the loop; continue returns to the header', () => {
    const fn = n('func', 'f', [
      n('loop', 'true', [
        n('if', 'done', [n('break', 'break')]),
        n('continue', 'continue'),
      ], { loopKind: 'while' }),
      n('stmt', 'after = 1'),
    ]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    const header = g.nodes.find((x) => x.kind === 'loop-header')!;
    const brk = g.edges.find((e) => e.kind === 'break')!;
    const cont = g.edges.find((e) => e.kind === 'continue')!;
    expect(g.nodes.find((x) => x.id === brk.target)!.statements).toEqual(['after = 1']);
    expect(cont.target).toBe(header.id);
  });

  it('do-while puts the body BEFORE the header', () => {
    const fn = n('func', 'f', [
      n('loop', 'x < 3', [n('stmt', 'x = x + 1')], { loopKind: 'do-while' }),
    ]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    const header = g.nodes.find((x) => x.kind === 'loop-header')!;
    const body = g.nodes.find((x) => x.statements[0] === 'x = x + 1')!;
    // entry flows into the body first, not the header
    expect(g.edges.some((e) => e.source === g.entryId && e.target === body.id)).toBe(true);
    expect(g.edges.some((e) => e.source === body.id && e.target === header.id)).toBe(true);
    // EXACTLY one back edge, header -> body. An earlier version searched all nodes for the
    // body and found the function ENTRY, emitting a bogus header -> entry edge.
    expect(g.edges.filter((e) => e.kind === 'back'))
      .toEqual([expect.objectContaining({ source: header.id, target: body.id })]);
  });

  it('python for/while ELSE runs on exhaustion, not on break', () => {
    const fn = n('func', 'f', [
      n('loop', 'i in xs', [n('stmt', 'body = 1')],
        { loopKind: 'foreach', elseBody: [n('stmt', 'ran_to_end = 1')] }),
      n('stmt', 'after = 1'),
    ]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    const header = g.nodes.find((x) => x.kind === 'loop-header')!;
    // exhaustion (false edge) reaches the else body, NOT 'after'
    expect(via(g, header.id, 'false').statements).toEqual(['ran_to_end = 1']);
  });
});

describe('buildFunctionGraph — switch fallthrough (spec sec.5.1)', () => {
  it('a case WITHOUT break falls through to the next case body', () => {
    const fn = n('func', 'f', [
      n('switch', 'v', [
        n('case', '1', [n('stmt', 'a = 1')], { caseValue: '1' }),          // no break
        n('case', '2', [n('stmt', 'b = 2'), n('break', 'break')], { caseValue: '2' }),
      ]),
    ]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    const caseOne = g.nodes.find((x) => x.statements[0] === 'a = 1')!;
    const caseTwo = g.nodes.find((x) => x.statements[0] === 'b = 2')!;
    // implicit fallthrough edge
    expect(g.edges.some((e) => e.source === caseOne.id && e.target === caseTwo.id)).toBe(true);
    expect(g.nodes.some((x) => x.kind === 'switch')).toBe(true);
  });

  it('emits exactly ONE default edge when a default arm exists', () => {
    const fn = n('func', 'f', [
      n('switch', 'v', [
        n('case', '1', [n('stmt', 'a = 1'), n('break', 'break')], { caseValue: '1' }),
        n('case', 'default', [n('stmt', 'd = 1')], { isDefault: true }),
      ]),
    ]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    // No phantom "no match" bypass edge on top of the real default arm.
    expect(g.edges.filter((e) => e.kind === 'default')).toHaveLength(1);
  });

  it('a continue inside a case targets the enclosing LOOP, not the switch', () => {
    const fn = n('func', 'f', [
      n('loop', 'more', [
        n('switch', 'v', [
          n('case', '1', [n('continue', 'continue')], { caseValue: '1' }),
        ]),
      ], { loopKind: 'while' }),
    ]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    const header = g.nodes.find((x) => x.kind === 'loop-header')!;
    const cont = g.edges.find((e) => e.kind === 'continue')!;
    expect(cont.target).toBe(header.id);   // NOT the switch discriminant
  });
});

describe('buildFunctionGraph — labeled break (spec sec.5.3)', () => {
  it('a labeled break exits the LABELED loop, not the innermost one', () => {
    const fn = n('func', 'f', [
      n('loop', 'outer cond', [
        n('loop', 'inner cond', [
          n('break', 'break outer', [], { label: 'outer' }),
        ], { loopKind: 'while' }),
      ], { loopKind: 'while', label: 'outer' }),
      n('stmt', 'after = 1'),
    ]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    const brk = g.edges.find((e) => e.kind === 'break')!;
    // must land after the OUTER loop
    expect(g.nodes.find((x) => x.id === brk.target)!.statements).toEqual(['after = 1']);
  });
});

describe('buildFunctionGraph — returns and finally', () => {
  it('collects multiple returns into exitIds', () => {
    const fn = n('func', 'f', [
      n('if', 'x', [n('return', 'return 1')], { elseBody: [n('return', 'return 2')] }),
    ]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    expect(g.nodes.filter((x) => x.kind === 'return')).toHaveLength(2);
    expect(g.exitIds.length).toBeGreaterThanOrEqual(2);
  });

  it('finally is reachable from a return inside try (spec sec.5.4)', () => {
    const fn = n('func', 'f', [
      n('try', 'try', [n('return', 'return 1')], { finallyBody: [n('stmt', 'cleanup()')] }),
    ]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    const ret = g.nodes.find((x) => x.kind === 'return')!;
    const cleanup = g.nodes.find((x) => x.statements[0] === 'cleanup()')!;
    expect(g.edges.some((e) => e.source === ret.id && e.target === cleanup.id)).toBe(true);
  });

  it('walks one handler per except clause, and never emits an empty edge source', () => {
    const fn = n('func', 'f', [
      n('try', 'try', [n('stmt', 'risky()')], {
        catchBodies: [
          [n('stmt', 'h1a = 1'), n('stmt', 'h1b = 2')],   // handler 1, two statements
          [n('stmt', 'h2a = 1'), n('stmt', 'h2b = 2')],   // handler 2, two statements
        ],
      }),
    ]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    // two handlers -> two exception edges (not one per statement)
    expect(g.edges.filter((e) => e.kind === 'exception')).toHaveLength(2);
    expect(g.edges.every((e) => e.source !== '' && e.target !== '')).toBe(true);
  });
});

describe('buildFunctionGraph — determinism', () => {
  it('produces identical output for identical input', () => {
    const make = () => n('func', 'f', [
      n('loop', 'c', [n('if', 'd', [n('stmt', 's')])], { loopKind: 'while' }),
    ]);
    const a = buildFunctionGraph(make(), 'f()', 'f', []);
    const b = buildFunctionGraph(make(), 'f()', 'f', []);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/lib/ir/builder.test.ts`
Expected: FAIL — "Failed to resolve import ./builder"

- [ ] **Step 3: Implement the builder**

Create `src/lib/ir/builder.ts`:

```ts
import { IdBuilder } from './ids';
import {
  IR_VERSION, type Diagnostic, type FunctionGraph, type IREdge, type IRNode,
  type Language, type LoopKind, type ProgramIR, type Span,
} from './types';

export type SynKind =
  | 'func' | 'stmt' | 'if' | 'loop' | 'switch' | 'case' | 'return' | 'throw'
  | 'break' | 'continue' | 'try' | 'goto' | 'label' | 'call';

export interface SynNode {
  kind: SynKind;
  text: string;
  children: SynNode[];
  span: Span;
  meta?: {
    loopKind?: LoopKind;
    label?: string;          // loop label, or the target of a labeled break
    caseValue?: string;
    isDefault?: boolean;     // switch/match default arm — never infer from a missing caseValue
    /** `if`: the else arm. `loop`: python for/while else. `children` is ONLY the then arm. */
    elseBody?: SynNode[];
    finallyBody?: SynNode[];
    /** One array PER handler. Flattening loses handler boundaries. */
    catchBodies?: SynNode[][];
    unsupported?: string;
  };

// There is deliberately no `hasElse` flag: an else arm is present exactly when
// `meta.elseBody` is non-empty. A boolean plus a slice of `children` was the earlier
// design and it mis-split any else arm with more than one statement.
}

export interface SynFunction {
  node: SynNode;
  id: string;
  name: string;
  params: string[];
}

/** A pending edge whose target is not known until the successor is emitted. */
interface Pending { from: string; kind: IREdge['kind']; label?: string }

interface LoopCtx {
  /** 'switch' accepts `break` but must never capture `continue`. */
  ctxKind: 'loop' | 'switch';
  headerId: string;
  label?: string;
  /** edges waiting for the node that follows the loop */
  breaks: Pending[];
  /** where a `continue` should jump */
  continueTarget: string;
}

const SPAN_ZERO: Span = { startLine: 1, endLine: 1 };

class GraphBuilder {
  nodes: IRNode[] = [];
  edges: IREdge[] = [];
  exitIds: string[] = [];
  private ids: IdBuilder;
  private edgeSeq = 0;
  private loops: LoopCtx[] = [];
  /** finally bodies of enclosing try blocks, innermost last */
  private finallies: { entryId: string }[] = [];

  constructor(private readonly functionId: string) {
    this.ids = new IdBuilder(functionId);
  }

  private addNode(node: IRNode): IRNode {
    this.nodes.push(node);
    return node;
  }

  private connect(from: Pending[], to: string): void {
    for (const p of from) {
      this.edges.push({
        id: `e${this.edgeSeq++}`, source: p.from, target: to,
        kind: p.kind, ...(p.label ? { label: p.label } : {}),
      });
    }
  }

  /** Emit a basic block for a run of statements. Returns the pending exits. */
  private emitBlock(stmts: SynNode[], incoming: Pending[], role?: string): Pending[] {
    if (stmts.length === 0) return incoming;
    const node = this.addNode({
      id: this.ids.block(role),
      kind: 'basic',
      label: stmts[0].text,
      statements: stmts.map((s) => s.text),
      span: { startLine: stmts[0].span.startLine, endLine: stmts[stmts.length - 1].span.endLine },
    });
    this.connect(incoming, node.id);
    return [{ from: node.id, kind: 'seq' }];
  }

  /**
   * Walk a statement list, folding consecutive plain statements into blocks
   * and delegating control structures. Returns pending exits of the list.
   *
   * Statements after a `return`/`break`/`continue` are UNREACHABLE. They are still
   * emitted, tagged `meta.unsupported: 'unreachable'`, with no incoming edge — so the
   * canvas can render them dimmed and the learner sees their dead code instead of
   * watching a line they can see in the editor silently vanish from the diagram
   * (spec sec.11, "degrade, never blank"). `pending` is empty at that point, which is
   * precisely what makes the block edgeless.
   */
  walk(list: SynNode[], incoming: Pending[], role?: string): Pending[] {
    let pending = incoming;
    let run: SynNode[] = [];
    /** true once control cannot reach the following statements */
    let unreachable = false;

    const flush = () => {
      if (!run.length) return;
      const before = this.nodes.length;
      pending = this.emitBlock(run, pending, role);
      if (unreachable) {
        const emitted = this.nodes[before];
        if (emitted) emitted.meta = { ...emitted.meta, unsupported: 'unreachable' };
      }
      run = [];
    };

    for (const stmt of list) {
      if (stmt.kind === 'stmt' || stmt.kind === 'call' || stmt.kind === 'label') {
        run.push(stmt);
        continue;
      }
      flush();
      pending = this.control(stmt, pending, role);
      // return / throw / break / continue all return [] — nothing downstream is reachable
      if (pending.length === 0) unreachable = true;
    }
    flush();
    return pending;
  }

  private control(stmt: SynNode, incoming: Pending[], role?: string): Pending[] {
    switch (stmt.kind) {
      case 'if':        return this.ifStmt(stmt, incoming);
      case 'loop':      return this.loopStmt(stmt, incoming);
      case 'switch':    return this.switchStmt(stmt, incoming);
      case 'try':       return this.tryStmt(stmt, incoming);
      case 'return':    return this.returnStmt(stmt, incoming);
      case 'throw':     return this.throwStmt(stmt, incoming);
      case 'break':     return this.breakStmt(stmt, incoming);
      case 'continue':  return this.continueStmt(stmt, incoming);
      default:          return this.emitBlock([stmt], incoming, role);
    }
  }

  private ifStmt(stmt: SynNode, incoming: Pending[]): Pending[] {
    this.ids.enter('if');
    const branch = this.addNode({
      id: this.ids.block('cond'), kind: 'branch',
      label: stmt.text, statements: [stmt.text], span: stmt.span,
    });
    this.connect(incoming, branch.id);

    // `children` is the then arm; the else arm arrives separately. Never slice them apart.
    const elseBody = stmt.meta?.elseBody ?? [];
    const thenOut = this.walk(stmt.children, [{ from: branch.id, kind: 'true', label: 'true' }], 'then');
    const elseOut = elseBody.length
      ? this.walk(elseBody, [{ from: branch.id, kind: 'false', label: 'false' }], 'else')
      : [{ from: branch.id, kind: 'false' as const, label: 'false' }];

    this.ids.exit();
    return [...thenOut, ...elseOut];
  }

  private loopStmt(stmt: SynNode, incoming: Pending[]): Pending[] {
    const kind: LoopKind = stmt.meta?.loopKind ?? 'while';
    // Scope segment carries the loop KIND, so paths read `while@0` / `for@0` as spec sec.6's
    // worked example shows — not a generic `loop@0`.
    this.ids.enter(kind === 'do-while' ? 'do' : kind);

    const header = this.addNode({
      id: this.ids.block('cond'), kind: 'loop-header',
      label: stmt.text, statements: [stmt.text], span: stmt.span,
      meta: { loopKind: kind },
    });

    const ctx: LoopCtx = { ctxKind: 'loop', headerId: header.id, label: stmt.meta?.label,
                           breaks: [], continueTarget: header.id };
    this.loops.push(ctx);

    let bodyOut: Pending[];
    if (kind === 'do-while') {
      // body runs first; header is tested after
      // Remember where the body starts BEFORE walking it. `nodes.find(x => x.id !== header.id)`
      // would return the function entry node and emit a bogus header -> entry edge.
      const bodyStart = this.nodes.length;
      bodyOut = this.walk(stmt.children, incoming, 'body');
      this.connect(bodyOut, header.id);
      const firstBody = this.nodes[bodyStart];
      this.edges.push({ id: `e${this.edgeSeq++}`, source: header.id,
        // an empty body degrades to a self-loop rather than a dangling edge
        target: firstBody ? firstBody.id : header.id, kind: 'back', label: kind });
    } else {
      this.connect(incoming, header.id);
      bodyOut = this.walk(stmt.children, [{ from: header.id, kind: 'true', label: 'true' }], 'body');
      // body returns to the header — this is the back edge
      for (const p of bodyOut) {
        this.edges.push({ id: `e${this.edgeSeq++}`, source: p.from,
          target: header.id, kind: 'back', label: kind });
      }
    }

    this.loops.pop();
    this.ids.exit();

    // Loop exhaustion. Python's for/while ELSE runs here, before the join.
    let exhausted: Pending[] = [{ from: header.id, kind: 'false', label: 'false' }];
    if (stmt.meta?.elseBody?.length) {
      exhausted = this.walk(stmt.meta.elseBody, exhausted, 'loop-else');
    }
    // breaks skip the else clause entirely
    return [...exhausted, ...ctx.breaks];
  }

  private switchStmt(stmt: SynNode, incoming: Pending[]): Pending[] {
    this.ids.enter('switch');
    const sw = this.addNode({
      id: this.ids.block('disc'), kind: 'switch',
      label: stmt.text, statements: [stmt.text], span: stmt.span,
    });
    this.connect(incoming, sw.id);

    // ctxKind 'switch': collects `break`, but `continue` must pass through to the
    // enclosing loop. A switch is not a loop.
    const ctx: LoopCtx = { ctxKind: 'switch', headerId: sw.id, breaks: [], continueTarget: sw.id };
    this.loops.push(ctx);

    const cases = stmt.children.filter((c) => c.kind === 'case');
    const hasDefault = cases.some((c) => c.meta?.isDefault === true);
    /** exits of the previous case body, for implicit fallthrough */
    let fallthrough: Pending[] = [];

    for (const c of cases) {
      const isDefault = c.meta?.isDefault === true;
      const entry: Pending[] = [
        { from: sw.id, kind: isDefault ? 'default' : 'case',
          label: isDefault ? 'default' : `case ${c.meta?.caseValue ?? ''}`.trim() },
        ...fallthrough,        // spec sec.5.1 — implicit fallthrough
      ];
      const role = `case-${isDefault ? 'default' : c.meta?.caseValue ?? ''}`;
      const bodyOut = this.walk(c.children, entry, role);
      fallthrough = c.children.some((x) => x.kind === 'break') ? [] : bodyOut;
    }
    // Only the final case's exits fall out of the switch; every earlier case either
    // broke (collected in ctx.breaks) or fell through into its successor.
    const out = fallthrough;

    this.loops.pop();
    this.ids.exit();
    // Emit a bypass edge ONLY when no default arm exists — otherwise the default arm
    // already covers "no match" and a second edge is a phantom.
    return hasDefault
      ? [...out, ...ctx.breaks]
      : [...out, ...ctx.breaks, { from: sw.id, kind: 'default', label: 'no match' }];
  }

  private tryStmt(stmt: SynNode, incoming: Pending[]): Pending[] {
    this.ids.enter('try');

    // RESERVE the finally id without consuming a block ordinal, but emit the NODE after
    // the body — otherwise adding a finally clause renumbers every block in the try body
    // and destroys saved layout for unrelated nodes.
    let finallyEntry: string | undefined;
    if (stmt.meta?.finallyBody?.length) {
      finallyEntry = makeNodeId(this.functionId, this.ids.path(), 'finally');
      this.finallies.push({ entryId: finallyEntry });
    }

    const tryStart = this.nodes.length;
    const bodyOut = this.walk(stmt.children, incoming, 'try');
    // DOCUMENTED SIMPLIFICATION: an exception is modelled as leaving the try region from
    // its ENTRY node, not from every node inside it. A precise model would add an edge
    // from each statement that can throw, which for most languages is nearly all of them
    // and renders as a hairball. Recorded in spec sec.5.4.
    const tryEntry = this.nodes[tryStart]?.id;

    const catchOuts: Pending[] = [];
    if (tryEntry) {
      // One walk per HANDLER. catchBodies is SynNode[][] precisely so handler
      // boundaries survive — flattening produced one pseudo-handler per statement.
      for (const handler of stmt.meta?.catchBodies ?? []) {
        catchOuts.push(...this.walk(handler,
          [{ from: tryEntry, kind: 'exception', label: 'exception' }], 'catch'));
      }
    }

    if (finallyEntry) {
      const fb = stmt.meta!.finallyBody!;
      this.addNode({
        id: finallyEntry, kind: 'basic', label: fb[0].text,
        statements: fb.map((x) => x.text), span: fb[0].span,
      });
      this.finallies.pop();
      this.connect([...bodyOut, ...catchOuts], finallyEntry);
      this.ids.exit();
      return [{ from: finallyEntry, kind: 'seq' }];
    }
    this.ids.exit();
    return [...bodyOut, ...catchOuts];
  }

  private returnStmt(stmt: SynNode, incoming: Pending[]): Pending[] {
    const node = this.addNode({
      id: this.ids.block('return'), kind: 'return',
      label: stmt.text, statements: [stmt.text], span: stmt.span,
    });
    this.connect(incoming, node.id);
    // A return inside try must still run finally (spec sec.5.4)
    const fin = this.finallies[this.finallies.length - 1];
    if (fin) {
      this.edges.push({ id: `e${this.edgeSeq++}`, source: node.id,
        target: fin.entryId, kind: 'seq', label: 'finally' });
    } else {
      this.exitIds.push(node.id);
    }
    return [];   // control does not continue past a return
  }

  private throwStmt(stmt: SynNode, incoming: Pending[]): Pending[] {
    const node = this.addNode({
      id: this.ids.block('throw'), kind: 'throw',
      label: stmt.text, statements: [stmt.text], span: stmt.span,
    });
    this.connect(incoming, node.id);
    this.exitIds.push(node.id);
    return [];
  }

  private breakStmt(stmt: SynNode, incoming: Pending[]): Pending[] {
    const label = stmt.meta?.label;
    // spec sec.5.3 — a labeled break targets the LABELED loop
    const target = label
      ? [...this.loops].reverse().find((l) => l.label === label)
      : this.loops[this.loops.length - 1];
    if (!target) return incoming;   // malformed source; degrade rather than throw

    const node = this.addNode({
      id: this.ids.block('break'), kind: 'basic',
      label: stmt.text, statements: [stmt.text], span: stmt.span,
    });
    this.connect(incoming, node.id);
    target.breaks.push({ from: node.id, kind: 'break', label: label ? `break ${label}` : 'break' });
    return [];
  }

  private continueStmt(stmt: SynNode, incoming: Pending[]): Pending[] {
    const label = stmt.meta?.label;
    // `continue` binds to the innermost enclosing LOOP, never to a switch in between.
    const loopsOnly = [...this.loops].reverse().filter((l) => l.ctxKind === 'loop');
    const target = label ? loopsOnly.find((l) => l.label === label) : loopsOnly[0];
    if (!target) return incoming;

    const node = this.addNode({
      id: this.ids.block('continue'), kind: 'basic',
      label: stmt.text, statements: [stmt.text], span: stmt.span,
    });
    this.connect(incoming, node.id);
    this.edges.push({ id: `e${this.edgeSeq++}`, source: node.id,
      target: target.continueTarget, kind: 'continue', label: 'continue' });
    return [];
  }

  finish(): { nodes: IRNode[]; edges: IREdge[]; exitIds: string[] } {
    return { nodes: this.nodes, edges: this.edges, exitIds: this.exitIds };
  }
}

export function buildFunctionGraph(
  fn: SynNode, functionId: string, name: string, params: string[],
): FunctionGraph {
  const b = new GraphBuilder(functionId);
  const entry: IRNode = {
    id: `${functionId}#entry`, kind: 'entry',
    label: `${name}(${params.join(', ')})`, statements: [], span: fn.span,
  };
  b.nodes.push(entry);

  const out = b.walk(fn.children, [{ from: entry.id, kind: 'seq' }]);

  // Any control still pending falls off the end — that is an implicit exit.
  const { nodes, edges, exitIds } = b.finish();
  if (out.length) {
    const exit: IRNode = {
      id: `${functionId}#exit`, kind: 'exit', label: 'end',
      statements: [], span: { startLine: fn.span.endLine, endLine: fn.span.endLine },
    };
    nodes.push(exit);
    for (const p of out) {
      edges.push({ id: `e-exit-${edges.length}`, source: p.from, target: exit.id,
        kind: p.kind, ...(p.label ? { label: p.label } : {}) });
    }
    exitIds.push(exit.id);
  }

  return { id: functionId, name, params, nodes, edges, entryId: entry.id,
           exitIds: exitIds.length ? exitIds : [entry.id] };
}

export function buildProgramIR(
  funcs: SynFunction[], language: Language, diagnostics: Diagnostic[],
): ProgramIR {
  const functions = funcs.map((f) => buildFunctionGraph(f.node, f.id, f.name, f.params));

  // Call edges: a call whose text names a known function links the two subgraphs.
  // Resolve by name but REFUSE to guess when a name is ambiguous — a wrong call edge is
  // worse than a missing one.
  const byName = new Map<string, string[]>();
  for (const f of functions) {
    const ids = byName.get(f.name) ?? [];
    ids.push(f.id);
    byName.set(f.name, ids);
  }

  const CALL_RE = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;   // /g is required by matchAll
  const seen = new Set<string>();
  const callEdges: CallEdge[] = [];
  for (const f of functions) {
    for (const node of f.nodes) {
      for (const stmt of node.statements) {
        for (const m of stmt.matchAll(CALL_RE)) {
          const candidates = byName.get(m[1]);
          if (!candidates || candidates.length !== 1) continue;   // unknown or ambiguous
          const to = candidates[0];
          const key = `${f.id}->${to}@${node.id}`;
          if (seen.has(key)) continue;                            // dedupe within a block
          seen.add(key);
          // Self-calls are KEPT: recursion is the hero feature, not noise.
          callEdges.push({ from: f.id, to, nodeId: node.id });
        }
      }
    }
  }

  return { language, functions, callEdges, diagnostics, irVersion: IR_VERSION };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test src/lib/ir/builder.test.ts`
Expected: PASS (18 tests). If the switch-fallthrough, labeled-break, multi-statement-else,
or continue-through-switch test fails, fix the builder — those are the spec's named hard
cases and the four places a naive implementation silently produces a wrong graph.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ir/builder.ts src/lib/ir/builder.test.ts
git commit -m "feat: language-agnostic CFG builder with fallthrough and labeled-break handling"
```

---

## Task 5: Python adapter and golden fixtures

**Files:**
- Create: `src/lib/ir/languages/python.ts`, `src/lib/ir/languages/registry.ts`, `src/lib/ir/parse.ts`
- Create: `src/lib/ir/__fixtures__/python/*.py` (12 files listed below)
- Test: `src/lib/ir/languages/python.test.ts`, `src/lib/ir/golden.test.ts`
- Modify: `package.json` (add a `grammars` copy script)

**Interfaces:**
- Consumes: `buildProgramIR`, `SynNode`, `SynFunction` (Task 4); types (Task 3).
- Produces:
  - `parseToIR(source: string, language: Language): Promise<ProgramIR>`
  - `toSyn(tree: Parser.Tree, source: string): { funcs: SynFunction[]; diagnostics: Diagnostic[] }` (python adapter)
  - `LANGUAGES: Record<Language, { grammarUrl: string; adapter: Adapter }>`

- [ ] **Step 1: Install tree-sitter and vendor the grammars**

```bash
pnpm add web-tree-sitter@0.27.0
pnpm add -D tree-sitter-python@0.25.0 tree-sitter-cpp@0.23.4 tree-sitter-java@0.23.5
```

**No compiler toolchain is needed.** Each `tree-sitter-<lang>` package publishes a prebuilt,
ABI-compatible `.wasm` at its package root (verified loading and parsing under
web-tree-sitter 0.27.0). `pnpm grammars` is a plain copy.

Add to `package.json` scripts — the WASM files must be served, not bundled:

```json
"grammars": "mkdir -p public/grammars && cp node_modules/web-tree-sitter/web-tree-sitter.wasm public/grammars/ && cp node_modules/tree-sitter-python/tree-sitter-python.wasm node_modules/tree-sitter-cpp/tree-sitter-cpp.wasm node_modules/tree-sitter-java/tree-sitter-java.wasm public/grammars/"
```

The runtime wasm is `web-tree-sitter.wasm`, **not** `tree-sitter.wasm` — it was renamed in
0.26.0 and the package's exports map only exposes the new name. The basename is load-bearing:
emscripten asks `locateFile` for exactly that string, so that is what must land in
`public/grammars/`.

Do **not** write a build script. `pnpm dlx tree-sitter` resolves the `tree-sitter` npm
package (Node bindings), which has **no `bin` field** — only `tree-sitter-cli` declares one —
so that command can never run.

Run: `pnpm grammars`
Expected, in about a second, four files in `public/grammars/`:

```
web-tree-sitter.wasm          # the runtime
tree-sitter-python.wasm       # ~1.4 MB
tree-sitter-cpp.wasm          # ~3.4 MB
tree-sitter-java.wasm         # ~0.7 MB
```

Copy all three grammars even though only Python has an adapter in P1 — it keeps
`registry.ts` honest, and no P1 code path fetches the C++ wasm (the cache is per-language).

**Fallback**, only if a grammar package ever stops shipping its `.wasm` — note the `wasm/`
subdirectory:

```bash
pnpm add -D @vscode/tree-sitter-wasm@0.3.1
cp node_modules/@vscode/tree-sitter-wasm/wasm/tree-sitter-{python,cpp,java}.wasm public/grammars/
```

**Do not use `tree-sitter-wasms`.** Its artifacts carry the legacy `dylink` section;
web-tree-sitter 0.27 reads only `dylink.0`, so `Language.load` throws with an *empty*
message — a miserable thing to debug.

- [ ] **Step 2: Write the failing Python adapter test**

Create `src/lib/ir/languages/python.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { parseToIR } from '../parse';

describe('python adapter', () => {
  beforeAll(() => { /* grammar loads from public/grammars via parse.ts */ });

  it('finds a function with its params', async () => {
    const ir = await parseToIR(`def binary_search(arr, target):\n    return -1\n`, 'python');
    expect(ir.functions).toHaveLength(1);
    expect(ir.functions[0].name).toBe('binary_search');
    expect(ir.functions[0].params).toEqual(['arr', 'target']);
  });

  it('builds a loop with a back edge for a while', async () => {
    const ir = await parseToIR(
      `def f(n):\n    i = 0\n    while i < n:\n        i += 1\n    return i\n`, 'python');
    const g = ir.functions[0];
    expect(g.nodes.some((x) => x.kind === 'loop-header')).toBe(true);
    expect(g.edges.some((e) => e.kind === 'back')).toBe(true);
  });

  it('distinguishes elif as a nested branch', async () => {
    const ir = await parseToIR(
      `def f(x):\n    if x > 0:\n        return 1\n    elif x < 0:\n        return -1\n    else:\n        return 0\n`,
      'python');
    const g = ir.functions[0];
    expect(g.nodes.filter((x) => x.kind === 'branch')).toHaveLength(2);
    expect(g.nodes.filter((x) => x.kind === 'return')).toHaveLength(3);
  });

  it('handles for/else exhaustion', async () => {
    const ir = await parseToIR(
      `def f(xs):\n    for x in xs:\n        if x:\n            break\n    else:\n        return 'none'\n    return 'found'\n`,
      'python');
    const g = ir.functions[0];
    const header = g.nodes.find((x) => x.kind === 'loop-header')!;
    expect(header.meta?.loopKind).toBe('foreach');
    expect(g.edges.some((e) => e.kind === 'break')).toBe(true);
  });

  it('records a diagnostic for a syntax error but still returns partial IR', async () => {
    const ir = await parseToIR(`def f(:\n    return 1\n`, 'python');
    expect(ir.diagnostics.length).toBeGreaterThan(0);
    expect(ir.diagnostics[0].severity).toBe('error');
    // degrade, never blank (spec sec.11)
    expect(ir).toHaveProperty('functions');
  });

  it('emits a call edge between two functions', async () => {
    const ir = await parseToIR(
      `def helper(x):\n    return x\n\ndef main():\n    return helper(1)\n`, 'python');
    expect(ir.callEdges.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test src/lib/ir/languages/python.test.ts`
Expected: FAIL — cannot resolve `../parse`

- [ ] **Step 4: Implement the Python adapter**

Create `src/lib/ir/languages/python.ts`:

```ts
import type { Diagnostic, Span } from '../types';
import type { SynFunction, SynNode } from '../builder';

/** Minimal shape we need from a tree-sitter node — keeps this file dependency-light. */
export interface TSNode {
  type: string;
  text: string;
  startPosition: { row: number };
  endPosition: { row: number };
  namedChildren: TSNode[];
  children: TSNode[];
  childForFieldName(name: string): TSNode | null;
  hasError: boolean;
  isNamed: boolean;
}

const span = (n: TSNode): Span => ({
  startLine: n.startPosition.row + 1,
  endLine: n.endPosition.row + 1,
});

const syn = (kind: SynNode['kind'], text: string, children: SynNode[],
             s: Span, meta?: SynNode['meta']): SynNode =>
  ({ kind, text: text.trim(), children, span: s, meta });

/** One line of source, collapsed for display. */
function head(n: TSNode): string {
  return n.text.split('\n')[0].trim();
}

function block(n: TSNode | null): TSNode[] {
  if (!n) return [];
  return n.type === 'block' ? n.namedChildren : [n];
}

function stmts(list: TSNode[]): SynNode[] {
  return list.flatMap(toSynStmt);
}

/**
 * Turn `[elif, elif, …, else]` into a single nested-if else arm.
 *
 * Recurse over the CLAUSE LIST — never over a synthesized tree-sitter node. web-tree-sitter
 * exposes `type`/`text`/`isNamed`/`children` as PROTOTYPE GETTERS, so `{ ...node }` copies
 * none of them: the spread object has `type === undefined`, falls to the default arm, and
 * silently returns []. That drops every clause after the first elif with no error at all.
 */
function elseArmOf(alts: TSNode[]): SynNode[] {
  if (alts.length === 0) return [];
  const [first, ...rest] = alts;
  if (first.type === 'else_clause') {
    return stmts(block(first.childForFieldName('body')));
  }
  // elif_clause has fields 'condition' + 'consequence'
  const cond = first.childForFieldName('condition')!;
  const body = stmts(block(first.childForFieldName('consequence')));
  const deeper = elseArmOf(rest);
  return [syn('if', head(cond), body, span(first),
              deeper.length ? { elseBody: deeper } : undefined)];
}

function toSynStmt(n: TSNode): SynNode[] {
  switch (n.type) {
    case 'if_statement': {
      const cond = n.childForFieldName('condition')!;
      const thenBody = stmts(block(n.childForFieldName('consequence')));
      const alts = n.children.filter((c) => c.type === 'elif_clause' || c.type === 'else_clause');
      const elseBody = elseArmOf(alts);
      // children = then arm ONLY; the else arm travels in meta.elseBody
      return [syn('if', head(cond), thenBody, span(n),
                  elseBody.length ? { elseBody } : undefined)];
    }

    case 'while_statement': {
      const cond = n.childForFieldName('condition')!;
      const elseClause = n.children.find((c) => c.type === 'else_clause');
      return [syn('loop', head(cond), stmts(block(n.childForFieldName('body'))), span(n), {
        loopKind: 'while',
        ...(elseClause ? { elseBody: stmts(block(elseClause.childForFieldName('body'))) } : {}),
      })];
    }

    case 'for_statement': {
      const left = n.childForFieldName('left');
      const right = n.childForFieldName('right');
      const elseClause = n.children.find((c) => c.type === 'else_clause');
      return [syn('loop', `${left?.text ?? '_'} in ${right?.text ?? '_'}`,
        stmts(block(n.childForFieldName('body'))), span(n), {
          loopKind: 'foreach',
          ...(elseClause ? { elseBody: stmts(block(elseClause.childForFieldName('body'))) } : {}),
        })];
    }

    case 'try_statement': {
      const finallyClause = n.children.find((c) => c.type === 'finally_clause');
      const excepts = n.children.filter((c) => c.type === 'except_clause');
      return [syn('try', 'try', stmts(block(n.childForFieldName('body'))), span(n), {
        ...(finallyClause
          ? { finallyBody: stmts(block(finallyClause.namedChildren[0] ?? null)) } : {}),
        // map, NOT flatMap — one array per handler keeps handler boundaries intact
        ...(excepts.length
          ? { catchBodies: excepts.map((e) => stmts(block(e.namedChildren.at(-1) ?? null))) }
          : {}),
      })];
    }

    case 'return_statement': return [syn('return', head(n), [], span(n))];
    case 'raise_statement': return [syn('throw', head(n), [], span(n))];
    case 'break_statement': return [syn('break', 'break', [], span(n))];
    case 'continue_statement': return [syn('continue', 'continue', [], span(n))];

    case 'match_statement': {
      const cases = n.namedChildren
        .filter((c) => c.type === 'case_clause')
        .map((c) => {
          // Strip BOTH the leading keyword and the trailing colon, or 'case 1:' yields the
          // pattern '1:' — which leaks into edge labels and never matches the '_' default.
          const pattern = head(c).replace(/^case\s*/, '').replace(/:\s*$/, '').trim();
          return syn('case', head(c),
                     stmts(block(c.childForFieldName('consequence'))), span(c),
                     pattern === '_' ? { isDefault: true } : { caseValue: pattern });
        });
      return [syn('switch', head(n.childForFieldName('subject') ?? n), cases, span(n))];
    }

    case 'expression_statement':
    case 'assignment':
    default:
      if (!n.isNamed) return [];
      return [syn('stmt', head(n), [], span(n))];
  }
}

function params(fn: TSNode): string[] {
  const p = fn.childForFieldName('parameters');
  if (!p) return [];
  return p.namedChildren
    .map((c) => (c.childForFieldName('name') ?? c).text.trim())
    .filter((t) => t && t !== 'self');
}

/** Collect diagnostics from ERROR / MISSING nodes. */
function collectDiagnostics(root: TSNode, out: Diagnostic[]): void {
  if (root.type === 'ERROR') {
    out.push({ severity: 'error', message: `Syntax error near "${head(root)}"`, span: span(root) });
    return;
  }
  for (const c of root.children) if (c.hasError) collectDiagnostics(c, out);
}

export function toSyn(root: TSNode): { funcs: SynFunction[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  if (root.hasError) collectDiagnostics(root, diagnostics);

  const funcs: SynFunction[] = [];
  const visit = (n: TSNode) => {
    if (n.type === 'function_definition') {
      const name = n.childForFieldName('name')?.text ?? '<anonymous>';
      const ps = params(n);
      funcs.push({
        id: `${name}(${ps.join(',')})`,
        name, params: ps,
        node: syn('func', name, stmts(block(n.childForFieldName('body'))), span(n)),
      });
      // P1 does not descend into nested defs — a closure or inner helper is DROPPED from
      // the diagram entirely. Acceptable for DSA code, where nesting is rare; revisit when
      // it bites. (Do not describe this as "treated as separate" — they are not emitted.)
      return;
    }
    for (const c of n.namedChildren) visit(c);
  };
  visit(root);

  return { funcs, diagnostics };
}
```

- [ ] **Step 5: Implement the registry and the public parse entry**

Create `src/lib/ir/languages/registry.ts`:

```ts
import type { Language } from '../types';
import { toSyn as pythonToSyn, type TSNode } from './python';
import type { SynFunction } from '../builder';
import type { Diagnostic } from '../types';

export type Adapter = (root: TSNode) => { funcs: SynFunction[]; diagnostics: Diagnostic[] };

export const LANGUAGES: Record<Language, { grammarUrl: string; adapter: Adapter }> = {
  python: { grammarUrl: '/grammars/tree-sitter-python.wasm', adapter: pythonToSyn },
  // cpp and java land in Task 6 of the later plan; registry shape is already correct
  cpp:    { grammarUrl: '/grammars/tree-sitter-cpp.wasm',    adapter: pythonToSyn },
  java:   { grammarUrl: '/grammars/tree-sitter-java.wasm',   adapter: pythonToSyn },
};
```

Create `src/lib/ir/parse.ts`:

```ts
import { Parser, Language as TSLanguage, type Tree } from 'web-tree-sitter';
import { buildProgramIR } from './builder';
import { LANGUAGES } from './languages/registry';
import { IR_VERSION, type Language, type ProgramIR } from './types';
import type { TSNode } from './languages/python';

/** True only in Node (Vitest, the Inngest job). A browser web worker has no `window`
 *  either, so never test for `window` to detect the host. */
const IS_NODE = typeof process !== 'undefined' && process.versions?.node != null;

let initPromise: Promise<void> | null = null;
const grammarCache = new Map<Language, TSLanguage>();

/** Where tree-sitter.wasm lives. Overridable so a Node job can pass a file path. */
export interface ParseOptions { baseUrl?: string }

/**
 * Node already resolves web-tree-sitter.wasm next to its own module in node_modules; a
 * locateFile override there yields a cwd-relative path and aborts with ENOENT. Caching
 * the PROMISE (not a boolean) closes the double-init window when the worker fires two
 * parses back to back.
 */
function ensureInit(baseUrl: string): Promise<void> {
  initPromise ??= IS_NODE
    ? Parser.init()
    : Parser.init({ locateFile: (name: string) => `${baseUrl}/grammars/${name}` });
  return initPromise;
}

async function loadGrammar(language: Language, baseUrl: string): Promise<TSLanguage> {
  const cached = grammarCache.get(language);
  if (cached) return cached;
  const url = LANGUAGES[language].grammarUrl;
  const grammar = await TSLanguage.load(
    url.startsWith('/') ? `${baseUrl}${url}` : url,
  );
  grammarCache.set(language, grammar);
  return grammar;
}

/**
 * Parse source into a normalized ProgramIR.
 * Error-tolerant: a syntax error yields diagnostics AND whatever IR was recoverable.
 */
export async function parseToIR(
  source: string, language: Language, opts: ParseOptions = {},
): Promise<ProgramIR> {
  // NOTE: ensureInit takes the BARE baseUrl and appends /grammars itself.
  const baseUrl = opts.baseUrl ?? (IS_NODE ? 'public' : '');
  await ensureInit(baseUrl);

  const parser = new Parser();
  parser.setLanguage(await loadGrammar(language, baseUrl));

  // A Tree is its own wasm-backed handle and must be freed too. The worker calls this on
  // every debounced keystroke for the life of the session — leaking Trees grows the
  // emscripten heap without bound in the hot path.
  let tree: Tree | null = null;
  try {
    tree = parser.parse(source);
    if (!tree) {
      return { language, functions: [], callEdges: [], irVersion: IR_VERSION,
               diagnostics: [{ severity: 'error', message: 'Parser returned no tree',
                               span: { startLine: 1, endLine: 1 } }] };
    }
    const { funcs, diagnostics } = LANGUAGES[language].adapter(tree.rootNode as unknown as TSNode);
    return buildProgramIR(funcs, language, diagnostics);
  } finally {
    tree?.delete();
    parser.delete();
  }
}
```

- [ ] **Step 6: Run the adapter tests**

Run: `pnpm test src/lib/ir/languages/python.test.ts`
Expected: PASS (7 tests). These tests run in the `unit` project (jsdom), but
`web-tree-sitter` needs Node's filesystem to load the grammar, so add the docblock at the
top of this test file:

```ts
// @vitest-environment node
```

and pass `{ baseUrl: 'public' }` in the calls, so Node resolves
`public/grammars/tree-sitter-python.wasm` from the repo root. `Parser.init()` takes no
`locateFile` in Node — see Step 5. If loading still fails, check the grammar path before
reaching for `deps.inline`; that is a hint, not a fix.

- [ ] **Step 7: Add the golden fixtures**

Create these 12 files under `src/lib/ir/__fixtures__/python/`. Each is a real DSA snippet:

| File | Covers |
|---|---|
| `01-straight-line.py` | statement collapsing |
| `02-if-else.py` | branch, both arms |
| `03-elif-chain.py` | nested branches |
| `04-while-loop.py` | back edge |
| `05-for-range.py` | foreach normalization |
| `06-nested-loops.py` | scope-local sibling indices |
| `07-break-continue.py` | break/continue edges |
| `08-for-else.py` | exhaustion vs break |
| `09-multi-return.py` | multiple exitIds |
| `10-try-finally.py` | finally reachable from return |
| `11-recursion.py` | call edges (fib) |
| `12-binary-search.py` | the canonical case |

Example — `12-binary-search.py`:

```python
def binary_search(arr, target):
    lo = 0
    hi = len(arr) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1
```

- [ ] **Step 8: Write the golden snapshot test**

Create `src/lib/ir/golden.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseToIR } from './parse';

const DIR = path.join(__dirname, '__fixtures__/python');

/** Strip volatile fields so the snapshot captures structure, not incidentals. */
function normalize(ir: Awaited<ReturnType<typeof parseToIR>>) {
  return {
    language: ir.language,
    functions: ir.functions.map((f) => ({
      id: f.id,
      entryId: f.entryId,
      exitCount: f.exitIds.length,
      nodes: f.nodes.map((n) => ({ id: n.id, kind: n.kind, statements: n.statements })),
      edges: f.edges.map((e) => ({ source: e.source, target: e.target, kind: e.kind, label: e.label })),
    })),
    callEdges: ir.callEdges.map((c) => ({ from: c.from, to: c.to })),
    diagnostics: ir.diagnostics.map((d) => d.severity),
  };
}

describe('python golden fixtures', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.py')).sort();

  it('has all 12 fixtures', () => {
    expect(files).toHaveLength(12);
  });

  for (const file of files) {
    it(`matches the golden IR for ${file}`, async () => {
      const source = readFileSync(path.join(DIR, file), 'utf8');
      const ir = await parseToIR(source, 'python', { baseUrl: 'public' });
      expect(ir.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(normalize(ir)).toMatchSnapshot();
    });
  }
});
```

- [ ] **Step 9: Generate and REVIEW the snapshots**

Run: `pnpm vitest run src/lib/ir/golden.test.ts -u`

Then **read every generated snapshot in `src/lib/ir/__snapshots__/`**. A snapshot test only
protects behaviour you have actually verified once. For `12-binary-search.py`, confirm by eye:
one `loop-header`, two `branch` nodes, two `return` nodes, and a `back` edge into the header.
Fix the builder if any is wrong, then re-generate.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: Python tree-sitter adapter with 12 golden IR fixtures"
```

---

## Task 6: ELK layout and the parse worker

**Files:**
- Create: `src/lib/layout/elk.ts`, `src/lib/layout/types.ts`
- Create: `src/workers/parse.worker.ts`, `src/lib/useParse.ts`
- Test: `src/lib/layout/elk.test.ts`

**Interfaces:**
- Consumes: `ProgramIR`, `FunctionGraph` (Task 3); `parseToIR` (Task 5).
- Produces:
  - `interface PositionedNode { id: string; x: number; y: number; width: number; height: number }`
  - `interface LaidOutGraph { nodes: PositionedNode[]; edges: { id: string; points: {x:number;y:number}[] }[]; width: number; height: number }`
  - `layoutFunction(g: FunctionGraph): Promise<LaidOutGraph>`
  - `nodeSize(node: IRNode): { width: number; height: number }`
  - Worker protocol: `{ type: 'parse'; id: number; source: string; language: Language }` in,
    `{ type: 'result'; id: number; ir: ProgramIR; layouts: Record<string, LaidOutGraph> }` or
    `{ type: 'error'; id: number; message: string }` out.
  - Hook: `useParse(source: string, language: Language)` → `{ ir, layouts, status, error }`

- [ ] **Step 1: Install elkjs**

```bash
pnpm add elkjs
```

- [ ] **Step 2: Write the failing layout test**

Create `src/lib/layout/elk.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { layoutFunction, nodeSize, fallbackLayout } from './elk';
import type { FunctionGraph, IRNode } from '@/lib/ir/types';

const node = (id: string, kind: IRNode['kind'], statements: string[] = []): IRNode =>
  ({ id, kind, label: statements[0] ?? id, statements, span: { startLine: 1, endLine: 1 } });

const simpleLoop = (): FunctionGraph => ({
  id: 'f()', name: 'f', params: [],
  entryId: 'entry', exitIds: ['exit'],
  nodes: [
    node('entry', 'entry'),
    node('header', 'loop-header', ['i < n']),
    node('body', 'basic', ['i += 1']),
    node('exit', 'exit'),
  ],
  edges: [
    { id: 'e0', source: 'entry',  target: 'header', kind: 'seq' },
    { id: 'e1', source: 'header', target: 'body',   kind: 'true',  label: 'true' },
    { id: 'e2', source: 'body',   target: 'header', kind: 'back',  label: 'while' },
    { id: 'e3', source: 'header', target: 'exit',   kind: 'false', label: 'false' },
  ],
});

describe('nodeSize', () => {
  it('sizes a branch wider than a plain block for the same text', () => {
    const stmt = node('a', 'basic', ['x = 1']);
    const branch = node('b', 'branch', ['x = 1']);
    expect(nodeSize(branch).width).toBeGreaterThan(nodeSize(stmt).width);
  });

  it('grows height with statement count', () => {
    const one = node('a', 'basic', ['x = 1']);
    const three = node('b', 'basic', ['x = 1', 'y = 2', 'z = 3']);
    expect(nodeSize(three).height).toBeGreaterThan(nodeSize(one).height);
  });

  it('caps width so one long line cannot blow out the canvas', () => {
    const long = node('a', 'basic', ['x'.repeat(500)]);
    expect(nodeSize(long).width).toBeLessThanOrEqual(420);
  });
});

describe('layoutFunction', () => {
  it('positions every node', async () => {
    const out = await layoutFunction(simpleLoop());
    expect(out.nodes).toHaveLength(4);
    for (const n of out.nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
  });

  it('flows top-to-bottom: entry above the loop header, header above exit', async () => {
    const out = await layoutFunction(simpleLoop());
    const at = (id: string) => out.nodes.find((n) => n.id === id)!;
    expect(at('entry').y).toBeLessThan(at('header').y);
    expect(at('header').y).toBeLessThan(at('exit').y);
  });

  it('reports overall dimensions', async () => {
    const out = await layoutFunction(simpleLoop());
    expect(out.width).toBeGreaterThan(0);
    expect(out.height).toBeGreaterThan(0);
  });

  it('is deterministic for the same input', async () => {
    const a = await layoutFunction(simpleLoop());
    const b = await layoutFunction(simpleLoop());
    expect(JSON.stringify(a.nodes)).toBe(JSON.stringify(b.nodes));
  });

  // ELK *would* reject a dangling edge, but layoutFunction filters those out before
  // calling it — so this exercises the SUCCESS path. Assert the drop, not the fallback.
  it('drops dangling edges instead of failing the whole layout', async () => {
    const broken = simpleLoop();
    broken.edges.push({ id: 'bad', source: 'header', target: 'ghost', kind: 'seq' });
    const out = await layoutFunction(broken);
    expect(out.nodes).toHaveLength(4);
    expect(out.edges.map((e) => e.id)).not.toContain('bad');
  });

  // Cover the real degrade path directly (spec sec.11: degrade, never blank).
  it('fallbackLayout stacks every node in a deterministic top-down order', () => {
    const out = fallbackLayout(simpleLoop());
    expect(out.nodes).toHaveLength(4);
    expect(out.width).toBeGreaterThan(0);
    expect(out.height).toBeGreaterThan(0);
    const ys = out.nodes.map((n) => n.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);   // already ascending
  });

  it('skips ELK entirely past MAX_LAYOUT_NODES', async () => {
    const big = simpleLoop();
    big.nodes = Array.from({ length: 601 }, (_, i) => node(`n${i}`, 'basic', [`s${i}`]));
    big.edges = [];
    const out = await layoutFunction(big);
    expect(out.nodes).toHaveLength(601);            // rendered, not dropped
    expect(out.nodes.every((n) => n.x === 0)).toBe(true);   // the stacked fallback
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test src/lib/layout/elk.test.ts`
Expected: FAIL — cannot resolve `./elk`

- [ ] **Step 4: Implement the layout**

Create `src/lib/layout/types.ts`:

```ts
export interface PositionedNode {
  id: string; x: number; y: number; width: number; height: number;
}

export interface RoutedEdge {
  id: string;
  points: { x: number; y: number }[];
}

export interface LaidOutGraph {
  nodes: PositionedNode[];
  edges: RoutedEdge[];
  width: number;
  height: number;
}
```

Create `src/lib/layout/elk.ts`:

```ts
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { FunctionGraph, IRNode } from '@/lib/ir/types';
import type { LaidOutGraph, PositionedNode } from './types';

const CHAR_W = 7.4;          // Geist Mono at 13px, measured
const LINE_H = 20;
const PAD_X = 28;
const PAD_Y = 20;
const MIN_W = 140;
const MAX_W = 420;

// elk.bundled.js is a SYNCHRONOUS GWT-compiled solver: it blocks the thread, so a
// Promise.race against a setTimeout can never fire — the timer callback cannot run until
// layout has already resolved. Bound the work by graph size instead.
// Measured (elkjs 0.12.0): 400 nodes ~0.7s | 600 ~1.4s | 800 ~2.4s | 1000 ~3.3s
//                          1500 ~7.8s | 3000 -> RangeError: Maximum call stack size
// 600 keeps the worst case near ~1.5s, inside the spec sec.11 budget, and stays well clear
// of the stack-overflow cliff. Do NOT raise it to 1500 — that alone blows the budget.
const MAX_LAYOUT_NODES = 600;

/**
 * Node box size. Branch and switch nodes get extra width because they render
 * as diamonds — the text sits in the narrow middle band.
 */
export function nodeSize(node: IRNode): { width: number; height: number } {
  const longest = node.statements.reduce((m, s) => Math.max(m, s.length), node.label.length);
  const diamond = node.kind === 'branch' || node.kind === 'switch';
  const raw = longest * CHAR_W + PAD_X * (diamond ? 2.2 : 1);
  const width = Math.min(MAX_W, Math.max(MIN_W, Math.round(raw)));
  const lines = Math.max(1, node.statements.length);
  const height = Math.round(lines * LINE_H + PAD_Y * (diamond ? 1.8 : 1));
  return { width, height };
}

const elk = new ELK();

/** ELK options tuned for control-flow graphs: layered, top-down, back edges allowed. */
const ELK_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.layered.spacing.nodeNodeBetweenLayers': '48',
  'elk.spacing.nodeNode': '32',
  'elk.spacing.edgeNode': '20',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  // ELK REVERSES back edges unconditionally in the layered algorithm; this strategy only
  // chooses WHICH edges get reversed, not whether. So a laid-out back edge's endpoints are
  // swapped relative to the IR. The renderer must therefore take direction from the IR
  // edge (kind === 'back'), never from the ELK section's point order.
  'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.mergeEdges': 'false',
  // No 'elk.hierarchyHandling' — verified no-op here (children are leaves and each
  // function is laid out as its own top-level graph); output is byte-identical without it.
};

/** Deterministic vertical stack, used when ELK fails or the graph is too large.
 *  Exported so the degrade path can be tested directly (spec sec.11). */
export function fallbackLayout(g: FunctionGraph): LaidOutGraph {
  let y = 0;
  let maxW = 0;
  const nodes: PositionedNode[] = g.nodes.map((n) => {
    const { width, height } = nodeSize(n);
    const placed = { id: n.id, x: 0, y, width, height };
    y += height + 40;
    maxW = Math.max(maxW, width);
    return placed;
  });
  return { nodes, edges: g.edges.map((e) => ({ id: e.id, points: [] })), width: maxW, height: y };
}

export async function layoutFunction(g: FunctionGraph): Promise<LaidOutGraph> {
  // Degrade, never blank (spec sec.11): an oversized graph skips ELK entirely.
  if (g.nodes.length > MAX_LAYOUT_NODES) return fallbackLayout(g);

  const ids = new Set(g.nodes.map((n) => n.id));
  const graph: ElkNode = {
    id: g.id,
    layoutOptions: ELK_OPTIONS,
    children: g.nodes.map((n) => ({ id: n.id, ...nodeSize(n) })),
    // Drop dangling edges rather than letting ELK reject the whole graph.
    edges: g.edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };

  try {
    const laid = await elk.layout(graph);

    const nodes: PositionedNode[] = (laid.children ?? []).map((c) => ({
      id: c.id, x: c.x ?? 0, y: c.y ?? 0, width: c.width ?? MIN_W, height: c.height ?? LINE_H,
    }));
    const edges = (laid.edges ?? []).map((e) => {
      const section = e.sections?.[0];
      const points = section
        ? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
        : [];
      return { id: e.id, points: points.map((p) => ({ x: p.x, y: p.y })) };
    });
    return { nodes, edges, width: laid.width ?? 0, height: laid.height ?? 0 };
  } catch {
    return fallbackLayout(g);
  }
}

/** Lay out every function in a program, keyed by function id. */
export async function layoutProgram(
  functions: FunctionGraph[],
): Promise<Record<string, LaidOutGraph>> {
  const entries = await Promise.all(
    functions.map(async (f) => [f.id, await layoutFunction(f)] as const),
  );
  return Object.fromEntries(entries);
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm test src/lib/layout/elk.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 6: Write the worker**

Create `src/workers/parse.worker.ts`. Parsing and layout both run here so the main thread never blocks:

```ts
/// <reference lib="webworker" />
import { parseToIR } from '@/lib/ir/parse';
import { layoutProgram } from '@/lib/layout/elk';
import type { Language, ProgramIR } from '@/lib/ir/types';
import type { LaidOutGraph } from '@/lib/layout/types';

export interface ParseRequest { type: 'parse'; id: number; source: string; language: Language }
export type ParseResponse =
  | { type: 'result'; id: number; ir: ProgramIR; layouts: Record<string, LaidOutGraph> }
  | { type: 'error'; id: number; message: string };

self.onmessage = async (event: MessageEvent<ParseRequest>) => {
  const { id, source, language } = event.data;
  try {
    const ir = await parseToIR(source, language);
    const layouts = await layoutProgram(ir.functions);
    const response: ParseResponse = { type: 'result', id, ir, layouts };
    self.postMessage(response);
  } catch (error) {
    const response: ParseResponse = {
      type: 'error', id,
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};
```

- [ ] **Step 7: Write the `useParse` hook**

Create `src/lib/useParse.ts`. It debounces at 400ms per Spec §7 and drops stale results:

```ts
'use client';

import { useEffect, useRef, useState } from 'react';
import type { Language, ProgramIR } from '@/lib/ir/types';
import type { LaidOutGraph } from '@/lib/layout/types';
import type { ParseRequest, ParseResponse } from '@/workers/parse.worker';

const DEBOUNCE_MS = 400;

export type ParseStatus = 'idle' | 'first-load' | 'parsing' | 'ready' | 'error';

export interface ParseState {
  ir: ProgramIR | null;
  layouts: Record<string, LaidOutGraph>;
  status: ParseStatus;
  error: string | null;
}

export function useParse(source: string, language: Language): ParseState {
  const [state, setState] = useState<ParseState>({
    ir: null, layouts: {}, status: 'first-load', error: null,
  });
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  const latest = useRef(0);
  /** Skeleton shows on first load only (spec sec.7) */
  const hasResult = useRef(false);

  useEffect(() => {
    const w = new Worker(new URL('../workers/parse.worker.ts', import.meta.url),
                         { type: 'module' });
    worker.current = w;

    w.onmessage = (event: MessageEvent<ParseResponse>) => {
      const msg = event.data;
      if (msg.id !== latest.current) return;      // stale — a newer edit superseded it
      if (msg.type === 'result') {
        hasResult.current = true;
        setState({ ir: msg.ir, layouts: msg.layouts, status: 'ready', error: null });
      } else {
        setState((prev) => ({ ...prev, status: 'error', error: msg.message }));
      }
    };

    return () => { w.terminate(); worker.current = null; };
  }, []);

  useEffect(() => {
    if (!source.trim()) {
      setState({ ir: null, layouts: {}, status: 'idle', error: null });
      return;
    }
    const timer = setTimeout(() => {
      const id = ++seq.current;
      latest.current = id;
      setState((prev) => ({
        ...prev,
        // never regress to a skeleton once a graph exists
        status: hasResult.current ? 'parsing' : 'first-load',
      }));
      const request: ParseRequest = { type: 'parse', id, source, language };
      worker.current?.postMessage(request);
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [source, language]);

  return state;
}
```

- [ ] **Step 8: Verify the worker resolves under Next**

Add a temporary page that calls `useParse` with a hard-coded binary search, run `pnpm dev`, and
confirm in devtools that a worker request appears and `ir.functions` is non-empty.
Expected: no "cannot find module" for the worker URL. If Next fails to bundle it, confirm
`next.config.ts` has no `webpack` override stripping workers — Next 15 handles
`new Worker(new URL(...))` natively. **Delete the temporary page afterward.**

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: ELK layered layout with fallback, plus debounced parse worker"
```

---

## Task 7: Editor, canvas, and project routes

The slice closes here: a signed-in user creates a project, pastes Python, and sees a correct
diagram whose nodes link back to the source.

**Files:**
- Create: `src/components/editor/CodeEditor.tsx`
- Create: `src/components/canvas/{FlowCanvas,IRNodeView,IREdgeView,NodeShapes}.tsx`
- Create: `src/components/canvas/toReactFlow.ts`
- Create: `src/components/ui/{Button,Skeleton,ThemeToggle}.tsx`
- Create: `src/app/(auth)/login/page.tsx`, `src/app/(auth)/actions.ts`
- Create: `src/app/(app)/projects/page.tsx`, `src/app/(app)/projects/actions.ts`
- Create: `src/app/(app)/projects/[id]/page.tsx`, `src/app/(app)/projects/[id]/Workbench.tsx`
- Test: `src/components/canvas/toReactFlow.test.ts`, `tests/e2e/slice.spec.ts`

**Interfaces:**
- Consumes: `useParse` (Task 6); `LaidOutGraph` (Task 6); `createBrowserClient`/`createServerClient` (Task 2); tokens (Task 1).
- Produces:
  - `toReactFlow(g: FunctionGraph, layout: LaidOutGraph, overrides?: Record<string, {x:number;y:number}>): { nodes: RFNode[]; edges: RFEdge[] }`
  - `<Workbench project={...} />` — the three-pane shell.

- [ ] **Step 1: Install the remaining dependencies**

```bash
pnpm add @xyflow/react @codemirror/lang-python @codemirror/lang-cpp @codemirror/lang-java \
  @uiw/react-codemirror @codemirror/theme-one-dark
pnpm add -D @playwright/test && pnpm exec playwright install chromium
```

- [ ] **Step 2: Write the failing IR→React Flow test**

Create `src/components/canvas/toReactFlow.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toReactFlow } from './toReactFlow';
import type { FunctionGraph, IRNode } from '@/lib/ir/types';
import type { LaidOutGraph } from '@/lib/layout/types';

const node = (id: string, kind: IRNode['kind']): IRNode =>
  ({ id, kind, label: id, statements: [id], span: { startLine: 1, endLine: 2 } });

const g: FunctionGraph = {
  id: 'f()', name: 'f', params: [], entryId: 'a', exitIds: ['c'],
  nodes: [node('a', 'entry'), node('b', 'branch'), node('c', 'exit')],
  edges: [
    { id: 'e0', source: 'a', target: 'b', kind: 'seq' },
    { id: 'e1', source: 'b', target: 'c', kind: 'true', label: 'true' },
    { id: 'e2', source: 'b', target: 'a', kind: 'back', label: 'while' },
  ],
};

const layout: LaidOutGraph = {
  nodes: [
    { id: 'a', x: 0, y: 0, width: 100, height: 40 },
    { id: 'b', x: 0, y: 80, width: 120, height: 50 },
    { id: 'c', x: 0, y: 200, width: 100, height: 40 },
  ],
  edges: [], width: 120, height: 240,
};

describe('toReactFlow', () => {
  it('maps every IR node to a positioned React Flow node', () => {
    const { nodes } = toReactFlow(g, layout);
    expect(nodes).toHaveLength(3);
    expect(nodes.find((n) => n.id === 'b')!.position).toEqual({ x: 0, y: 80 });
  });

  it('carries kind and span through to node data for the editor link', () => {
    const { nodes } = toReactFlow(g, layout);
    const b = nodes.find((n) => n.id === 'b')!;
    expect(b.data.kind).toBe('branch');
    expect(b.data.span).toEqual({ startLine: 1, endLine: 2 });
  });

  it('user overrides win over the auto layout', () => {
    const { nodes } = toReactFlow(g, layout, { b: { x: 999, y: 888 } });
    expect(nodes.find((n) => n.id === 'b')!.position).toEqual({ x: 999, y: 888 });
  });

  it('marks back edges as animated-free dashed edges with a label', () => {
    const { edges } = toReactFlow(g, layout);
    const back = edges.find((e) => e.id === 'e2')!;
    expect(back.data!.kind).toBe('back');
    expect(back.label).toBe('while');
    expect(back.animated).toBe(false);   // motion budget: no animated edges
  });

  it('labels true/false edges so meaning is not carried by colour', () => {
    const { edges } = toReactFlow(g, layout);
    expect(edges.find((e) => e.id === 'e1')!.label).toBe('true');
  });

  it('drops nodes that have no layout entry rather than throwing', () => {
    const partial: LaidOutGraph = { ...layout, nodes: layout.nodes.slice(0, 2) };
    const { nodes } = toReactFlow(g, partial);
    expect(nodes).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test src/components/canvas/toReactFlow.test.ts`
Expected: FAIL — cannot resolve `./toReactFlow`

- [ ] **Step 4: Implement the mapper**

Create `src/components/canvas/toReactFlow.ts`:

```ts
import type { Edge, Node } from '@xyflow/react';
import type { FunctionGraph, IRNode, EdgeKind, Span } from '@/lib/ir/types';
import type { LaidOutGraph } from '@/lib/layout/types';

export interface IRNodeData extends Record<string, unknown> {
  kind: IRNode['kind'];
  label: string;
  statements: string[];
  span: Span;
  loopKind?: string;
  unsupported?: string;
}

export interface IREdgeData extends Record<string, unknown> {
  kind: EdgeKind;
}

export type RFNode = Node<IRNodeData, 'ir'>;
export type RFEdge = Edge<IREdgeData>;

export function toReactFlow(
  g: FunctionGraph,
  layout: LaidOutGraph,
  overrides: Record<string, { x: number; y: number }> = {},
): { nodes: RFNode[]; edges: RFEdge[] } {
  const placed = new Map(layout.nodes.map((n) => [n.id, n]));

  const nodes: RFNode[] = g.nodes.flatMap((n) => {
    const pos = placed.get(n.id);
    if (!pos) return [];                       // degrade rather than throw
    const override = overrides[n.id];
    return [{
      id: n.id,
      type: 'ir' as const,
      position: override ?? { x: pos.x, y: pos.y },
      width: pos.width,
      height: pos.height,
      data: {
        kind: n.kind,
        label: n.label,
        statements: n.statements,
        span: n.span,
        ...(n.meta?.loopKind ? { loopKind: n.meta.loopKind } : {}),
        ...(n.meta?.unsupported ? { unsupported: n.meta.unsupported } : {}),
      },
    }];
  });

  const known = new Set(nodes.map((n) => n.id));
  const edges: RFEdge[] = g.edges
    .filter((e) => known.has(e.source) && known.has(e.target))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'ir',
      // Motion budget is spent on node-settle; edges never animate.
      animated: false,
      ...(e.label ? { label: e.label } : {}),
      data: { kind: e.kind },
    }));

  return { nodes, edges };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/components/canvas/toReactFlow.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Build the node views with non-colour semantics**

Create `src/components/canvas/IRNodeView.tsx`. Per Spec §10, shape and label carry meaning:

```tsx
'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { RFNode } from './toReactFlow';

/** Diamond for decisions, doubled rule for loops, filled cap for returns. */
export function IRNodeView({ data, selected }: NodeProps<RFNode>) {
  const { kind, label, statements, loopKind, unsupported } = data;
  const isDecision = kind === 'branch' || kind === 'switch';

  return (
    <div
      className="cf-node"
      data-kind={kind}
      data-selected={selected ? 'true' : undefined}
      role="group"
      aria-label={`${kind} node: ${label}`}
    >
      <Handle type="target" position={Position.Top} />

      {isDecision && <span className="cf-node__diamond" aria-hidden="true" />}
      {kind === 'loop-header' && (
        <span className="cf-node__loop-mark" aria-hidden="true">↻</span>
      )}

      <div className="cf-node__body">
        {kind === 'loop-header' && (
          <span className="cf-node__kind">{loopKind ?? 'loop'}</span>
        )}
        {kind === 'return' && <span className="cf-node__kind">return</span>}
        {unsupported && (
          <span className="cf-node__warn" title={unsupported}>⚠</span>
        )}
        <ul className="cf-node__stmts">
          {statements.slice(0, 6).map((s, i) => <li key={i}>{s}</li>)}
          {statements.length > 6 && <li className="cf-node__more">+{statements.length - 6} more</li>}
        </ul>
      </div>

      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
```

Create `src/components/canvas/NodeShapes.css` (imported by the canvas). Every colour is a token:

```css
.cf-node {
  position: relative;
  background: var(--color-node);
  border: 1px solid var(--color-node-brdr);
  border-radius: var(--radius-md);
  padding: var(--space-xs) var(--space-sm);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-ink);
  transition: transform var(--dur-mid) var(--ease-out),
              opacity var(--dur-mid) var(--ease-out);
}

/* Decision nodes: rotated square behind the text — shape, not colour */
.cf-node[data-kind="branch"],
.cf-node[data-kind="switch"] { border-color: transparent; background: transparent; }
.cf-node__diamond {
  position: absolute; inset: 0;
  background: var(--color-node);
  border: 1px solid var(--color-node-brdr);
  transform: rotate(45deg) scale(0.72);
  border-radius: var(--radius-sm);
  z-index: 0;
}
.cf-node__body { position: relative; z-index: 1; }

/* Loops: doubled left rule */
.cf-node[data-kind="loop-header"] {
  border-left: 3px double var(--color-accent);
  padding-left: var(--space-sm);
}
.cf-node__loop-mark {
  position: absolute; top: 2px; right: 6px;
  color: var(--color-accent); font-size: var(--text-xs);
}

/* Returns: filled left cap */
.cf-node[data-kind="return"] { border-left: 6px solid var(--color-accent); }
.cf-node[data-kind="throw"]  { border-style: dashed; border-color: var(--color-danger); }
.cf-node[data-kind="entry"],
.cf-node[data-kind="exit"] {
  border-radius: var(--radius-pill);
  background: var(--color-paper-3);
  text-align: center;
}

.cf-node[data-selected="true"] { outline: 2px solid var(--color-focus); outline-offset: 2px; }
.cf-node:hover { transform: translateY(-1px); }
.cf-node__kind {
  display: inline-block; font-size: 10px; letter-spacing: 0.04em;
  text-transform: uppercase; color: var(--color-ink-3);
}
.cf-node__warn { color: var(--color-warn); margin-left: var(--space-2xs); }
.cf-node__stmts { list-style: none; margin: 0; padding: 0; }
.cf-node__stmts li { white-space: pre; overflow: hidden; text-overflow: ellipsis; }
.cf-node__more { color: var(--color-ink-3); font-style: normal; }

/* Back edges read as dashed + purple-ish; the LABEL carries the meaning */
.react-flow__edge[data-kind="back"] path { stroke-dasharray: 5 4; stroke: var(--color-edge-back); }
.react-flow__edge path { stroke: var(--color-edge); }
.react-flow__edge-text { font-family: var(--font-mono); font-size: 10px; fill: var(--color-ink-2); }

@media (prefers-reduced-motion: reduce) {
  .cf-node { transition: opacity 150ms var(--ease-out); }
  .cf-node:hover { transform: none; }
}
```

- [ ] **Step 7: Build the canvas**

Create `src/components/canvas/FlowCanvas.tsx`:

```tsx
'use client';

import { useMemo } from 'react';
import { ReactFlow, Background, Controls, MiniMap, type NodeMouseHandler } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './NodeShapes.css';
import { toReactFlow } from './toReactFlow';
import { IRNodeView } from './IRNodeView';
import type { FunctionGraph } from '@/lib/ir/types';
import type { LaidOutGraph } from '@/lib/layout/types';

const nodeTypes = { ir: IRNodeView };
const MINIMAP_THRESHOLD = 30;

interface Props {
  graph: FunctionGraph;
  layout: LaidOutGraph;
  overrides?: Record<string, { x: number; y: number }>;
  onNodeClick?: (startLine: number) => void;
}

export function FlowCanvas({ graph, layout, overrides, onNodeClick }: Props) {
  const { nodes, edges } = useMemo(
    () => toReactFlow(graph, layout, overrides), [graph, layout, overrides]);

  const handleClick: NodeMouseHandler = (_, node) => {
    const span = (node.data as { span?: { startLine: number } }).span;
    if (span) onNodeClick?.(span.startLine);
  };

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={handleClick}
      fitView
      proOptions={{ hideAttribution: false }}
      minZoom={0.15}
      maxZoom={2}
    >
      <Background gap={24} size={1} color="var(--color-rule)" />
      <Controls showInteractive={false} />
      {nodes.length > MINIMAP_THRESHOLD && <MiniMap pannable zoomable />}
    </ReactFlow>
  );
}
```

- [ ] **Step 8: Build the editor**

Create `src/components/editor/CodeEditor.tsx`:

```tsx
'use client';

import { useEffect, useRef } from 'react';
import CodeMirror, { type ReactCodeMirrorRef, EditorView } from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { oneDark } from '@codemirror/theme-one-dark';
import type { Language } from '@/lib/ir/types';

const EXTENSIONS: Record<Language, () => ReturnType<typeof python>> = {
  python: python, cpp: cpp, java: java,
};

interface Props {
  value: string;
  language: Language;
  theme: 'dark' | 'light';
  /** When set, scroll this 1-based line into view (set by a node click). */
  revealLine?: number;
  onChange: (value: string) => void;
}

export function CodeEditor({ value, language, theme, revealLine, onChange }: Props) {
  const ref = useRef<ReactCodeMirrorRef>(null);

  useEffect(() => {
    if (!revealLine || !ref.current?.view) return;
    const view = ref.current.view;
    const line = view.state.doc.line(Math.min(revealLine, view.state.doc.lines));
    view.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    });
  }, [revealLine]);

  return (
    <CodeMirror
      ref={ref}
      value={value}
      height="100%"
      theme={theme === 'dark' ? oneDark : 'light'}
      extensions={[EXTENSIONS[language]()]}
      onChange={onChange}
      basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
      aria-label="Code editor"
    />
  );
}
```

- [ ] **Step 9: Build the auth and projects routes**

Create `src/app/(auth)/actions.ts`:

```ts
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';

export async function signIn(formData: FormData) {
  const supabase = await createServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get('email')),
    password: String(formData.get('password')),
  });
  if (error) return { error: error.message };
  revalidatePath('/', 'layout');
  redirect('/projects');
}

export async function signUp(formData: FormData) {
  const supabase = await createServerClient();
  const { error } = await supabase.auth.signUp({
    email: String(formData.get('email')),
    password: String(formData.get('password')),
  });
  if (error) return { error: error.message };
  revalidatePath('/', 'layout');
  redirect('/projects');
}

export async function signOut() {
  const supabase = await createServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}
```

Create `src/app/(app)/projects/actions.ts`:

```ts
'use server';

import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';

const STARTER: Record<string, string> = {
  python: `def binary_search(arr, target):\n    lo = 0\n    hi = len(arr) - 1\n    while lo <= hi:\n        mid = (lo + hi) // 2\n        if arr[mid] == target:\n            return mid\n        elif arr[mid] < target:\n            lo = mid + 1\n        else:\n            hi = mid - 1\n    return -1\n`,
};

export async function createProject(formData: FormData) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const language = String(formData.get('language') ?? 'python');
  const { data: project, error } = await supabase
    .from('projects')
    .insert({ user_id: user.id, title: String(formData.get('title') || 'Untitled'), language })
    .select('id').single();
  if (error) throw error;

  // Seed a first snapshot so the canvas is never empty on first open.
  const { data: snapshot } = await supabase
    .from('snapshots')
    .insert({ project_id: project.id, source: STARTER[language] ?? '', language, status: 'ready' })
    .select('id').single();
  if (snapshot) {
    await supabase.from('projects')
      .update({ current_snapshot_id: snapshot.id }).eq('id', project.id);
  }

  redirect(`/projects/${project.id}`);
}

export async function saveSource(projectId: string, source: string, language: string) {
  const supabase = await createServerClient();
  const { data: snapshot, error } = await supabase
    .from('snapshots')
    .insert({ project_id: projectId, source, language, status: 'ready' })
    .select('id').single();
  if (error) return { error: error.message };

  await supabase.from('projects')
    .update({ current_snapshot_id: snapshot.id, updated_at: new Date().toISOString() })
    .eq('id', projectId);
  return { ok: true };
}
```

Create `src/app/(app)/projects/[id]/page.tsx`:

```tsx
import { notFound, redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { Workbench } from './Workbench';

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // RLS already scopes this to the owner; a wrong id simply returns nothing.
  const { data: project } = await supabase
    .from('projects').select('id, title, language, current_snapshot_id').eq('id', id).single();
  if (!project) notFound();

  const { data: snapshot } = project.current_snapshot_id
    ? await supabase.from('snapshots').select('source').eq('id', project.current_snapshot_id).single()
    : { data: null };

  return (
    <Workbench
      projectId={project.id}
      title={project.title}
      language={project.language as 'python' | 'cpp' | 'java'}
      initialSource={snapshot?.source ?? ''}
    />
  );
}
```

- [ ] **Step 10: Build the Workbench shell**

Create `src/app/(app)/projects/[id]/Workbench.tsx`. Three panes on desktop, tabs under 768px:

```tsx
'use client';

import { useCallback, useState } from 'react';
import { CodeEditor } from '@/components/editor/CodeEditor';
import { FlowCanvas } from '@/components/canvas/FlowCanvas';
import { Skeleton } from '@/components/ui/Skeleton';
import { useParse } from '@/lib/useParse';
import { saveSource } from '../actions';
import type { Language } from '@/lib/ir/types';

type Pane = 'code' | 'diagram';

interface Props {
  projectId: string; title: string; language: Language; initialSource: string;
}

export function Workbench({ projectId, title, language, initialSource }: Props) {
  const [source, setSource] = useState(initialSource);
  const [revealLine, setRevealLine] = useState<number | undefined>();
  const [activeFn, setActiveFn] = useState(0);
  const [pane, setPane] = useState<Pane>('diagram');
  const { ir, layouts, status, error } = useParse(source, language);

  // Durable write on idle (spec sec.7). Client sends SOURCE only, never a graph.
  const onChange = useCallback((next: string) => {
    setSource(next);
    window.clearTimeout((window as unknown as { __cfSave?: number }).__cfSave);
    (window as unknown as { __cfSave?: number }).__cfSave = window.setTimeout(() => {
      void saveSource(projectId, next, language);
    }, 1500);
  }, [projectId, language]);

  const fn = ir?.functions[activeFn];
  const layout = fn ? layouts[fn.id] : undefined;

  return (
    <div className="wb">
      <header className="wb__bar">
        <h1 className="wb__title">{title}</h1>
        <nav className="wb__tabs" role="tablist" aria-label="Functions">
          {ir?.functions.map((f, i) => (
            <button
              key={f.id} role="tab" aria-selected={i === activeFn}
              className="wb__tab" onClick={() => setActiveFn(i)}
            >{f.name}</button>
          ))}
        </nav>
        <span className="wb__status" data-status={status}>
          {status === 'parsing' ? 'syncing' : status === 'error' ? 'error' : 'saved'}
        </span>
      </header>

      <div className="wb__panes" data-pane={pane}>
        <section className="wb__editor" aria-label="Code">
          <CodeEditor
            value={source} language={language} theme="dark"
            revealLine={revealLine} onChange={onChange}
          />
        </section>

        <section className="wb__canvas" aria-label="Diagram">
          {status === 'first-load' && <Skeleton label="Building your diagram" />}
          {error && <p className="wb__error" role="status">{error}</p>}
          {fn && layout && (
            <FlowCanvas
              graph={fn} layout={layout}
              onNodeClick={(line) => setRevealLine(line)}
            />
          )}
          {ir && ir.functions.length === 0 && status === 'ready' && (
            <p className="wb__empty">
              No functions found yet. Paste a function and the diagram appears here.
            </p>
          )}
        </section>
      </div>

      <nav className="wb__mobile-tabs" aria-label="View">
        <button onClick={() => setPane('code')} aria-pressed={pane === 'code'}>Code</button>
        <button onClick={() => setPane('diagram')} aria-pressed={pane === 'diagram'}>Diagram</button>
      </nav>
    </div>
  );
}
```

Add the shell CSS to `src/styles/globals.css` — canvas dominant on desktop, single pane on mobile:

```css
.wb { display: flex; flex-direction: column; height: 100dvh; }
.wb__bar {
  display: flex; align-items: center; gap: var(--space-md);
  padding: var(--space-xs) var(--space-md);
  border-bottom: var(--rule-hair) solid var(--color-rule);
}
.wb__title { font-size: var(--text-base); font-weight: 600; margin: 0; }
.wb__tabs { display: flex; gap: var(--space-2xs); overflow-x: auto; }
.wb__tab {
  font-family: var(--font-mono); font-size: var(--text-xs);
  padding: var(--space-2xs) var(--space-xs);
  border: var(--rule-hair) solid transparent; border-radius: var(--radius-pill);
  background: transparent; color: var(--color-ink-2); cursor: pointer;
  white-space: nowrap;   /* gate 49: no two-line clickable text */
}
.wb__tab[aria-selected="true"] { color: var(--color-accent); border-color: var(--color-rule); }
.wb__status { margin-left: auto; font-size: var(--text-xs); color: var(--color-ink-3); }
.wb__status[data-status="error"] { color: var(--color-danger); }

.wb__panes { display: grid; grid-template-columns: minmax(0, 4fr) minmax(0, 7fr); flex: 1; min-height: 0; }
.wb__editor { border-right: var(--rule-hair) solid var(--color-rule); overflow: hidden; min-width: 0; }
.wb__canvas { position: relative; background: var(--color-canvas); min-width: 0; }
.wb__empty, .wb__error { padding: var(--space-lg); color: var(--color-ink-2); max-width: 42ch; }
.wb__mobile-tabs { display: none; }

@media (max-width: 767px) {
  .wb__panes { grid-template-columns: minmax(0, 1fr); }
  .wb__panes[data-pane="code"] .wb__canvas { display: none; }
  .wb__panes[data-pane="diagram"] .wb__editor { display: none; }
  .wb__mobile-tabs {
    display: flex; border-top: var(--rule-hair) solid var(--color-rule);
  }
  .wb__mobile-tabs button {
    flex: 1; padding: var(--space-sm); background: transparent;
    border: 0; color: var(--color-ink-2); white-space: nowrap; cursor: pointer;
  }
  .wb__mobile-tabs button[aria-pressed="true"] { color: var(--color-accent); }
}
```

- [ ] **Step 11: Write the E2E test**

Create `tests/e2e/slice.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

const EMAIL = `e2e-${Date.now()}@test.local`;
const PASSWORD = 'test-password-123';

test('signup, create a project, see a diagram, click a node', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: /sign up/i }).click();

  await expect(page).toHaveURL(/\/projects/);

  await page.getByLabel('Title').fill('Binary search');
  await page.getByRole('button', { name: /create/i }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+/);

  // The starter snippet seeds the canvas — a loop header must appear.
  const loopNode = page.locator('.cf-node[data-kind="loop-header"]');
  await expect(loopNode).toBeVisible({ timeout: 20_000 });

  // Two branches (if / elif) and two returns for binary search
  await expect(page.locator('.cf-node[data-kind="branch"]')).toHaveCount(2);
  await expect(page.locator('.cf-node[data-kind="return"]')).toHaveCount(2);

  // Clicking a node reveals its line in the editor
  await loopNode.click();
  await expect(page.locator('.cm-activeLine')).toBeVisible();
});

test('the page has no horizontal scroll at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/login');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
```

Create `playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: 'http://localhost:3000' },
  webServer: { command: 'pnpm dev', url: 'http://localhost:3000', reuseExistingServer: true },
});
```

- [ ] **Step 12: Run the whole suite**

```bash
pnpm test              # unit: theme, ids, builder, python, golden, layout, toReactFlow
pnpm vitest run tests/rls.test.ts
pnpm exec playwright test
pnpm lint && pnpm exec tsc --noEmit
```

Expected: all green. **Do not proceed past a failing RLS test.**

- [ ] **Step 13: Verify by eye**

Run `pnpm dev`, sign up, create a project. Confirm against Spec §10:
- The binary-search diagram shows one loop header (doubled left rule + ↻), two diamonds,
  two returns (filled cap), and a dashed back edge labelled `while`.
- Toggle `data-theme="light"` on `<html>`: readable, and **no bloom**.
- Tab through: every control shows a visible focus ring that does **not** animate in.
- At 320px width: single pane, tabs at the bottom, no horizontal scroll.

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "feat: editor, React Flow canvas with shape-based node semantics, project routes"
```

---

## Self-Review

**Spec coverage (§ → task):**

| Spec section | Covered by |
|---|---|
| §4 Stack | Tasks 1, 2, 5, 6, 7 |
| §5 IR + 7 hard constructs | Task 3 (types), Task 4 (builder: switch fallthrough, labeled break, finally, for/else, multi-return, do-while, foreach) |
| §6 Stable IDs | Task 3 — consequences table encoded as tests |
| §7 Data flow (client instant path) | Task 6 (worker, debounce, skeleton-first-load-only) |
| §8 Schema + RLS | Task 2 |
| §10 UI, both themes, non-colour semantics, motion cap | Tasks 1, 7 |
| §11 Errors degrade | Task 4 (malformed break), Task 5 (partial IR + diagnostics), Task 6 (ELK fallback), Task 7 (empty/error states) |
| §12 Testing | Every task; E2E in Task 7 |

**Deferred to Plan 2 (slices 4–9), by design:** Inngest durable pipeline and Realtime (§7 server
path), `layout_overrides` write path and orphan GC (§8), C++/Java adapters (§5), export (§8 of
the build order), BYOK + chat (§9), marketing surface (§10). Task 7 writes snapshots directly
via a server action as an interim measure; Plan 2 moves that behind Inngest.

**Type consistency:** `parseToIR`, `buildProgramIR`, `buildFunctionGraph`, `layoutFunction`,
`layoutProgram`, `toReactFlow`, `nodeSize`, `IdBuilder.{enter,exit,block,path}`, `makeNodeId`,
`resolveTheme` — each defined once and used with matching signatures. `SynNode.meta` fields
(`loopKind`, `label`, `caseValue`, `isDefault`, `elseBody`, `finallyBody`,
`catchBodies: SynNode[][]`, `unsupported`) are declared in Task 4 and produced by Task 5's
adapter. There is no `hasElse`: an else arm exists exactly when `meta.elseBody` is non-empty.

**Known gap carried forward:** `src/lib/ir/languages/registry.ts` points `cpp` and `java` at the
Python adapter as a placeholder so the registry shape is right. Plan 2 Task 1 replaces both.
This is recorded in `PROGRESS.md` so it is not mistaken for working code.
