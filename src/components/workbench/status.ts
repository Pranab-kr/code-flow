import type { ParseStatus } from '@/lib/useParse';
import type { SnapshotStatus } from '@/lib/useSnapshotStatus';

/** In-flight state of the client's own save request. */
export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Which token the indicator uses. Not a colour name: `busy` is amber and `ok` is
 * green today, and the point of naming the meaning instead is that the label
 * always carries the same information (spec §10 — never colour alone).
 */
export type StatusTone = 'neutral' | 'busy' | 'ok' | 'error';

export interface StatusInput {
  /** The browser's own parse — this is what is drawn on screen. */
  parse: ParseStatus;
  save: SaveState;
  /** The server's analyze job. null before it has reported anything. */
  server: SnapshotStatus | null;
  serverError: string | null;
  errorCount: number;
  /** False on the demo route, where there is no project and nothing is stored. */
  persists: boolean;
}

export interface StatusView {
  label: string;
  tone: StatusTone;
  /** Show a retry affordance: the server analysis failed and can be re-queued. */
  retry: boolean;
  /** Tooltip — the underlying reason, when there is one worth showing. */
  title?: string;
}

/**
 * Reduce two independent status feeds to one honest line of text.
 *
 * The client's parse and the server's analysis are genuinely separate facts and
 * they routinely disagree: a good diagram on screen while the queue is
 * unreachable is a normal state, not a contradiction. The ranking below is the
 * product decision, and it is here rather than in the JSX so it can be tested.
 *
 * Ordered by what the user can act on:
 *   1. an unsaved edit — they can retype, and nothing else matters if it is lost
 *   2. work in flight — saving, or the first parse
 *   3. a broken parser — nothing downstream means anything
 *   4. their own syntax errors — theirs to fix, and more useful than any server word
 *   5. the server's analysis
 *
 * Note what is NOT here: nothing in this function can blank the canvas. A
 * `failed` server status changes this label and reveals a retry button; the last
 * good diagram stays exactly where it was (spec §11, degrade never blank).
 */
export function describeStatus(input: StatusInput): StatusView {
  const { parse, save, server, serverError, errorCount, persists } = input;

  if (save === 'error') return { label: 'not saved', tone: 'error', retry: false };
  if (save === 'saving') return { label: 'saving', tone: 'busy', retry: false };

  if (parse === 'first-load') return { label: 'loading', tone: 'busy', retry: false };
  if (parse === 'parsing') return { label: 'parsing', tone: 'busy', retry: false };
  if (parse === 'error') return { label: 'parser error', tone: 'error', retry: false };
  if (parse === 'idle') return { label: 'empty', tone: 'neutral', retry: false };

  if (errorCount > 0) {
    return {
      label: `${errorCount} syntax error${errorCount > 1 ? 's' : ''}`,
      tone: 'error',
      retry: false,
    };
  }

  // Below here the local parse is clean, so anything left to say is the server's.
  if (!persists) return { label: 'ready', tone: 'neutral', retry: false };

  switch (server) {
    case 'failed':
      return {
        label: 'analysis failed',
        tone: 'error',
        retry: true,
        title: serverError ?? undefined,
      };
    case 'queued':
      return { label: 'queued', tone: 'busy', retry: false };
    case 'parsing':
      return { label: 'analyzing', tone: 'busy', retry: false };
    case 'ready':
      // The only place 'saved' is truthful: a graph is stored server-side.
      return { label: 'saved', tone: 'ok', retry: false };
    default:
      // No word from the server yet. 'ready' describes the diagram, which is
      // true and on screen; claiming 'saved' here would be a guess.
      return { label: 'ready', tone: 'neutral', retry: false };
  }
}
