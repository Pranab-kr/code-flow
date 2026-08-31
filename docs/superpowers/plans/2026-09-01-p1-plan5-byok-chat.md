# code-flow P1 — Plan 5: BYOK vault and grounded AI chat

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A learner adds their own provider key, asks "why does this loop terminate?", and gets a streamed answer grounded in their actual graph — using their variable names, not a textbook's.

**Architecture:** Keys are encrypted at rest with AES-256-GCM and decrypted only inside a server route. **No provider call ever originates in the browser.** Chat streams from a Next route handler via the AI SDK — not through Inngest, because a queue cannot stream tokens.

**Tech Stack:** `ai` (Vercel AI SDK), Node `crypto` (no dependency), Supabase, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-31-code-flow-p1-design.md` (§9 BYOK threat model, §7 why chat is not queued)

**Prerequisite:** Plan 2 (auth + Postgres). Plan 1 is enough for the graph context.

## Global Constraints

- **Keys never reach the browser after submission.** Not on read, not masked, not ever. The client sees `provider`, `label`, and `last4` — nothing more.
- **AES-256-GCM**, random 96-bit IV per record, **AAD bound to `user_id|provider`**, KEK from `BYOK_KEK`, `key_version` column for rotation.
- `user_provider_keys` is reachable **only** through the service-role client. RLS denies all anon access outright, so a leaked anon key exposes nothing.
- Keys must be **absent from every log, error report, and serialized response.** Add an explicit denylist and a test that greps serialized output.
- **P1's AI is read-only.** It explains and may suggest code as text. It never writes to the editor and never touches the graph. Diagram→code editing is P4 and needs its own spec.
- Provider errors map to plain language ("your OpenAI key was rejected"), never a raw dump.

---

## Task 1: Envelope encryption

**Files:**
- Create: `src/lib/crypto/envelope.ts`
- Test: `src/lib/crypto/envelope.test.ts`

**Interfaces:**
- Produces:
  - `encryptSecret(plaintext: string, aad: string): { ciphertext: string; iv: string; keyVersion: number }`
  - `decryptSecret(rec: { ciphertext: string; iv: string; keyVersion: number }, aad: string): string`
  - `aadFor(userId: string, provider: string): string`

- [ ] **Step 1: Generate a KEK and document it**

```bash
openssl rand -base64 32   # -> BYOK_KEK in .env.local
```

Add to `.env.local` and `.env.example`: `BYOK_KEK=`, `BYOK_KEK_VERSION=1`.

**Losing this makes every stored key permanently unreadable** — users would have to
re-enter them. Say so in `docs/setup.md` (already noted there) and back it up before any
real user exists.

- [ ] **Step 2: Write the failing test**

`src/lib/crypto/envelope.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { aadFor, decryptSecret, encryptSecret } from './envelope';

beforeAll(() => {
  process.env.BYOK_KEK = randomBytes(32).toString('base64');
  process.env.BYOK_KEK_VERSION = '1';
});

const SECRET = 'sk-test-abcdef0123456789';

describe('envelope encryption', () => {
  it('round-trips a secret', () => {
    const aad = aadFor('user-1', 'openai');
    expect(decryptSecret(encryptSecret(SECRET, aad), aad)).toBe(SECRET);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const aad = aadFor('user-1', 'openai');
    const a = encryptSecret(SECRET, aad);
    const b = encryptSecret(SECRET, aad);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
  });

  it('FAILS to decrypt when the AAD user differs', () => {
    // The whole point of binding AAD: a ciphertext copied into another user's row
    // must not decrypt. Without this it would silently work.
    const rec = encryptSecret(SECRET, aadFor('user-1', 'openai'));
    expect(() => decryptSecret(rec, aadFor('user-2', 'openai'))).toThrow();
  });

  it('FAILS to decrypt when the AAD provider differs', () => {
    const rec = encryptSecret(SECRET, aadFor('user-1', 'openai'));
    expect(() => decryptSecret(rec, aadFor('user-1', 'anthropic'))).toThrow();
  });

  it('FAILS on a tampered ciphertext (authentication, not just encryption)', () => {
    const aad = aadFor('user-1', 'openai');
    const rec = encryptSecret(SECRET, aad);
    const raw = Buffer.from(rec.ciphertext, 'base64');
    raw[0] ^= 0xff;
    expect(() => decryptSecret({ ...rec, ciphertext: raw.toString('base64') }, aad)).toThrow();
  });

  it('FAILS on a tampered IV', () => {
    const aad = aadFor('user-1', 'openai');
    const rec = encryptSecret(SECRET, aad);
    const iv = Buffer.from(rec.iv, 'base64');
    iv[0] ^= 0xff;
    expect(() => decryptSecret({ ...rec, iv: iv.toString('base64') }, aad)).toThrow();
  });

  it('stamps the key version so rotation is possible', () => {
    expect(encryptSecret(SECRET, aadFor('u', 'openai')).keyVersion).toBe(1);
  });

  it('refuses to run without a KEK rather than falling back to a weak default', () => {
    const saved = process.env.BYOK_KEK;
    delete process.env.BYOK_KEK;
    expect(() => encryptSecret(SECRET, aadFor('u', 'openai'))).toThrow(/BYOK_KEK/);
    process.env.BYOK_KEK = saved;
  });

  it('rejects a KEK that is not 32 bytes', () => {
    const saved = process.env.BYOK_KEK;
    process.env.BYOK_KEK = Buffer.from('too short').toString('base64');
    expect(() => encryptSecret(SECRET, aadFor('u', 'openai'))).toThrow(/32 bytes/);
    process.env.BYOK_KEK = saved;
  });

  it('never embeds the plaintext in its own output', () => {
    const rec = encryptSecret(SECRET, aadFor('u', 'openai'));
    expect(JSON.stringify(rec)).not.toContain(SECRET);
    expect(JSON.stringify(rec)).not.toContain('sk-test');
  });
});
```

- [ ] **Step 3: Run it** → FAIL (no module)

- [ ] **Step 4: Implement `envelope.ts`**

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const IV_BYTES = 12;    // 96-bit, the GCM standard
const TAG_BYTES = 16;

function kek(): Buffer {
  const raw = process.env.BYOK_KEK;
  if (!raw) throw new Error('BYOK_KEK is not set; refusing to encrypt with no key');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('BYOK_KEK must decode to 32 bytes for AES-256');
  return key;
}

/** Binds a ciphertext to one user AND one provider. */
export function aadFor(userId: string, provider: string): string {
  return `${userId}|${provider}`;
}

export interface SealedSecret {
  ciphertext: string;   // base64: ciphertext || authTag
  iv: string;           // base64
  keyVersion: number;
}

export function encryptSecret(plaintext: string, aad: string): SealedSecret {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', kek(), iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: Buffer.concat([body, cipher.getAuthTag()]).toString('base64'),
    iv: iv.toString('base64'),
    keyVersion: Number(process.env.BYOK_KEK_VERSION ?? '1'),
  };
}

export function decryptSecret(rec: SealedSecret, aad: string): string {
  const raw = Buffer.from(rec.ciphertext, 'base64');
  const body = raw.subarray(0, raw.length - TAG_BYTES);
  const tag = raw.subarray(raw.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', kek(), Buffer.from(rec.iv, 'base64'));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  // Throws on any mismatch: wrong AAD, tampered body, tampered IV.
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}
```

Note the honest limit from spec §9: an env-var KEK means a **database** leak alone does
not expose keys, but a **full server** compromise does — the KEK is in the same process.
Supabase Vault or a cloud KMS is the upgrade path; record that, do not pretend otherwise.

- [ ] **Step 5: Run it** → PASS (10 tests)

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: AES-256-GCM envelope encryption with AAD-bound secrets"
```

---

## Task 2: Key storage and provider registry

**Files:**
- Create: `supabase/migrations/0004_provider_keys.sql`
- Create: `src/lib/ai/providers.ts`, `src/lib/ai/keys.ts`
- Create: `src/app/api/keys/route.ts`
- Test: `src/lib/ai/providers.test.ts`, extend `tests/rls.test.ts`

- [ ] **Step 1: Migration**

```sql
create table user_provider_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  label text,
  last4 text not null,
  ciphertext text not null,
  iv text not null,
  key_version int not null default 1,
  created_at timestamptz not null default now(),
  unique (user_id, provider)
);

alter table user_provider_keys enable row level security;
-- NO policy on purpose: RLS with zero policies denies everything to anon and
-- authenticated roles. Only the service-role client (which bypasses RLS) may read
-- this table, and only from a server route.
```

- [ ] **Step 2: Extend the RLS test** — assert an authenticated client can read **nothing**
from `user_provider_keys`, even its own rows:

```ts
it('no client can read provider keys, not even their own', async () => {
  const { data } = await a.client.from('user_provider_keys').select('*');
  expect(data).toEqual([]);   // service-role only
});

it('no client can insert a provider key directly', async () => {
  const { error } = await a.client.from('user_provider_keys')
    .insert({ user_id: a.userId, provider: 'openai', last4: '1234', ciphertext: 'x', iv: 'y' });
  expect(error).not.toBeNull();
});
```

- [ ] **Step 3: Provider registry** — `src/lib/ai/providers.ts`

One table of `{ id, label, baseUrl, openaiCompatible, models[], keyHint }`, so a wrong
base URL is one row to fix rather than a code change.

```ts
export interface Provider {
  id: string;
  label: string;
  baseUrl: string;
  openaiCompatible: boolean;
  models: string[];
  /** Shown next to the input so the user knows they have the right key. */
  keyHint: string;
  /** Where to get one. */
  consoleUrl: string;
}

export const PROVIDERS: Provider[] = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1',
    openaiCompatible: true, models: [], keyHint: 'starts with sk-',
    consoleUrl: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', label: 'Anthropic', baseUrl: 'https://api.anthropic.com',
    openaiCompatible: false, models: [], keyHint: 'starts with sk-ant-',
    consoleUrl: 'https://console.anthropic.com' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1',
    openaiCompatible: true, models: [], keyHint: 'starts with sk-or-',
    consoleUrl: 'https://openrouter.ai/keys' },
  { id: 'google', label: 'Google AI Studio', baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    openaiCompatible: false, models: [], keyHint: '', consoleUrl: 'https://aistudio.google.com/apikey' },
  // VERIFY these two before shipping — base URL and OpenAI-compatibility were never
  // confirmed (spec §15 open item). Check the current docs, send one real request,
  // and only then fill in models[].
  { id: 'opencode-zen', label: 'Opencode Zen', baseUrl: 'TODO-VERIFY',
    openaiCompatible: true, models: [], keyHint: '', consoleUrl: 'https://opencode.ai' },
  { id: 'nvidia-nim', label: 'NVIDIA NIM', baseUrl: 'TODO-VERIFY',
    openaiCompatible: true, models: [], keyHint: 'starts with nvapi-',
    consoleUrl: 'https://build.nvidia.com' },
];
```

- [ ] **Step 4: Test that the registry cannot ship half-finished**

```ts
it('every enabled provider has a real base URL', () => {
  for (const p of ENABLED_PROVIDERS) {
    expect(p.baseUrl, `${p.id}`).toMatch(/^https:\/\//);
    expect(p.baseUrl).not.toContain('TODO');
  }
});
```

Keep unverified providers out of `ENABLED_PROVIDERS` until someone confirms them. A
provider that 404s is worse than one that is absent.

- [ ] **Step 5: Key routes** — `POST /api/keys` (encrypt and upsert, return only
`{ provider, label, last4 }`), `GET` (list metadata only), `DELETE`. Every handler
authenticates first and uses the service-role client solely for this table.

- [ ] **Step 6: Test the response never leaks**

```ts
it('the POST response contains no part of the key', async () => {
  const res = await postKey({ provider: 'openai', key: 'sk-secret-123456789' });
  const body = JSON.stringify(res);
  expect(body).not.toContain('sk-secret');
  expect(body).toContain('6789');     // last4 only
});
```

- [ ] **Step 7: Commit**

```bash
git commit -m "feat: BYOK key vault with service-role-only access"
```

---

## Task 3: Grounded chat

**Files:**
- Create: `src/lib/ai/context.ts`, `src/app/api/chat/route.ts`
- Create: `supabase/migrations/0005_chat.sql`
- Test: `src/lib/ai/context.test.ts`

**Interfaces:**
- Produces: `buildContext(ir, source, selectedNodeId?): string`

- [ ] **Step 1: Migration** for `chat_threads` and `chat_messages` per spec §8, with the
same `owns_project`-based RLS as everything else, plus negative tests.

- [ ] **Step 2: Test-drive the context builder** — this is what makes answers about *their*
code rather than a generic explanation:

```ts
describe('buildContext', () => {
  it('includes the source', () => {
    expect(buildContext(ir, 'def f():\n    pass\n')).toContain('def f()');
  });

  it('summarizes the graph structurally, not as raw json', () => {
    const out = buildContext(ir, src);
    expect(out).toContain('loop-header');
    expect(out).not.toContain('"irVersion"');   // raw IR wastes the window
  });

  it('names the selected node so "this node" is answerable', () => {
    const out = buildContext(ir, src, 'f()/while@0#cond-b0');
    expect(out).toMatch(/selected/i);
  });

  it('reports syntax errors, so the model does not explain broken code as working', () => {
    expect(buildContext(irWithErrors, src)).toMatch(/syntax error/i);
  });

  it('truncates predictably on a large graph', () => {
    expect(buildContext(hugeIr, hugeSrc).length).toBeLessThan(24_000);
  });
});
```

- [ ] **Step 3: Chat route** — `src/app/api/chat/route.ts`

Streams via the AI SDK. **Not Inngest**: a queue cannot stream tokens (spec §7).

```ts
export const runtime = 'nodejs';   // needs node:crypto to decrypt

export async function POST(req: Request) {
  // 1. authenticate; 401 if not signed in
  // 2. verify the user owns projectId (RLS does this, but fail fast and clearly)
  // 3. load + decrypt their key for the requested provider (service-role client)
  // 4. build the grounded context from the SERVER's graph, not a client-supplied one
  // 5. stream the response
  // 6. persist the exchange to chat_messages after the stream completes
}
```

The system prompt states the read-only boundary plainly: explain and suggest, never claim
to have changed the user's code. P1 has no write path, and an assistant that implies
otherwise trains the user to expect one.

- [ ] **Step 4: Map provider failures to plain language**

| Status | Message |
|---|---|
| 401 / 403 | "Your {provider} key was rejected. Check it in Settings." |
| 429 | "{provider} is rate-limiting you. Wait a moment and try again." |
| 5xx | "{provider} is having trouble. Not your code." |
| timeout | "That took too long. Try a shorter question." |

Never surface a raw provider body: it can contain account details and reads as a crash.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: streaming chat grounded in the server-derived graph"
```

---

## Task 4: Chat panel and settings UI

**Files:**
- Create: `src/components/chat/ChatPanel.tsx`, `ChatPanel.css`
- Create: `src/app/(app)/settings/keys/page.tsx`
- Modify: the Workbench (third pane)

- [ ] **Step 1: Settings page.** Add, replace, delete keys. Display is `provider · label ·
••••1234` — the input is `type="password"`, `autocomplete="off"`, and after saving it
clears and never repopulates. Each provider links to its console so a learner can find
where to get a key.

- [ ] **Step 2: Chat panel.** Collapsible third pane, streaming, with the selected canvas
node passed as context so "why does this loop terminate?" resolves against the right
block. Under 768px it becomes the third tab (Code / Diagram / Ask).

- [ ] **Step 3: Empty and error states that teach.** No key configured shows a setup
prompt, not an error. Suggest three starter questions grounded in the current graph
("why does this loop terminate?", "what happens when the array is empty?", "explain the
recursion") — a blank box does not tell a learner what this is for.

- [ ] **Step 4: All 8 states** on send: disabled while empty, loading while streaming
(with a stop control), error with a retry.

- [ ] **Step 5: Verify by hand**

1. Add a real key. Confirm in devtools that **no response body contains it**.
2. Ask about a selected node — the answer must use the user's own variable names.
3. Delete the key: chat returns to the setup prompt, not an error.
4. Enter a deliberately wrong key: a plain-language rejection, no raw JSON.
5. Check the server logs: **no key material anywhere.**

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: chat panel and BYOK settings"
```

---

## Self-Review

**Spec coverage:** §9 every BYOK rule has a test; §7 chat streams from a route handler;
§11 provider failures degrade to plain language.

**Security checklist before calling this done:**
- [ ] No provider key in any HTTP response body
- [ ] No provider key in any log line
- [ ] `user_provider_keys` unreadable by an authenticated client (tested)
- [ ] Wrong-AAD decryption fails (tested)
- [ ] `createServiceClient` imported only in server files (grep to confirm)
- [ ] `BYOK_KEK` documented as unrecoverable if lost

**Done when:** a user adds a key, asks about their own code, gets a streamed grounded
answer, and the key never appears anywhere a browser or log can see it.
