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

/**
 * Debounced parse in a worker.
 *
 * The skeleton shows on FIRST load only. After a graph exists, edits update in
 * place: the local parse takes ~50ms, so a loading state for work already
 * finished would be a lie. The last good graph stays on screen while a newer
 * parse runs, and stale responses are dropped by sequence number.
 */
export function useParse(source: string, language: Language): ParseState {
  const [state, setState] = useState<ParseState>({
    ir: null,
    layouts: {},
    status: 'first-load',
    error: null,
  });

  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  const latest = useRef(0);
  const hasResult = useRef(false);

  useEffect(() => {
    const w = new Worker(new URL('../workers/parse.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.current = w;

    w.onmessage = (event: MessageEvent<ParseResponse>) => {
      const msg = event.data;
      // A newer edit superseded this one.
      if (msg.id !== latest.current) return;
      if (msg.type === 'result') {
        hasResult.current = true;
        setState({ ir: msg.ir, layouts: msg.layouts, status: 'ready', error: null });
      } else {
        // Keep the last good graph visible and say what broke (spec §11).
        setState((prev) => ({ ...prev, status: 'error', error: msg.message }));
      }
    };

    w.onerror = (event) => {
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: event.message || 'The parser worker stopped unexpectedly.',
      }));
    };

    return () => {
      w.terminate();
      worker.current = null;
    };
  }, []);

  const isEmpty = source.trim().length === 0;

  useEffect(() => {
    if (isEmpty) return;

    const timer = setTimeout(() => {
      const id = ++seq.current;
      latest.current = id;
      setState((prev) => ({
        ...prev,
        // Never regress to a skeleton once a graph exists.
        status: hasResult.current ? 'parsing' : 'first-load',
      }));
      const request: ParseRequest = { type: 'parse', id, source, language };
      worker.current?.postMessage(request);
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [source, language, isEmpty]);

  // Empty source is DERIVED, not stored. Pushing it through setState inside the
  // effect would cause a cascading render, and there is nothing to remember here:
  // an empty editor has exactly one possible state.
  if (isEmpty) return { ir: null, layouts: {}, status: 'idle', error: null };

  return state;
}
