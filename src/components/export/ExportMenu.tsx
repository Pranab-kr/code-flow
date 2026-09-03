'use client';

import { useId, useState } from 'react';
import './ExportMenu.css';

export type ExportFormat = 'png' | 'jpeg' | 'svg';
export type ExportBackground = 'transparent' | 'paper' | 'white';

export interface ExportRequest {
  format: ExportFormat;
  scale: number;
  background: ExportBackground;
  includeNotes: boolean;
}

interface ExportMenuProps {
  canExport: boolean;
  /** Plain-language reason shown when the menu is unavailable. */
  whyDisabled: string | null;
  exporting: boolean;
  error: string | null;
  onExport: (req: ExportRequest) => void;
}

const SCALES = [1, 2, 3] as const;

const FORMAT_LABEL: Record<ExportFormat, string> = {
  png: 'PNG',
  jpeg: 'JPEG',
  svg: 'SVG',
};

/**
 * Export options for the diagram on screen.
 *
 * Presentational: it reports what the user chose and leaves tokens, pixels,
 * and downloads to the Workbench, which owns the graph. jpg and jpeg are one
 * format — a single JPEG option writing `.jpg`. Sticky notes are included
 * behind a toggle (Task 4): the file matches the screen by default.
 *
 * All 8 states: default, hover, focus-visible, active, disabled (nothing to
 * export, or an export already running), loading (rasterizing), error (the
 * reason, with retry by pressing Download again), success (silent — the file
 * downloading IS the confirmation).
 */
export function ExportMenu({ canExport, whyDisabled, exporting, error, onExport }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ExportFormat>('png');
  const [scale, setScale] = useState<number>(2);
  const [background, setBackground] = useState<ExportBackground>('paper');
  const [includeNotes, setIncludeNotes] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const panelId = useId();

  const isJpeg = format === 'jpeg';
  const isSvg = format === 'svg';
  const unavailable = !canExport || exporting;

  const chooseFormat = (next: ExportFormat) => {
    setFormat(next);
    if (next === 'jpeg' && background === 'transparent') {
      // JPEG has no transparency: say so and move, never silently.
      setBackground('white');
      setNotice('JPEG has no transparency, so the background switches to white.');
    } else {
      setNotice(null);
    }
  };

  const chooseBackground = (next: ExportBackground) => {
    setBackground(next);
    setNotice(null);
  };

  const download = () => {
    onExport({ format, scale: isSvg ? 1 : scale, background, includeNotes });
  };

  return (
    <div className="cf-export">
      <button
        type="button"
        className="cf-export__trigger"
        aria-expanded={open}
        aria-controls={panelId}
        aria-busy={exporting || undefined}
        aria-label={exporting ? 'Exporting the diagram' : canExport ? 'Export the diagram' : `Export (unavailable: ${whyDisabled ?? 'nothing to export yet'})`}
        title={canExport ? 'Export the diagram' : (whyDisabled ?? 'Nothing to export yet')}
        disabled={unavailable}
        onClick={() => setOpen((v) => !v)}
      >
        {exporting ? 'Exporting…' : 'Export'}
      </button>

      {open && canExport && (
        <div
          id={panelId}
          className="cf-export__panel"
          role="group"
          aria-label="Export options"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
          }}
        >
          <fieldset className="cf-export__group">
            <legend className="cf-export__legend">Format</legend>
            {(Object.keys(FORMAT_LABEL) as ExportFormat[]).map((f) => (
              <label key={f} className="cf-export__option">
                <input
                  type="radio"
                  name="export-format"
                  value={f}
                  checked={format === f}
                  disabled={exporting}
                  onChange={() => chooseFormat(f)}
                />
                <span>
                  {FORMAT_LABEL[f]}
                  <span className="cf-export__hint">{f === 'jpeg' ? ' · .jpg' : f === 'svg' ? ' · vector' : ' · .png'}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <fieldset className="cf-export__group" disabled={isSvg}>
            <legend className="cf-export__legend">Size</legend>
            {SCALES.map((s) => (
              <label key={s} className="cf-export__option">
                <input
                  type="radio"
                  name="export-scale"
                  value={s}
                  checked={scale === s}
                  disabled={exporting}
                  onChange={() => setScale(s)}
                />
                <span>{s}×</span>
              </label>
            ))}
            {isSvg && <p className="cf-export__note">SVG is vector — size doesn&apos;t apply.</p>}
          </fieldset>

          <fieldset className="cf-export__group">
            <legend className="cf-export__legend">Background</legend>
            {(['transparent', 'paper', 'white'] as const).map((b) => {
              const blocked = b === 'transparent' && isJpeg;
              return (
                <label key={b} className="cf-export__option">
                  <input
                    type="radio"
                    name="export-background"
                    value={b}
                    checked={background === b}
                    disabled={blocked || exporting}
                    title={blocked ? 'JPEG has no transparency' : undefined}
                    onChange={() => chooseBackground(b)}
                  />
                  <span className="cf-export__label">{b[0].toUpperCase() + b.slice(1)}</span>
                </label>
              );
            })}
            {isJpeg && (
              <p className="cf-export__note">JPEG has no transparency — white or paper only.</p>
            )}
          </fieldset>

          <label className="cf-export__option">
            <input
              type="checkbox"
              checked={includeNotes}
              disabled={exporting}
              onChange={(event) => setIncludeNotes(event.target.checked)}
            />
            <span>Include sticky notes</span>
          </label>

          {notice && (
            <p className="cf-export__note" role="status">
              {notice}
            </p>
          )}

          {error && (
            <p className="cf-export__error" role="alert">
              Export failed: {error} Press Download again to retry.
            </p>
          )}

          <button
            type="button"
            className="cf-export__download"
            disabled={exporting}
            aria-busy={exporting || undefined}
            onClick={download}
          >
            {exporting ? 'Exporting…' : `Download ${FORMAT_LABEL[format]}`}
          </button>
        </div>
      )}
    </div>
  );
}
