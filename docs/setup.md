# Setup

Everything needed to run code-flow locally, and how to obtain each credential.

**Nothing here is required until Plan 1, Task 2.** Task 1 (scaffold + tokens) runs with no
environment variables at all.

---

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node | 20+ | `nvm install 20` |
| pnpm | 9+ | `npm i -g pnpm` |
| Docker | any recent | needed by the local Supabase stack |

## Quick start

```bash
pnpm install
cp .env.example .env.local     # then fill it in, see below
pnpm dlx supabase start        # prints the local URL + keys
pnpm grammars                  # builds tree-sitter WASM into public/grammars/
pnpm dev
```

---

## Environment variables

`.env.example` is the checked-in template. Copy it to `.env.local` and fill it in.
**`.env.local` is gitignored — never commit it.**

### Needed for local development

#### `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY`

**Local (recommended for development):** run `pnpm dlx supabase start`. It prints all three —
`API URL`, `anon key`, `service_role key`. The local values are fixed demo keys, identical on
every machine, and are safe to share. Re-print them any time with `pnpm dlx supabase status`.

**Hosted:** create a project at [supabase.com/dashboard](https://supabase.com/dashboard) →
**Project Settings → API**. The URL and `anon` key are public by design (RLS is what protects
your data). The `service_role` key **bypasses RLS entirely** — server-side only, never in a
client component, never in a `NEXT_PUBLIC_*` variable.

#### `TWENTYFIRST_API_KEY`

Component search via the 21st.dev MCP server. Get it at
[21st.dev](https://21st.dev) → sign in → **API keys**. Free tier is enough.

Two places matter, and they are different files:

| Consumer | Where the value goes |
|---|---|
| Claude Code's MCP client | `.claude/settings.local.json` under `env` |
| The app at runtime | `.env.local` |

`.mcp.json` references it as `${TWENTYFIRST_API_KEY}` so the file itself stays safe to commit.

> The variable is **not** named `21ST_API_KEY`. A leading digit is not a valid shell identifier,
> so no shell can export it and the substitution silently fails.

Optional — only if the app needs it at runtime. MCP-only use requires just the settings file.

### Needed from Plan 2 onward (Inngest)

#### `INNGEST_EVENT_KEY` · `INNGEST_SIGNING_KEY`

**Local:** not needed. Run the dev server instead — it requires no keys:

```bash
pnpm dlx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

**Hosted:** [app.inngest.com](https://app.inngest.com) → your app → **Manage → Keys**.
Event keys send events; signing keys verify that incoming requests are really from Inngest.

### Needed from Plan 5 onward (AI chat)

#### `BYOK_KEK` · `BYOK_KEK_VERSION`

The key-encryption key that wraps users' provider API keys at rest (AES-256-GCM, spec §9).
**You generate this yourself** — it is not from a vendor:

```bash
openssl rand -base64 32
```

Set `BYOK_KEK_VERSION=1`. Bump it when you rotate, keeping the old key available so existing
rows still decrypt.

**Losing this makes every stored user key permanently unreadable.** Users would have to re-enter
them. Back it up somewhere real before shipping to anyone.

#### Provider keys — users supply their own

The app does **not** need provider keys in its environment. Each user adds their own in-app and
they are encrypted per-user. Listed here only because you will want one for development:

| Provider | Where to get a key | Notes |
|---|---|---|
| OpenAI | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | paid |
| Anthropic | [console.anthropic.com](https://console.anthropic.com) → API Keys | paid |
| OpenRouter | [openrouter.ai/keys](https://openrouter.ai/keys) | has free-tier models |
| Google AI Studio | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | generous free tier |
| Opencode Zen | opencode.ai — check current docs | free models; **base URL unverified, see below** |
| NVIDIA NIM | [build.nvidia.com](https://build.nvidia.com) → your profile → API keys | free credits; **base URL unverified** |

> **Open item:** the base URLs and OpenAI-compatibility of **Opencode Zen** and **NVIDIA NIM**
> are not yet confirmed. Verify both when implementing Plan 5 rather than assuming. The provider
> registry is a table of `{ id, label, baseUrl, auth, openaiCompatible, models[] }`, so a
> correction is one row.

---

## MCP servers

Both are project-scoped in `.mcp.json` and shared with anyone who clones the repo.

```bash
claude mcp list      # both should read "Connected"
```

| Server | Purpose | Auth |
|---|---|---|
| **supabase** | inspect schema, apply migrations, check RLS | OAuth in-client on first use |
| **21st** | component search | `TWENTYFIRST_API_KEY` (above) |

A project-scoped server needs approval on first use — run `claude` and approve, or set
`enableAllProjectMcpServers: true` in `.claude/settings.local.json`.

The Supabase server has write features enabled (`database`, `development`, `branching`), so it
can apply DDL. Prefer generating migration files under `supabase/migrations/` over ad-hoc
schema changes, so the schema stays reproducible from the repo.

---

## Tree-sitter grammars

```bash
pnpm grammars
```

Builds `public/grammars/tree-sitter-{python,cpp,java}.wasm` plus `tree-sitter.wasm`. They are
**served**, never bundled — each is 1–3MB and they load lazily per language on first use.

If the build fails (`tree-sitter build --wasm` needs docker or emscripten), fall back to a
prebuilt source: `pnpm add @vscode/tree-sitter-wasm` and copy from there, or download the
release asset for each grammar. **Record which route worked in `PROGRESS.md`** so the next
person does not repeat the diagnosis.

---

## Verification

```bash
pnpm test                          # unit
pnpm vitest run tests/rls.test.ts  # isolation — must pass
pnpm exec playwright test          # E2E
pnpm lint && pnpm exec tsc --noEmit
```

A negative RLS test that passes when it should fail means a policy is wrong. Fix the policy,
`pnpm dlx supabase db reset`, re-run.

## Secrets hygiene

Gitignored and staying that way:

```
.env.local                      # app runtime secrets
.claude/settings.local.json     # MCP key for Claude Code
```

Safe to commit: `.mcp.json` (env references only), `.env.example` (empty template).

Before any push:

```bash
git diff --cached | grep -iE '(sk-|api[_-]?key|secret|BEGIN.*PRIVATE)'
```
