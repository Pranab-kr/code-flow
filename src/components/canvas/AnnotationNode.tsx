'use client';

import { useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { AnnotationNode as AnnotationNodeType } from './toReactFlow';
import './AnnotationNode.css';

/**
 * A sticky note on the canvas.
 *
 * Tier-1 annotation: it never touches source. Textarea-backed, tokens only,
 * saving on blur through the Plan 2 action (wired via `data.onSave` by
 * FlowCanvas — toReactFlow itself stays pure). No source/target handles:
 * notes are not graph nodes and can never be edge endpoints.
 *
 * `nodrag` keeps typing from moving the note; `nowheel` keeps scrolling the
 * text from panning the canvas.
 */
export function AnnotationNode({ id, data, selected }: NodeProps<AnnotationNodeType>) {
  const [draft, setDraft] = useState(data.body);
  const [lastBody, setLastBody] = useState(data.body);
  // Reset the draft when a save elsewhere (or a reload) changes the body.
  if (lastBody !== data.body) {
    setLastBody(data.body);
    setDraft(data.body);
  }

  const save = () => {
    if (draft !== data.body) data.onSave?.(id, draft);
  };

  return (
    <div
      className="cf-note"
      data-selected={selected ? 'true' : undefined}
      role="group"
      aria-label={data.nodeId ? 'Sticky note on a diagram node' : 'Free-floating sticky note'}
    >
      <span className="cf-note__tag" aria-hidden="true">
        note
      </span>
      <textarea
        className="cf-note__input nodrag nowheel"
        value={draft}
        rows={4}
        placeholder="Add a note…"
        aria-label="Sticky note text"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={save}
      />
      <button
        type="button"
        className="cf-note__delete nodrag"
        aria-label="Delete note"
        title="Delete note"
        onClick={() => data.onDelete?.(id)}
      >
        ×
      </button>
    </div>
  );
}
