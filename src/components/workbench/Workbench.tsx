'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CodeEditor } from '@/components/editor/CodeEditor';
import { FlowCanvas } from '@/components/canvas/FlowCanvas';
import { GraphOutline } from '@/components/canvas/GraphOutline';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { ExportMenu, type ExportRequest } from '@/components/export/ExportMenu';
import { toReactFlow } from '@/components/canvas/toReactFlow';
import { graphToSvg } from '@/lib/export/toSvg';
import { svgToBlob } from '@/lib/export/toRaster';
import { readTokens } from '@/lib/export/tokens';
import { downloadBlob, exportFilename } from '@/lib/export/download';
import { Skeleton } from '@/components/ui/Skeleton';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { useParse } from '@/lib/useParse';
import { useSnapshotStatus } from '@/lib/useSnapshotStatus';
import { detectLanguage } from '@/lib/ir/detect';
import { shiftAnchored, type Annotation } from '@/lib/annotations';
import { describeStatus, type SaveState } from './status';
import type { Language, ProgramIR } from '@/lib/ir/types';
import './workbench.css';

/** Display name for a language value. `JavaScript` keeps its capital S. */
export function languageLabel(language: Language): string {
  if (language === 'cpp') return 'C++';
  if (language === 'javascript') return 'JavaScript';
  return language[0].toUpperCase() + language.slice(1);
}

type Pane = 'code' | 'diagram' | 'ask';
type CanvasView = 'diagram' | 'outline';

const SAVE_DEBOUNCE_MS = 1500;

/** Display label for a structural node id, so "this node" is answerable. */
function nodeLabel(ir: ProgramIR | null, nodeId: string): string | null {
  if (!ir) return null;
  for (const fn of ir.functions) {
    const node = fn.nodes.find((n) => n.id === nodeId);
    if (node) return node.label;
  }
  return null;
}

interface Props {
  initialSource: string;
  /** Absent in the standalone demo, where nothing is persisted. */
  projectId?: string;
  title?: string;
  language?: Language;
  initialOverrides?: Record<string, { x: number; y: number }>;
  /** The snapshot the page loaded with, so its status is known before any edit. */
  initialSnapshotId?: string;
  /**
   * Injected rather than imported, so this component stays usable without a
   * database. Returns the new snapshot's id, which is what the status feed follows.
   */
  onSave?: (
    source: string,
    language: Language,
  ) => Promise<{ ok?: true; error?: string; snapshotId?: string }>;
  /** Persist one dragged node. Absent in the demo, where nothing is stored. */
  onNodeMoved?: (nodeId: string, x: number, y: number) => Promise<{ error?: string }>;
  /** Re-queue a failed analysis. Absent in the demo. */
  onRetry?: (snapshotId: string) => Promise<{ ok?: true; error?: string }>;
  /** Sticky-note persistence. Absent in the demo, where notes live for the session. */
  initialAnnotations?: Annotation[];
  onCreateAnnotation?: (input: {
    body: string;
    x: number;
    y: number;
    nodeId: string | null;
  }) => Promise<{ ok?: true; error?: string; annotation?: Annotation }>;
  onUpdateAnnotation?: (id: string, body: string) => Promise<{ ok?: true; error?: string }>;
  onMoveAnnotation?: (id: string, x: number, y: number) => Promise<{ ok?: true; error?: string }>;
  onDeleteAnnotation?: (id: string) => Promise<{ ok?: true; error?: string }>;
}

export function Workbench({
  initialSource,
  projectId,
  title,
  language = 'python',
  initialOverrides,
  initialSnapshotId,
  onSave,
  onNodeMoved,
  onRetry,
  initialAnnotations,
  onCreateAnnotation,
  onUpdateAnnotation,
  onMoveAnnotation,
  onDeleteAnnotation,
}: Props) {
  const [source, setSource] = useState(initialSource);
  const [selectedLanguage, setSelectedLanguage] = useState(language);
  const [detection, setDetection] = useState<string | null>(null);
  const [revealLine, setRevealLine] = useState<number | undefined>();
  const [activeFn, setActiveFn] = useState(0);
  const [pane, setPane] = useState<Pane>('diagram');
  const [canvasView, setCanvasView] = useState<CanvasView>('diagram');
  // The Ask pane exists only for persisted projects; the demo has no project
  // id, so there is nothing to ground a question in and nowhere to send it.
  const [askOpen, setAskOpen] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  // Follows the snapshot the page loaded with until an edit mints a newer one.
  const [snapshotId, setSnapshotId] = useState(initialSnapshotId);

  const { ir, layouts, status, error } = useParse(source, selectedLanguage);
  const server = useSnapshotStatus(snapshotId);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSource = useRef(source);
  const pendingLanguage = useRef(selectedLanguage);

  const handlePaste = useCallback((text: string) => {
    const detected = detectLanguage(text);
    // A paste that detects nothing clears the banner: it describes the last
    // paste's auto-switch, and showing the previous paste's verdict over new
    // content would claim an identification that never happened.
    if (!detected) {
      setDetection(null);
      return;
    }
    pendingLanguage.current = detected;
    setSelectedLanguage(detected);
    setDetection(`Detected ${languageLabel(detected)} — change it if that's wrong.`);
  }, []);

  const scheduleSave = useCallback(() => {
    if (!onSave) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setSaveState('saving');
      void onSave(pendingSource.current, pendingLanguage.current).then((result) => {
        if (result?.error) {
          setSaveState('error');
          setSaveError(result.error);
        } else {
          setSaveState('saved');
          setSaveError(null);
          if (result?.snapshotId) setSnapshotId(result.snapshotId);
        }
      });
    }, SAVE_DEBOUNCE_MS);
  }, [onSave]);

  const selectLanguage = useCallback((next: Language) => {
    pendingLanguage.current = next;
    setSelectedLanguage(next);
    setDetection(null);
    scheduleSave();
  }, [scheduleSave]);

  // Persist on idle, not on every keystroke. The local parse already keeps the
  // diagram current, so a save is about durability, not display.
  const onChange = useCallback(
    (next: string) => {
      setSource(next);
      pendingSource.current = next;
      scheduleSave();
    },
    [scheduleSave],
  );

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const [retrying, setRetrying] = useState(false);

  const handleRetry = useCallback(() => {
    if (!onRetry || !snapshotId) return;
    setRetrying(true);
    void onRetry(snapshotId).then((result) => {
      setRetrying(false);
      if (result?.error) {
        setSaveState('error');
        setSaveError(result.error);
      }
    });
  }, [onRetry, snapshotId]);

  // Positions the user has dragged this session, merged over what was loaded.
  // Keeping them here means a re-parse cannot discard an unsaved drag.
  const [positions, setPositions] = useState(initialOverrides ?? {});

  // Sticky notes: user-owned, never re-derived. A re-parse replaces the graph
  // but leaves this list untouched — that is why notes survive re-parses.
  const [notes, setNotes] = useState<Annotation[]>(initialAnnotations ?? []);

  const failNote = useCallback((error: string) => {
    setSaveState('error');
    setSaveError(error);
  }, []);

  const handleAddNote = useCallback(() => {
    const cascade = notes.length % 8;
    const input = { body: '', x: 80 + cascade * 24, y: 80 + cascade * 24, nodeId: null as string | null };
    if (!onCreateAnnotation) {
      // Demo: no persistence, so the note lives for the session. It still
      // renders, drags, and exports like a stored one.
      const id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `note-${Date.now()}`;
      setNotes((prev) => [...prev, { id, ...input }]);
      return;
    }
    void onCreateAnnotation(input).then((result) => {
      if (result?.annotation) setNotes((prev) => [...prev, result.annotation as Annotation]);
      else if (result?.error) failNote(result.error);
    });
  }, [notes.length, onCreateAnnotation, failNote]);

  const handleNoteSave = useCallback(
    (id: string, body: string) => {
      setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, body } : n)));
      if (!onUpdateAnnotation) return;
      void onUpdateAnnotation(id, body).then((result) => {
        if (result?.error) failNote(result.error);
      });
    },
    [onUpdateAnnotation, failNote],
  );

  const handleNoteDelete = useCallback(
    (id: string) => {
      setNotes((prev) => prev.filter((n) => n.id !== id));
      if (!onDeleteAnnotation) return;
      void onDeleteAnnotation(id).then((result) => {
        if (result?.error) failNote(result.error);
      });
    },
    [onDeleteAnnotation, failNote],
  );

  const handleNoteMoved = useCallback(
    (id: string, x: number, y: number) => {
      setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, x, y } : n)));
      if (!onMoveAnnotation) return;
      void onMoveAnnotation(id, x, y).then((result) => {
        if (result?.error) failNote(result.error);
      });
    },
    [onMoveAnnotation, failNote],
  );

  const fn = ir?.functions[activeFn] ?? ir?.functions[0];
  const layout = fn ? layouts[fn.id] : undefined;

  // A canvas click still reveals the source line AND grounds the Ask pane:
  // the selected node's id travels with the next question.
  const handleNodeClick = useCallback(
    (line?: number, nodeId?: string) => {
      setRevealLine(line);
      if (nodeId) {
        setSelectedNodeId(nodeId);
        setSelectedLabel(nodeLabel(ir, nodeId));
      }
    },
    [ir],
  );

  const handleNodeMoved = useCallback(
    (nodeId: string, x: number, y: number) => {
      // Anchored notes travel with their node: shift them by the same delta.
      const old =
        positions[nodeId] ?? layout?.nodes.find((n) => n.id === nodeId) ?? { x, y };
      const dx = x - old.x;
      const dy = y - old.y;
      setPositions((prev) => ({ ...prev, [nodeId]: { x, y } }));
      if (dx !== 0 || dy !== 0) {
        const next = shiftAnchored(notes, nodeId, dx, dy);
        if (next !== notes) {
          setNotes(next);
          if (onMoveAnnotation) {
            void Promise.all(
              next
                .filter((n) => n.nodeId === nodeId)
                .map((n) => onMoveAnnotation(n.id, n.x, n.y)),
            ).then((results) => {
              const failed = results.find((r) => r?.error);
              if (failed?.error) failNote(failed.error);
            });
          }
        }
      }
      if (!onNodeMoved) return;
      void onNodeMoved(nodeId, x, y).then((result) => {
        if (result?.error) {
          setSaveState('error');
          setSaveError(result.error);
        }
      });
    },
    [positions, layout, notes, onNodeMoved, onMoveAnnotation, failNote],
  );
  const errorCount = ir?.diagnostics.filter((d) => d.severity === 'error').length ?? 0;
  const selectedLanguageLabel = languageLabel(selectedLanguage);

  // Export is only meaningful over a real diagram — never over an empty canvas.
  const canExport = Boolean(fn && layout);
  const exportBlockReason =
    !fn || !layout
      ? errorCount > 0
        ? `The code doesn't parse as ${selectedLanguageLabel} — fix the errors to export.`
        : 'Nothing to export yet.'
      : null;

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleExport = useCallback(
    async (req: ExportRequest) => {
      if (!fn || !layout) return;
      setExporting(true);
      setExportError(null);
      try {
        // JPEG has no transparency. The menu already prevents the pairing, but
        // enforce it here too so no caller can export a black box.
        const background =
          req.format === 'jpeg' && req.background === 'transparent' ? 'white' : req.background;
        const tokens = readTokens();
        // Dragged positions are what the user sees, so they are what exports.
        // Notes go along when the toggle says so — excluded otherwise.
        const { nodes, edges } = toReactFlow(fn, layout, positions, req.includeNotes ? notes : []);
        const svg = graphToSvg({ nodes, edges, layout, tokens, background });
        let blob: Blob;
        if (req.format === 'svg') {
          blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
        } else {
          // 'white' is the explicit slide-deck choice, not a theme color.
          const paint =
            background === 'transparent'
              ? 'transparent'
              : background === 'white'
                ? '#ffffff'
                : tokens['--color-canvas'] || '#ffffff';
          blob = await svgToBlob(svg, req.format, req.scale, paint);
        }
        // Still inside the user's click handling, so this counts as
        // user-initiated and browsers allow the download.
        downloadBlob(blob, exportFilename(title, fn.name, req.format));
      } catch (e) {
        setExportError(e instanceof Error ? e.message : 'Export failed.');
      } finally {
        setExporting(false);
      }
    },
    [fn, layout, positions, notes, title],
  );

  const view = describeStatus({
    parse: status,
    save: saveState,
    server: server.status,
    serverError: server.error,
    errorCount,
    persists: Boolean(projectId),
  });

  return (
    <div className="wb">
      <header className="wb__bar">
        <span className="wb__brand">{title ?? 'code-flow'}</span>

        <label className="wb__language-label">
          <span className="wb__sr-only">Language</span>
          <select
            className="wb__language"
            value={selectedLanguage}
            onChange={(event) => selectLanguage(event.target.value as Language)}
            aria-label="Language"
          >
            <option value="python">Python</option>
            <option value="cpp">C++</option>
            <option value="java">Java</option>
            <option value="javascript">JavaScript</option>
          </select>
        </label>

        {detection && <span className="wb__detected" role="status">{detection}</span>}

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

        <div className="wb__state">
          {/* aria-live so a screen reader hears the job finish. polite, not
              assertive: it must not interrupt someone mid-sentence in the editor. */}
          <span
            className="wb__status"
            data-tone={view.tone}
            title={saveError ?? view.title}
            role="status"
            aria-live="polite"
          >
            {view.label}
          </span>

          {/* A failed analysis NEVER clears the canvas (spec §11). The diagram
              stays, and this is the way back. */}
          {view.retry && onRetry && (
            <button
              type="button"
              className="wb__retry"
              onClick={handleRetry}
              disabled={retrying}
            >
              {retrying ? 'retrying' : 'retry'}
            </button>
          )}
        </div>

        <ThemeToggle />
        {projectId && (
          <button
            type="button"
            className="wb__asktoggle"
            aria-expanded={askOpen}
            onClick={() => setAskOpen((v) => !v)}
          >
            Ask
          </button>
        )}
        <ExportMenu
          canExport={canExport}
          whyDisabled={exportBlockReason}
          exporting={exporting}
          error={exportError}
          onExport={(req) => void handleExport(req)}
        />
        <button type="button" className="wb__addnote" onClick={handleAddNote}>
          Add note
        </button>
      </header>

      <div
        className={projectId ? 'wb__panes wb__panes--with-chat' : 'wb__panes'}
        data-pane={pane}
        data-ask={askOpen ? 'open' : 'closed'}
      >
        <section className="wb__editor" aria-label="Code">
          <CodeEditor
            value={source}
            language={selectedLanguage}
            theme="dark"
            revealLine={revealLine}
            onChange={onChange}
            onPaste={handlePaste}
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
            <div className="wb__viewswitch" role="group" aria-label="Diagram view">
              <button
                type="button"
                aria-pressed={canvasView === 'diagram'}
                onClick={() => setCanvasView('diagram')}
              >
                Diagram
              </button>
              <button
                type="button"
                aria-pressed={canvasView === 'outline'}
                onClick={() => setCanvasView('outline')}
              >
                Outline
              </button>
            </div>
          )}

          {fn && layout && canvasView === 'diagram' && (
            <FlowCanvas
              graph={fn}
              layout={layout}
              overrides={positions}
              annotations={notes}
              onNodeClick={handleNodeClick}
              onNodeMoved={onNodeMoved ? handleNodeMoved : undefined}
              onAnnotationMoved={handleNoteMoved}
              onAnnotationSave={handleNoteSave}
              onAnnotationDelete={handleNoteDelete}
            />
          )}

          {fn && layout && canvasView === 'outline' && (
            <GraphOutline
              graph={fn}
              selectedId={selectedNodeId}
              onSelect={(line, nodeId) => handleNodeClick(line, nodeId)}
            />
          )}

          {ir && ir.functions.length === 0 && status === 'ready' && (
            <p className="wb__notice">
              {errorCount > 0
                ? `Couldn't parse this as ${selectedLanguageLabel}. Fix the errors, or switch the language above — the diagram returns when it parses.`
                : 'No functions found yet. Paste a function and its diagram appears here.'}
            </p>
          )}

          {status === 'idle' && (
            <p className="wb__notice">The editor is empty. Paste some code to begin.</p>
          )}
        </section>

        {projectId && (
          <section className="wb__ask" aria-label="Ask about this code">
            <ChatPanel
              projectId={projectId}
              selectedNodeId={selectedNodeId}
              selectedLabel={selectedLabel}
            />
          </section>
        )}
      </div>

      <nav className="wb__mobile-tabs" aria-label="View">
        <button onClick={() => setPane('code')} aria-pressed={pane === 'code'}>
          Code
        </button>
        <button onClick={() => setPane('diagram')} aria-pressed={pane === 'diagram'}>
          Diagram
        </button>
        {projectId && (
          <button
            onClick={() => {
              setPane('ask');
              setAskOpen(true);
            }}
            aria-pressed={pane === 'ask'}
          >
            Ask
          </button>
        )}
      </nav>
    </div>
  );
}
