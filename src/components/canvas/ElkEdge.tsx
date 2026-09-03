'use client';

import type { EdgeProps } from '@xyflow/react';
import type { RFEdge } from './toReactFlow';

export interface FlowPoint {
  x: number;
  y: number;
}

/** Round to 2dp, matching the export serializer's stability rule. */
function fmt(n: number): string {
  const r = Math.round(n * 100) / 100;
  return Number.isFinite(r) ? String(r) : '0';
}

/**
 * Path for routed points, or a straight fallback between the edge's
 * endpoints when ELK did not route (or a drag opted out of static points).
 */
export function elkPathFor(
  points: FlowPoint[] | undefined,
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
): string {
  const pts = points && points.length >= 2 ? points : null;
  if (!pts) return `M ${fmt(sourceX)} ${fmt(sourceY)} L ${fmt(targetX)} ${fmt(targetY)}`;
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${fmt(p.x)} ${fmt(p.y)}`).join(' ');
}

/**
 * Label anchor. Mirrors the export serializer's midpoint rule (average of two
 * points, middle element otherwise) so canvas labels sit where export puts
 * them.
 */
export function elkMidpoint(
  points: FlowPoint[] | undefined,
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
): FlowPoint {
  const pts = points && points.length >= 2 ? points : null;
  if (!pts) return { x: (sourceX + targetX) / 2, y: (sourceY + targetY) / 2 };
  if (pts.length === 2) return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  return pts[Math.floor(pts.length / 2)];
}

const LABEL_W_PER_CHAR = 6;
const LABEL_PAD = 10;
const LABEL_H = 14;

/**
 * Draws ELK's routed polyline instead of React Flow's handle-to-handle
 * re-route. Stroke styling still comes from `canvas.css` via the
 * `react-flow__edge-path` class and the `cf-edge-*` kind class on the
 * wrapper <g>, so kind cues (dashed back edges, danger dashes) are unchanged.
 */
export function ElkEdge({
  id,
  data,
  label,
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  interactionWidth,
}: EdgeProps<RFEdge>) {
  const points = data?.points;
  const d = elkPathFor(points, sourceX, sourceY, targetX, targetY);
  const text = typeof label === 'string' && label !== '' ? label : null;
  const mid = text ? elkMidpoint(points, sourceX, sourceY, targetX, targetY) : null;
  const w = text ? text.length * LABEL_W_PER_CHAR + LABEL_PAD : 0;

  return (
    <>
      <path id={id} className="react-flow__edge-path" d={d} fill="none" markerEnd={markerEnd} />
      {/* Wide invisible hit target; interaction styling stays in CSS. */}
      <path
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={interactionWidth ?? 20}
        pointerEvents="stroke"
      />
      {text && mid && (
        <>
          <rect
            className="react-flow__edge-textbg"
            x={mid.x - w / 2}
            y={mid.y - LABEL_H / 2}
            width={w}
            height={LABEL_H}
            rx={3}
          />
          <text
            className="react-flow__edge-text"
            x={mid.x}
            y={mid.y}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {text}
          </text>
        </>
      )}
    </>
  );
}
