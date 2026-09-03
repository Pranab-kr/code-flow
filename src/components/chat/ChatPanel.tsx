'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ENABLED_PROVIDERS } from '@/lib/ai/providers';
import './ChatPanel.css';

/** One exchange turn. Matches POST /api/chat's `messages` shape exactly. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatPanelProps {
  projectId?: string;
  selectedNodeId?: string | null;
  selectedLabel?: string | null;
}

/**
 * Provider default models, sent as `model` on every chat request. The route
 * applies the same defaults when `model` is absent, so the two lists must stay
 * in sync — but sending explicitly keeps the panel honest about what the
 * learner is actually talking to.
 */
const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5',
  openrouter: 'openai/gpt-4o-mini',
  google: 'gemini-2.0-flash',
};

const STARTERS = [
  'why does this loop terminate?',
  'what happens when the array is empty?',
  'explain the recursion',
] as const;

interface SendError {
  code: string;
  message: string;
}

const FALLBACK_ERRORS: Record<string, string> = {
  unauthorized: 'You are not signed in. Sign in and try again.',
  forbidden: 'You do not have access to this project.',
  'no-key': 'No key is saved for this provider yet.',
  'bad-request': 'That request was not valid. Try rephrasing your question.',
  provider: 'The provider is having trouble. Try again in a moment.',
};

function fallbackFor(code: string): string {
  return FALLBACK_ERRORS[code] ?? 'The provider is having trouble. Try again in a moment.';
}

/**
 * A failed chat request carrying the route's machine-readable code
 * ('unauthorized' | 'forbidden' | 'no-key' | 'bad-request' | 'provider').
 */
class ChatRequestError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ChatRequestError';
    this.code = code;
    this.status = status;
  }
}

/** Reads the route's { error, message } body, falling back to plain language. */
async function readChatError(res: Response): Promise<ChatRequestError> {
  let code = 'provider';
  let message: string | null = null;
  try {
    const data = (await res.json()) as { error?: unknown; message?: unknown };
    if (typeof data.error === 'string' && data.error) code = data.error;
    if (typeof data.message === 'string' && data.message) message = data.message;
  } catch {
    // A non-JSON failure body says nothing usable; the fallback below covers it.
  }
  return new ChatRequestError(code, message ?? fallbackFor(code), res.status);
}

/**
 * Grounded Q&A over the learner's own graph. The panel never sees key material:
 * a missing key arrives as a `no-key` error code from the route, which renders
 * as a setup prompt — never as a raw failure.
 *
 * Send carries all 8 states via data-state: default, hover, focus-visible,
 * active, disabled (empty input, streaming, or no saved project), loading
 * (streaming, with a separate stop control), error (with retry), success
 * (the completed answer IS the confirmation, the state is the accent ring).
 */
export function ChatPanel({ projectId, selectedNodeId, selectedLabel }: ChatPanelProps) {
  const [provider, setProvider] = useState<string>(ENABLED_PROVIDERS[0]?.id ?? 'openai');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [sendError, setSendError] = useState<SendError | null>(null);
  const [failedQuestion, setFailedQuestion] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);

  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const inputId = useId();

  // The newest answer is at the bottom; keep it in view as chunks arrive.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const dropEmptyAssistantTail = useCallback((prev: ChatMessage[]): ChatMessage[] => {
    const last = prev[prev.length - 1];
    return last && last.role === 'assistant' && last.content === '' ? prev.slice(0, -1) : prev;
  }, []);

  const runExchange = useCallback(
    async (question: string, appendUser: boolean): Promise<void> => {
      const q = question.trim();
      if (!q || busyRef.current || !projectId) return;
      busyRef.current = true;
      setStreaming(true);
      setSendError(null);
      setFailedQuestion(null);
      setSucceeded(false);

      const outgoing: ChatMessage = { role: 'user', content: q };
      // Retry reuses the question already on screen; a fresh send appends it.
      const history = appendUser ? [...messages, outgoing] : [...messages];
      setMessages((prev) => [...prev, ...(appendUser ? [outgoing] : []), { role: 'assistant', content: '' }]);
      setInput('');

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const model = DEFAULT_MODELS[provider];
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            provider,
            ...(model ? { model } : {}),
            messages: history,
            ...(selectedNodeId ? { selectedNodeId } : {}),
          }),
          signal: controller.signal,
        });
        // A missing body on a 200 is a broken contract, not a partial answer.
        if (!res.ok || !res.body) throw await readChatError(res);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            const chunk = decoder.decode(value, { stream: true });
            if (chunk) {
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === 'assistant') {
                  next[next.length - 1] = { ...last, content: last.content + chunk };
                }
                return next;
              });
            }
          }
        }
        setSucceeded(true);
      } catch (err) {
        if (controller.signal.aborted) {
          // Stopped mid-stream: the partial answer stays, and stopping is not
          // an error, so no error state and no retry prompt.
        } else if (err instanceof ChatRequestError) {
          setMessages(dropEmptyAssistantTail);
          setSendError({ code: err.code, message: err.message });
          setFailedQuestion(q);
        } else {
          // A network failure has no route code; it is the provider's trouble.
          setMessages(dropEmptyAssistantTail);
          setSendError({ code: 'provider', message: fallbackFor('provider') });
          setFailedQuestion(q);
        }
      } finally {
        busyRef.current = false;
        abortRef.current = null;
        setStreaming(false);
      }
    },
    [messages, projectId, provider, selectedNodeId, dropEmptyAssistantTail],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const retry = useCallback(() => {
    if (failedQuestion) void runExchange(failedQuestion, false);
  }, [failedQuestion, runExchange]);

  const onSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      void runExchange(input, true);
    },
    [input, runExchange],
  );

  const providerLabel =
    ENABLED_PROVIDERS.find((p) => p.id === provider)?.label ?? provider;
  const canSend = Boolean(projectId) && input.trim().length > 0 && !streaming;
  const sendState = streaming ? 'loading' : sendError ? 'error' : succeeded ? 'success' : 'idle';
  const statusText = streaming ? 'Streaming the answer…' : succeeded ? 'Answer complete.' : null;

  return (
    <section className="chat" aria-label="Ask about this code">
      <header className="chat__head">
        <h2 className="chat__title">Ask</h2>
        {selectedLabel ? (
          <p className="chat__context">
            About <span className="chat__node">{selectedLabel}</span>
          </p>
        ) : (
          <p className="chat__context">About the whole diagram</p>
        )}
        <label className="chat__provider">
          <span className="chat__sr-only">Provider</span>
          <select
            className="chat__select"
            value={provider}
            disabled={streaming}
            onChange={(event) => {
              setProvider(event.target.value);
              // A different provider may have a key; its errors start fresh.
              setSendError(null);
              setFailedQuestion(null);
            }}
            aria-label="Provider"
          >
            {ENABLED_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div ref={logRef} className="chat__log" role="region" aria-label="Conversation">
        {messages.map((m, i) => (
          <div key={i} className="chat__msg" data-role={m.role}>
            <span className="chat__speaker">{m.role === 'user' ? 'You' : 'Assistant'}</span>
            {m.content === '' ? (
              <span className="chat__typing" aria-hidden="true">
                …
              </span>
            ) : (
              <p className="chat__text">{m.content}</p>
            )}
          </div>
        ))}
        {messages.length === 0 && (
          <div className="chat__empty">
            <p className="chat__emptyline">
              Ask about your own code — answers use your variable names, not a textbook&apos;s.
            </p>
            <div className="chat__starters">
              {STARTERS.map((q) => (
                <button
                  key={q}
                  type="button"
                  className="chat__starter"
                  disabled={!projectId || streaming}
                  onClick={() => void runExchange(q, true)}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {sendError && (
        <div className="chat__error" role="alert">
          <p className="chat__errortext">{sendError.message}</p>
          {sendError.code === 'no-key' && (
            <p className="chat__setup">
              Add one to start asking — it stays encrypted server-side and never reaches
              this browser again.{' '}
              <Link className="chat__setuplink" href="/settings/keys">
                Set up your {providerLabel} key
              </Link>
            </p>
          )}
          <button type="button" className="chat__retry" onClick={retry}>
            Try again
          </button>
        </div>
      )}

      {statusText && (
        <p className="chat__status" role="status">
          {statusText}
        </p>
      )}

      {projectId ? (
        <form className="chat__form" onSubmit={onSubmit}>
          <label htmlFor={inputId} className="chat__sr-only">
            Ask about this code
          </label>
          <input
            id={inputId}
            className="chat__input"
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              setSucceeded(false);
            }}
            placeholder="Ask about this code…"
            autoComplete="off"
            disabled={streaming}
          />
          {streaming && (
            <button type="button" className="chat__stop" onClick={stop}>
              Stop
            </button>
          )}
          <button
            type="submit"
            className="chat__send"
            data-state={sendState}
            disabled={!canSend}
            aria-busy={streaming || undefined}
          >
            {streaming ? 'Sending…' : 'Send'}
          </button>
        </form>
      ) : (
        <p className="chat__notice">
          Ask lives in saved projects — open a project to chat about its diagram.
        </p>
      )}
    </section>
  );
}
