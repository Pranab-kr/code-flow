/// <reference lib="webworker" />
/**
 * Parses and lays out on a worker thread, so typing never stutters.
 *
 * Both steps run here: ELK is a synchronous solver, and running it on the main
 * thread would block paint on every keystroke no matter how fast the parse is.
 */
import { parseToIR } from '@/lib/ir/parse';
import { layoutProgram } from '@/lib/layout/elk';
import type { Language, ProgramIR } from '@/lib/ir/types';
import type { LaidOutGraph } from '@/lib/layout/types';

export interface ParseRequest {
  type: 'parse';
  id: number;
  source: string;
  language: Language;
}

export type ParseResponse =
  | {
      type: 'result';
      id: number;
      ir: ProgramIR;
      layouts: Record<string, LaidOutGraph>;
    }
  | { type: 'error'; id: number; message: string };

self.onmessage = async (event: MessageEvent<ParseRequest>) => {
  const { id, source, language } = event.data;
  try {
    const ir = await parseToIR(source, language);
    const layouts = await layoutProgram(ir.functions);
    const response: ParseResponse = { type: 'result', id, ir, layouts };
    self.postMessage(response);
  } catch (error) {
    // Never let the worker die silently: the UI needs something to show.
    const response: ParseResponse = {
      type: 'error',
      id,
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};
