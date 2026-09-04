import type { Language } from './types';

/** Cheap, conservative detection. Ambiguous input stays null rather than guessing. */
export function detectLanguage(source: string): Language | null {
  const scores: Record<Language, number> = { python: 0, cpp: 0, java: 0, javascript: 0 };

  if (/^\s*(?:async\s+)?def\s+\w+\s*\([^)]*\)\s*:/m.test(source)) scores.python += 4;
  if (/^\s*(?:class|if|for|while|try|except|else|elif)\b[^\n]*:\s*$/m.test(source)) {
    scores.python += 2;
  }
  if (/^\s*(?:from\s+\S+\s+)?import\s+/m.test(source)) scores.python += 1;

  if (/^\s*#\s*include\s*[<"]/m.test(source)) scores.cpp += 5;
  if (/\bstd::|\b(?:namespace|template)\s*</.test(source)) scores.cpp += 4;
  if (/\b(?:cout|cin)\s*<</.test(source)) scores.cpp += 2;

  if (/\b(?:public|private|protected)\s+(?:static\s+)?(?:class|interface|enum)\b/.test(source)) {
    scores.java += 5;
  }
  if (/\bclass\s+\w+(?:\s+extends\s+\w+)?\s*\{/.test(source)) scores.java += 2;
  if (/\b(?:System\.out|String\[\]|boolean\b|throws\s+\w+)/.test(source)) scores.java += 3;

  // Typed methods distinguish Java from Python, but remain weak because the same
  // shape is valid C++. C++-specific evidence above wins when present.
  if (/\b(?:void|int|long|double|float|boolean|String)\s+\w+\s*\([^)]*\)\s*\{/.test(source)) {
    scores.java += 1;
    scores.cpp += 1;
  }

  if (/=>/.test(source)) scores.javascript += 3;
  if (/===|!==/.test(source)) scores.javascript += 2;
  if (/console\.(log|error|warn)/.test(source)) scores.javascript += 2;
  if (/^\s*import\s+.+\s+from\s+['"]/m.test(source)) scores.javascript += 3;
  if (/^\s*export\s+(default\s+)?(function|const|let|class)\b/m.test(source)) {
    scores.javascript += 3;
  }
  if (/(?:^|[^\w$])(?:const|let)\s+\w+\s*[:=]/m.test(source)) scores.javascript += 1;
  if (/\bfunction\s+\w*\s*\([^)]*\)\s*\{/.test(source)) scores.javascript += 2;

  const ranked = (Object.entries(scores) as [Language, number][]).sort((a, b) => b[1] - a[1]);
  // TypeScript is explicitly deferred (spec §7): annotated source must never be
  // routed to the JS adapter, so a JS win on annotated code stays unselected.
  if (ranked[0][0] === 'javascript' && TS_ANNOTATION.test(source)) return null;
  return ranked[0][1] > 0 && ranked[0][1] > ranked[1][1] ? ranked[0][0] : null;
}

/**
 * Type annotations and declarations the JS grammar cannot parse as
 * JavaScript: a paren-colon return type, an annotated binding, or a top-level
 * `interface` / `type` declaration.
 */
const TS_ANNOTATION =
  /(\)\s*:\s*[A-Za-z_$][\w$<>[\]]*)|(\w\s*:\s*(string|number|boolean|any|unknown|never|void|Record|Array|Promise)\b)|(^\s*interface\s+\w+)|(^\s*type\s+\w+\s*=)/m;
