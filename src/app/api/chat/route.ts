import { NextResponse } from 'next/server';
import { createServerClient, createServiceClient } from '@/lib/supabase/server';
import { getProvider } from '@/lib/ai/providers';
import { getDecryptedKey } from '@/lib/ai/keys';
import { buildContext } from '@/lib/ai/context';
import type { Language, ProgramIR } from '@/lib/ir/types';

// nodejs, not edge: decryption needs node:crypto via the envelope module.
export const runtime = 'nodejs';

const PROVIDER_TIMEOUT_MS = 60_000;

interface ChatRequestMessage {
  role: 'user' | 'assistant';
  content: string;
}

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: code, message }, { status });
}

function isLanguage(value: unknown): value is Language {
  return value === 'python' || value === 'cpp' || value === 'java' || value === 'javascript';
}

/**
 * Rebuild the smallest usable ProgramIR from the stored graphs.ir JSON.
 * The row was written by our own analyze job, so its shape is trusted;
 * anything unexpected falls back to an empty-functions IR rather than
 * failing the chat request.
 */
function toProgramIR(raw: unknown, fallbackLanguage: Language): ProgramIR {
  const fallback: ProgramIR = {
    language: fallbackLanguage,
    functions: [],
    callEdges: [],
    diagnostics: [],
    irVersion: 1,
  };
  if (typeof raw !== 'object' || raw === null) return fallback;
  const rec = raw as Partial<ProgramIR>;
  const language = isLanguage(rec.language) ? rec.language : fallbackLanguage;
  const functions = Array.isArray(rec.functions) ? rec.functions : [];
  const callEdges = Array.isArray(rec.callEdges) ? rec.callEdges : [];
  const diagnostics = Array.isArray(rec.diagnostics) ? rec.diagnostics : [];
  const irVersion = typeof rec.irVersion === 'number' ? rec.irVersion : 1;
  return { language, functions, callEdges, diagnostics, irVersion };
}

/** Extract streamed text from one parsed SSE payload, or null when absent. */
function extractDeltaText(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const rec = payload as { choices?: unknown };
  if (!Array.isArray(rec.choices) || rec.choices.length === 0) return null;
  const first = rec.choices[0] as { delta?: unknown } | null | undefined;
  if (typeof first !== 'object' || first === null) return null;
  const delta = first.delta as { content?: unknown } | null | undefined;
  if (typeof delta !== 'object' || delta === null) return null;
  return typeof delta.content === 'string' && delta.content.length > 0 ? delta.content : null;
}

/** Feed one decoded SSE buffer split into lines; returns text found. */
function extractSseTexts(buffer: string): { texts: string[]; done: boolean } {
  const texts: string[] = [];
  let done = false;
  for (const rawLine of buffer.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) continue;
    const data = line.slice('data:'.length).trim();
    if (data === '[DONE]') {
      done = true;
      continue;
    }
    if (!data) continue;
    try {
      const payload: unknown = JSON.parse(data);
      const text = extractDeltaText(payload);
      if (text !== null) texts.push(text);
    } catch {
      // A malformed SSE line is provider noise, not a chat failure.
    }
  }
  return { texts, done };
}

function isTimeoutError(err: unknown): boolean {
  if (err instanceof DOMException) {
    return err.name === 'TimeoutError' || err.name === 'AbortError';
  }
  if (err instanceof Error) {
    return (
      err.name === 'TimeoutError' ||
      err.name === 'AbortError' ||
      /aborted|timed out|timeout/i.test(err.message)
    );
  }
  return false;
}

/** Map a provider HTTP status to our plain-language 502 (never raw bodies). */
function providerStatusError(status: number, label: string): NextResponse {
  if (status === 401 || status === 403) {
    return jsonError(
      'key-rejected',
      `Your ${label} key was rejected. Check it in Settings and try again.`,
      502,
    );
  }
  if (status === 429) {
    return jsonError(
      'rate-limited',
      `${label} is rate-limiting you. Wait a moment and try again.`,
      502,
    );
  }
  return jsonError(
    'provider-error',
    `${label} is having trouble. Not your code — try again in a moment.`,
    502,
  );
}

interface PersistArgs {
  projectId: string;
  providerId: string;
  model: string;
  selectedNodeId: string | null;
  userMessages: ChatRequestMessage[];
  assistantReply: string;
}

/**
 * Best-effort chat history. Runs after a successful stream, inside try/catch
 * at the call site — it must never fail the user's response.
 */
async function persistExchange(args: PersistArgs): Promise<void> {
  const db = createServiceClient();
  const { data: existing } = await db
    .from('chat_threads')
    .select('id')
    .eq('project_id', args.projectId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  const existingRow = existing as { id: string } | null;
  let threadId: string | null = existingRow?.id ?? null;
  if (!threadId) {
    const { data: created } = await db
      .from('chat_threads')
      .insert({ project_id: args.projectId, title: 'Untitled' })
      .select('id')
      .single();
    const createdRow = created as { id: string } | null;
    threadId = createdRow?.id ?? null;
  }
  if (!threadId) return;
  const nodeContext = { selectedNodeId: args.selectedNodeId };
  const rows: Array<{
    thread_id: string;
    role: string;
    content: string;
    provider: string;
    model: string;
    node_context: { selectedNodeId: string | null };
  }> = args.userMessages.map((m) => ({
    thread_id: threadId as string,
    role: m.role,
    content: m.content,
    provider: args.providerId,
    model: args.model,
    node_context: nodeContext,
  }));
  if (args.assistantReply.length > 0) {
    rows.push({
      thread_id: threadId as string,
      role: 'assistant',
      content: args.assistantReply,
      provider: args.providerId,
      model: args.model,
      node_context: nodeContext,
    });
  }
  if (rows.length === 0) return;
  await db.from('chat_messages').insert(rows);
}

function buildSystemPrompt(context: string): string {
  return [
    'You are a programming tutor inside code-flow. Explain the user\u2019s code and suggest improvements as plain text.',
    '',
    'You are read-only: you cannot edit code, the diagram, or files. Never claim to have changed the user\u2019s code.',
    '',
    'Ground every answer in the provided code and control-flow summary below. Use the user\u2019s own function and variable names. If the code has syntax errors, say so plainly instead of explaining it as if it works.',
    '',
    '<code-and-graph>',
    context,
    '</code-and-graph>',
  ].join('\n');
}

/**
 * POST /api/chat { projectId, provider, model?, messages, selectedNodeId? }
 * Streams plain-text chunks on success; JSON { error, message } on failure.
 */
export async function POST(req: Request): Promise<Response> {
  // 1. Authenticate; 401 if not signed in.
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError('unauthorized', 'Not signed in. Please sign in and try again.', 401);
  }

  // 2. Validate the body: projectId/provider/messages non-empty, roles strict.
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonError('bad-request', 'Could not read that request. Try again.', 400);
  }
  const body = (typeof rawBody === 'object' && rawBody !== null ? rawBody : {}) as Record<
    string,
    unknown
  >;
  const projectId = typeof body.projectId === 'string' ? body.projectId : '';
  const providerId = typeof body.provider === 'string' ? body.provider : '';
  const modelOverride = typeof body.model === 'string' && body.model.trim() !== '' ? body.model : undefined;
  if (body.model !== undefined && modelOverride === undefined) {
    return jsonError('bad-request', 'That model name is not usable. Try again.', 400);
  }
  const selectedNodeId =
    body.selectedNodeId === undefined || body.selectedNodeId === null
      ? null
      : typeof body.selectedNodeId === 'string'
        ? body.selectedNodeId
        : undefined;
  if (selectedNodeId === undefined) {
    return jsonError('bad-request', 'That selected node is not usable. Try again.', 400);
  }
  if (!projectId) {
    return jsonError('bad-request', 'That request is missing its project. Try again.', 400);
  }
  if (!providerId) {
    return jsonError('bad-request', 'Choose a provider and try again.', 400);
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return jsonError('bad-request', 'Write a message before sending.', 400);
  }
  const messages: ChatRequestMessage[] = [];
  for (const item of body.messages) {
    if (typeof item !== 'object' || item === null) {
      return jsonError('bad-request', 'Those messages are not usable. Try again.', 400);
    }
    const rec = item as Record<string, unknown>;
    if (rec.role !== 'user' && rec.role !== 'assistant') {
      return jsonError('bad-request', 'Those messages are not usable. Try again.', 400);
    }
    if (typeof rec.content !== 'string' || rec.content.length === 0) {
      return jsonError('bad-request', 'Messages cannot be empty. Try again.', 400);
    }
    messages.push({ role: rec.role, content: rec.content });
  }

  const provider = getProvider(providerId);
  if (!provider) {
    return jsonError(
      'unknown-provider',
      `Unknown provider "${providerId}". Choose a supported provider and try again.`,
      400,
    );
  }

  // 3. Ownership: fetch the project row through the user's client (RLS
  // enforces); absent means not theirs, reported as 403 without confirming
  // that another user's project exists.
  const { data: projectRow, error: projectError } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .single();
  if (projectError || !projectRow) {
    return jsonError(
      'forbidden',
      'You do not have access to this project. Check the project and try again.',
      403,
    );
  }

  // 4. Newest snapshot + its graphs row (which may be missing), then the
  // grounded context from the SERVER's graph, never a client-supplied one.
  const { data: snapshotRow } = await supabase
    .from('snapshots')
    .select('id, source, language')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const snapshot = snapshotRow as { id: string; source: unknown; language: unknown } | null;
  if (!snapshot || typeof snapshot.source !== 'string') {
    return jsonError(
      'bad-request',
      'No code has been saved to this project yet. Save first, then ask.',
      400,
    );
  }
  const snapshotLanguage: Language = isLanguage(snapshot.language) ? snapshot.language : 'python';
  const snapshotId = typeof snapshot.id === 'string' ? snapshot.id : '';
  const { data: graphRow } = snapshotId
    ? await supabase.from('graphs').select('ir').eq('snapshot_id', snapshotId).maybeSingle()
    : { data: null };
  const graphIr = (graphRow as { ir: unknown } | null)?.ir;
  const ir = toProgramIR(graphIr, snapshotLanguage);
  const context = buildContext(ir, snapshot.source, selectedNodeId ?? undefined);

  // 5. Decrypt their key; null means they never added one for this provider.
  let apiKey: string | null;
  try {
    apiKey = await getDecryptedKey(user.id, provider.id);
  } catch {
    return jsonError('internal-error', 'Could not load your key. Try again.', 500);
  }
  if (!apiKey) {
    return jsonError(
      'no-key',
      `No ${provider.label} key saved. Add one in Settings, then ask again.`,
      400,
    );
  }

  // Non-OpenAI-compatible providers have no shared wire shape. Anthropic and
  // Google each need their own native request/response mapping, which is out
  // of P1 scope — say so honestly rather than sending a malformed request.
  if (!provider.openaiCompatible) {
    return jsonError(
      'unsupported-provider',
      `${provider.label} chat is not supported in this preview. OpenAI-compatible providers only for now.`,
      501,
    );
  }

  const model = modelOverride ?? provider.defaultModel;
  const systemPrompt = buildSystemPrompt(context);

  // 7. Provider call over the OpenAI-compatible shape, streaming SSE.
  let providerRes: Response;
  try {
    providerRes = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
      }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch (err) {
    if (isTimeoutError(err)) {
      return jsonError('provider-timeout', 'That took too long. Try a shorter question.', 502);
    }
    return jsonError(
      'provider-error',
      `${provider.label} is having trouble. Not your code — try again in a moment.`,
      502,
    );
  }

  if (!providerRes.ok) {
    // Read and discard the provider body so the socket frees, then drop it:
    // raw bodies can carry account details and read as a crash.
    try {
      await providerRes.text();
    } catch {
      // Discarding must never become its own failure.
    }
    return providerStatusError(providerRes.status, provider.label);
  }
  if (!providerRes.body) {
    return jsonError(
      'provider-error',
      `${provider.label} is having trouble. Not your code — try again in a moment.`,
      502,
    );
  }

  const upstream: ReadableStream<Uint8Array> = providerRes.body;
  const encoder = new TextEncoder();
  const userMessages = messages.filter((m) => m.role === 'user');
  let fullReply = '';

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          const { texts } = extractSseTexts(lines.join('\n'));
          for (const text of texts) {
            fullReply += text;
            controller.enqueue(encoder.encode(text));
          }
        }
        buffer += decoder.decode();
        if (buffer.trim().length > 0) {
          const { texts } = extractSseTexts(buffer);
          for (const text of texts) {
            fullReply += text;
            controller.enqueue(encoder.encode(text));
          }
        }
        // Only on success: persist the exchange, best-effort.
        try {
          await persistExchange({
            projectId,
            providerId: provider.id,
            model,
            selectedNodeId,
            userMessages,
            assistantReply: fullReply,
          });
        } catch {
          // Persistence must never fail the response.
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      } finally {
        reader.releaseLock();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
}
