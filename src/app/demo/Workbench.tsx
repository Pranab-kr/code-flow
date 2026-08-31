'use client';

import { useCallback, useState } from 'react';
import { CodeEditor } from '@/components/editor/CodeEditor';
import { FlowCanvas } from '@/components/canvas/FlowCanvas';
import { Skeleton } from '@/components/ui/Skeleton';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { useParse } from '@/lib/useParse';
import type { Language } from '@/lib/ir/types';
import './workbench.css';

type Pane = 'code' | 'diagram';

/**
 * The three-pane shell, minus persistence.
 *
 * Persistence and auth need Postgres, which is blocked on this machine (no
 * container runtime). Everything downstream of the parse works without them, so
 * this proves the slice end to end: source -> IR -> layout -> canvas, and a node
 * click scrolling the editor to its line.
 */
export function Workbench({ initialSource }: { initialSource: string }) {
  const [source, setSource] = useState(initialSource);
  const [revealLine, setRevealLine] = useState<number | undefined>();
  const [activeFn, setActiveFn] = useState(0);
  const [pane, setPane] = useState<Pane>('diagram');
  const language: Language = 'python';

  const { ir, layouts, status, error } = useParse(source, language);

  const onChange = useCallback((next: string) => setSource(next), []);

  const fn = ir?.functions[activeFn] ?? ir?.functions[0];
  const layout = fn ? layouts[fn.id] : undefined;
  const errorCount = ir?.diagnostics.filter((d) => d.severity === 'error').length ?? 0;

  return (
    <div className="wb">
      <header className="wb__bar">
        <span className="wb__brand">code-flow</span>

        {ir && ir.functions.length > 0 && (
          <nav className="wb__tabs" role="tablist" aria-label="Functions">
            {ir.functions.map((f, i) => (
              <button
                key={f.id}
                role="tab"
                aria-selected={i === activeFn}
                className="wb__tab"
                onClick={() => setActiveFn(i)}
              >
                {f.name}
              </button>
            ))}
          </nav>
        )}

        <span className="wb__status" data-status={status}>
          {status === 'parsing' && 'parsing'}
          {status === 'ready' && (errorCount > 0 ? `${errorCount} syntax error` : 'ready')}
          {status === 'error' && 'parser error'}
          {status === 'first-load' && 'loading'}
          {status === 'idle' && 'empty'}
        </span>
        <ThemeToggle />
      </header>

      <div className="wb__panes" data-pane={pane}>
        <section className="wb__editor" aria-label="Code">
          <CodeEditor
            value={source}
            language={language}
            theme="dark"
            revealLine={revealLine}
            onChange={onChange}
          />
        </section>

        <section className="wb__canvas" aria-label="Diagram">
          {status === 'first-load' && <Skeleton label="Building your diagram" />}

          {error && (
            <p className="wb__notice" role="status">
              {error}
            </p>
          )}

          {fn && layout && (
            <FlowCanvas
              graph={fn}
              layout={layout}
              onNodeClick={(line) => setRevealLine(line)}
            />
          )}

          {ir && ir.functions.length === 0 && status === 'ready' && (
            <p className="wb__notice">
              No functions found yet. Paste a function and its diagram appears here.
            </p>
          )}

          {status === 'idle' && (
            <p className="wb__notice">The editor is empty. Paste some code to begin.</p>
          )}
        </section>
      </div>

      <nav className="wb__mobile-tabs" aria-label="View">
        <button onClick={() => setPane('code')} aria-pressed={pane === 'code'}>
          Code
        </button>
        <button onClick={() => setPane('diagram')} aria-pressed={pane === 'diagram'}>
          Diagram
        </button>
      </nav>
    </div>
  );
}
