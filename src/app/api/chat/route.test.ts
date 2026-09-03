// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Alias mocking (verifies the `@` alias works in vitest): the route imports
// these three server-only modules, and every test below runs against fakes.
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(),
  createServiceClient: vi.fn(),
}));

vi.mock('@/lib/ai/keys', () => ({
  getDecryptedKey: vi.fn(),
}));

vi.mock('@/lib/ai/context', () => ({
  buildContext: vi.fn(() => 'mock grounded context'),
}));

import { POST } from './route';
import { createServerClient, createServiceClient } from '@/lib/supabase/server';
import { getDecryptedKey } from '@/lib/ai/keys';

type ServerClient = Awaited<ReturnType<typeof createServerClient>>;
type ServiceClient = ReturnType<typeof createServiceClient>;

const USER_ID = 'user-1';
const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const SNAPSHOT = { id: 'snap-1', source: 'def f():\n    pass\n', language: 'python' };

function validBody() {
  return {
    projectId: PROJECT_ID,
    provider: 'openai',
    messages: [{ role: 'user', content: 'why does this loop terminate?' }],
  };
}

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

interface UserClientOpts {
  userId: string | null;
  projectFound?: boolean;
  snapshot?: typeof SNAPSHOT | null;
  graphIr?: unknown;
}

/** RLS-bound user client fake: supports the three query shapes the route uses. */
function makeUserClient(opts: UserClientOpts): ServerClient {
  const projectFound = opts.projectFound ?? true;
  const snapshot = opts.snapshot === undefined ? SNAPSHOT : opts.snapshot;
  const hasGraphIr = opts.graphIr !== undefined;
  const client = {
    auth: {
      getUser: async () => ({ data: { user: opts.userId ? { id: opts.userId } : null } }),
    },
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        single: async () => {
          if (table === 'projects') {
            if (projectFound) return { data: { id: PROJECT_ID }, error: null };
            return { data: null, error: { message: 'not found' } };
          }
          return { data: null, error: { message: 'unexpected single' } };
        },
        maybeSingle: async () => {
          if (table === 'snapshots') return { data: snapshot, error: null };
          if (table === 'graphs') {
            if (!hasGraphIr) return { data: null, error: null };
            return { data: { ir: opts.graphIr }, error: null };
          }
          return { data: null, error: null };
        },
      };
      return chain;
    },
  };
  return client as unknown as ServerClient;
}

/** Service client fake for best-effort persistence: records message inserts. */
function makeServiceClient(inserted: Array<unknown>): ServiceClient {
  const client = {
    from: (table: string) => {
      if (table === 'chat_messages') {
        return {
          insert: async (rows: unknown) => {
            inserted.push(rows);
            return { error: null };
          },
        };
      }
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        insert: () => chain,
        single: async () => ({ data: { id: 'thread-1' }, error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return chain;
    },
  };
  return client as unknown as ServiceClient;
}

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/chat', () => {
  it('401s without a user and never calls the provider', async () => {
    vi.mocked(createServerClient).mockResolvedValue(makeUserClient({ userId: null }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(postRequest(validBody()));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('unauthorized');
    expect(typeof body.message).toBe('string');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('400s with no-key when the user has no stored key, pointing at Settings', async () => {
    vi.mocked(createServerClient).mockResolvedValue(makeUserClient({ userId: USER_ID }));
    vi.mocked(createServiceClient).mockReturnValue(makeServiceClient([]));
    vi.mocked(getDecryptedKey).mockResolvedValue(null);
    vi.stubGlobal('fetch', vi.fn());

    const res = await POST(postRequest(validBody()));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('no-key');
    expect(body.message).toMatch(/Settings/);
    expect(body.message).toMatch(/OpenAI/);
  });

  it('maps a provider 401 to a rejection naming the provider label, without the raw body', async () => {
    vi.mocked(createServerClient).mockResolvedValue(makeUserClient({ userId: USER_ID }));
    vi.mocked(createServiceClient).mockReturnValue(makeServiceClient([]));
    vi.mocked(getDecryptedKey).mockResolvedValue('sk-test-key-material');
    const rawSecret = 'sk-abc123-leaked';
    const rawAccount = 'acct-secret-999';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(`{"error":{"message":"invalid api key ${rawSecret}","account":"${rawAccount}"}}`, {
          status: 401,
        }),
      ),
    );

    const res = await POST(postRequest(validBody()));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; message: string };
    const serialized = JSON.stringify(body);
    expect(body.message).toMatch(/OpenAI/);
    expect(body.message).toMatch(/Settings/);
    expect(serialized).not.toContain(rawSecret);
    expect(serialized).not.toContain(rawAccount);
    expect(serialized).not.toContain('sk-test-key-material');
  });

  it('reassembles SSE chunks split mid-payload and streams plain text', async () => {
    vi.mocked(createServerClient).mockResolvedValue(makeUserClient({ userId: USER_ID }));
    const inserted: Array<unknown> = [];
    vi.mocked(createServiceClient).mockReturnValue(makeServiceClient(inserted));
    vi.mocked(getDecryptedKey).mockResolvedValue('sk-test-key-material');
    // Split mid-JSON so a naive per-chunk parse would drop content.
    const wire = [
      'data: {"choices":[{"delta":{"content":"Hel',
      '"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo wor',
      '"}}]}\n\ndata: {"choices":[{"delta":{"content":"ld"}}]}\n\ndata: [DONE]\n\n',
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(sseStream(wire), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    );

    const res = await POST(postRequest(validBody()));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/plain');
    expect(await res.text()).toBe('Hello world');
    // Best-effort persistence recorded the user message + assistant reply.
    expect(JSON.stringify(inserted)).toContain('Hello world');
  });

  it('400s on an unknown provider without calling fetch', async () => {
    vi.mocked(createServerClient).mockResolvedValue(makeUserClient({ userId: USER_ID }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(
      postRequest({ ...validBody(), provider: 'no-such-provider' }),
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('403s when the project is not theirs', async () => {
    vi.mocked(createServerClient).mockResolvedValue(
      makeUserClient({ userId: USER_ID, projectFound: false }),
    );
    vi.stubGlobal('fetch', vi.fn());

    const res = await POST(postRequest(validBody()));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('forbidden');
  });

  it('501s for a non-OpenAI-compatible provider without calling fetch', async () => {
    vi.mocked(createServerClient).mockResolvedValue(makeUserClient({ userId: USER_ID }));
    vi.mocked(createServiceClient).mockReturnValue(makeServiceClient([]));
    vi.mocked(getDecryptedKey).mockResolvedValue('sk-ant-test');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await POST(postRequest({ ...validBody(), provider: 'anthropic' }));
    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.message).toMatch(/Anthropic/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// All tests above run against mocked Supabase/fetch: no live database is
// touched, so no skipIf guard is needed. A live round-trip (real key +
// project) is deliberately not committed — it would need BYOK_KEK,
// SUPABASE_SERVICE_ROLE_KEY, and a billable provider call.
