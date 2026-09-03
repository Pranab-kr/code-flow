import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ChatPanel } from './ChatPanel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A real streaming body: the panel reads it through getReader(). */
function streamResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/plain' } });
}

function errorResponse(code: string, message: string): Response {
  return {
    ok: false,
    status: 400,
    body: null,
    json: () => Promise.resolve({ error: code, message }),
  } as unknown as Response;
}

function ask(question: string) {
  fireEvent.change(screen.getByRole('textbox', { name: /ask about this code/i }), {
    target: { value: question },
  });
  fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
}

describe('ChatPanel', () => {
  it('disables send while the input is empty, enables it with text', () => {
    render(<ChatPanel projectId="p1" />);
    const send = screen.getByRole('button', { name: /^send$/i });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: /ask about this code/i }), {
      target: { value: 'why?' },
    });
    expect(send).toBeEnabled();
  });

  it('streams chunks into a single assistant bubble', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(streamResponse(['Hello ', 'world']))));
    render(<ChatPanel projectId="p1" />);
    ask('explain this');

    expect(await screen.findByText('Hello world')).toBeInTheDocument();
    expect(screen.getByText('explain this')).toBeInTheDocument();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}')) as {
      projectId: string;
      provider: string;
      model: string;
      messages: { role: string; content: string }[];
    };
    expect(body.projectId).toBe('p1');
    expect(body.provider).toBe('openai');
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.messages).toEqual([{ role: 'user', content: 'explain this' }]);
  });

  it('shows the setup prompt, not a raw error, when no key is stored', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(errorResponse('no-key', 'No key saved for OpenAI yet.'))),
    );
    render(<ChatPanel projectId="p1" />);
    ask('why does this loop terminate?');

    const link = await screen.findByRole('link', { name: /set up your.*key/i });
    expect(link).toHaveAttribute('href', '/settings/keys');
    expect(screen.getByRole('alert')).toHaveTextContent(/no key saved/i);
    // The question stays on screen with a retry path back.
    expect(screen.getByText('why does this loop terminate?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('passes the selected node id with the question', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(streamResponse(['ok']))));
    render(<ChatPanel projectId="p1" selectedNodeId="f()/while@0#cond-b0" selectedLabel="loop-header" />);
    expect(screen.getByText('loop-header')).toBeInTheDocument();
    ask('why does this terminate?');

    await screen.findByText('ok');
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}')) as {
      selectedNodeId?: string;
    };
    expect(body.selectedNodeId).toBe('f()/while@0#cond-b0');
  });

  it('starter buttons fill and send a grounded question', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(streamResponse(['done']))));
    render(<ChatPanel projectId="p1" />);
    fireEvent.click(
      screen.getByRole('button', { name: /why does this loop terminate\?/i }),
    );

    // Filled (the user bubble shows it) AND sent (the route was called).
    expect(await screen.findByText('why does this loop terminate?')).toBeInTheDocument();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}')) as {
      messages: { role: string; content: string }[];
    };
    expect(body.messages[0]?.content).toBe('why does this loop terminate?');
  });

  it('stop aborts an in-flight stream and keeps the panel usable', async () => {
    const seen: { signal: AbortSignal | null } = { signal: null };
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        seen.signal = init?.signal ?? null;
        // Hangs like a slow stream, but rejects on abort exactly as fetch does.
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      }),
    );
    render(<ChatPanel projectId="p1" />);
    ask('explain this');

    const stop = await screen.findByRole('button', { name: /^stop$/i });
    expect(screen.getByRole('button', { name: /sending/i })).toBeDisabled();
    fireEvent.click(stop);
    expect(seen.signal?.aborted).toBe(true);

    // The abort settles back to idle: no stop control, no error, and a new
    // question can go out.
    await screen.findByRole('button', { name: /^send$/i });
    expect(screen.queryByRole('button', { name: /^stop$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: /ask about this code/i }), {
      target: { value: 'another question' },
    });
    expect(screen.getByRole('button', { name: /^send$/i })).toBeEnabled();
  });
});
