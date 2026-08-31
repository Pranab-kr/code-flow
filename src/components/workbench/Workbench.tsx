'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CodeEditor } from '@/components/editor/CodeEditor';
import { FlowCanvas } from '@/components/canvas/FlowCanvas';
import { Skeleton } from '@/components/ui/Skeleton';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { useParse } from '@/lib/useParse';
import type { Language } from '@/lib/ir/types';
import './workbench.css';

type Pane = 'code' | 'diagram';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const SAVE_DEBOUNCE_MS = 1500;

interface Props {
  initialSource: string;
  /** Absent in the standalone demo, where nothing is persisted. */
  projectId?: string;
  title?: string;
  language?: Language;
  initialOverrides?: Record<string, { x: number; y: number }>;
  /** Injected rather than imported, so this component stays usable without a database. */
  onSave?: (source: string) => Promise<{ ok?: true; error?: string }>;
  /** Persist one dragged node. Absent in the demo, where nothing is stored. */
  onNodeMoved?: (nodeId: string, x: number, y: number) => Promise<{ error?: string }>;
}

export function Workbench({
  initialSource,
  projectId,
  title,
  language = 'python',
  initialOverrides,
  onSave,
  onNodeMoved,
}: Props) {
  const [source, setSource] = useState(initialSource);
  const [revealLine, setRevealLine] = useState<number | undefined>();
  const [activeFn, setActiveFn] = useState(0);
  const [pane, setPane] = useState<Pane>('diagram');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  const { ir, layouts, status, error } = useParse(source, language);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSource = useRef(source);

  // Persist on idle, not on every keystroke. The local parse already keeps the
  // diagram current, so a save is about durability, not display.
  const onChange = useCallback(
    (next: string) => {
      setSource(next);
      pendingSource.current = next;
      if (!onSave) return;

      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setSaveState('saving');
        void onSave(pendingSource.current).then((result) => {
          if (result?.error) {
            setSaveState('error');
            setSaveError(result.error);
          } else {
            setSaveState('saved');
            setSaveError(null);
          }
        });
      }, SAVE_DEBOUNCE_MS);
    },
    [onSave],
  );

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // Positions the user has dragged this session, merged over what was loaded.
  // Keeping them here means a re-parse cannot discard an unsaved drag.
  const [positions, setPositions] = useState(initialOverrides ?? {});

  const handleNodeMoved = useCallback(
    (nodeId: string, x: number, y: number) => {
      setPositions((prev) => ({ ...prev, [nodeId]: { x, y } }));
      if (!onNodeMoved) return;
      void onNodeMoved(nodeId, x, y).then((result) => {
        if (result?.error) {
          setSaveState('error');
          setSaveError(result.error);
        }
      });
    },
    [onNodeMoved],
  );

  const fn = ir?.functions[activeFn] ?? ir?.functions[0];
  const layout = fn ? layouts[fn.id] : undefined;
  const errorCount = ir?.diagnostics.filter((d) => d.severity === 'error').length ?? 0;

  return (
    <div className="wb">
      <header className="wb__bar">
        <span className="wb__brand">{title ?? 'code-flow'}</span>

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

        <span
          className="wb__status"
          data-status={saveState === 'error' ? 'error' : status}
          title={saveError ?? undefined}
        >
          {saveState === 'error'
            ? 'not saved'
            : saveState === 'saving'
              ? 'saving'
              : status === 'parsing'
                ? 'parsing'
                : status === 'error'
                  ? 'parser error'
                  : status === 'first-load'
                    ? 'loading'
                    : status === 'idle'
                      ? 'empty'
                      : errorCount > 0
                        ? `${errorCount} syntax error${errorCount > 1 ? 's' : ''}`
                        : projectId
                          ? 'saved'
                          : 'ready'}
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
              overrides={positions}
              onNodeClick={(line) => setRevealLine(line)}
              onNodeMoved={onNodeMoved ? handleNodeMoved : undefined}
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
