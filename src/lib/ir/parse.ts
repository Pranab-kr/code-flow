/**
 * Public parse entry: source -> ProgramIR.
 *
 * Runs unchanged in a browser web worker and in Node (Vitest, and later an
 * Inngest job). Keep it that way — no React, no Next, no DOM globals.
 */

import { Parser, Language as TSLanguage, type Tree } from 'web-tree-sitter';
import { buildProgramIR } from './builder';
import { LANGUAGES } from './languages/registry';
import { IR_VERSION, type Language, type ProgramIR } from './types';
import type { TSNode } from './languages/python';

/**
 * True only in Node. Deliberately NOT `typeof window !== 'undefined'`: a browser
 * web worker has no `window` either, and misclassifying the worker as Node sends
 * it looking for the wasm on a filesystem path.
 */
const IS_NODE = typeof process !== 'undefined' && process.versions?.node != null;

let initPromise: Promise<void> | null = null;
const grammarCache = new Map<Language, TSLanguage>();

export interface ParseOptions {
  /** Where /grammars lives. Browser: '' (same origin). Node: 'public'. */
  baseUrl?: string;
}

/**
 * Node resolves web-tree-sitter.wasm next to its own module, so passing
 * `locateFile` there yields a cwd-relative path and aborts with ENOENT.
 * Caching the PROMISE (not a boolean) closes the double-init window when the
 * worker fires two parses back to back.
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
  // Language.load branches internally: Node fs-reads a bare path, the browser
  // fetches a same-origin URL.
  const grammar = await TSLanguage.load(url.startsWith('/') ? `${baseUrl}${url}` : url);
  grammarCache.set(language, grammar);
  return grammar;
}

/**
 * Parse source into a normalized ProgramIR.
 *
 * Error-tolerant by design: a syntax error yields diagnostics AND whatever IR
 * was recoverable, so the canvas degrades instead of going blank (spec §11).
 */
export async function parseToIR(
  source: string,
  language: Language,
  opts: ParseOptions = {},
): Promise<ProgramIR> {
  // ensureInit takes the BARE baseUrl and appends /grammars itself.
  const baseUrl = opts.baseUrl ?? (IS_NODE ? 'public' : '');
  await ensureInit(baseUrl);

  const parser = new Parser();
  parser.setLanguage(await loadGrammar(language, baseUrl));

  // A Tree is its own wasm-backed handle and must be freed too. The worker calls
  // this on every debounced keystroke for the life of a session, so leaking Trees
  // grows the emscripten heap without bound in the hot path.
  let tree: Tree | null = null;
  try {
    tree = parser.parse(source);
    if (!tree) {
      return {
        language,
        functions: [],
        callEdges: [],
        irVersion: IR_VERSION,
        diagnostics: [
          {
            severity: 'error',
            message: 'Parser returned no tree',
            span: { startLine: 1, endLine: 1 },
          },
        ],
      };
    }
    const { funcs, diagnostics } = LANGUAGES[language].adapter(
      tree.rootNode as unknown as TSNode,
    );
    return buildProgramIR(funcs, language, diagnostics);
  } finally {
    tree?.delete();
    parser.delete();
  }
}
