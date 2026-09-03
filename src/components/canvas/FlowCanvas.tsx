'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  applyNodeChanges,
  type NodeChange,
  type NodeMouseHandler,
  type OnNodeDrag,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './canvas.css';
import './AnnotationNode.css';
import { IRNodeView } from './IRNodeView';
import { AnnotationNode } from './AnnotationNode';
import { ElkEdge } from './ElkEdge';
import { toReactFlow, type FlowNode } from './toReactFlow';
import type { Annotation } from '@/lib/annotations';
import type { FunctionGraph } from '@/lib/ir/types';
import type { LaidOutGraph } from '@/lib/layout/types';

// Module scope: a fresh object each render would remount every node.
const nodeTypes = { ir: IRNodeView, annotation: AnnotationNode };
// One custom edge type drawing ELK's routed points (trap 12). Registered here,
// so it cannot go unregistered the way a per-edge type string could.
const edgeTypes = { elk: ElkEdge };
const MINIMAP_THRESHOLD = 30;

interface Props {
  graph: FunctionGraph;
  layout: LaidOutGraph;
  overrides?: Record<string, { x: number; y: number }>;
  /** Sticky notes: user-owned, never re-derived, surviving every re-parse. */
  annotations?: Annotation[];
  /**
   * Called with the 1-based source line AND the structural node id when an IR
   * node is clicked. The id is second and optional, so existing single-argument
   * callers keep working.
   */
  onNodeClick?: (startLine?: number, nodeId?: string) => void;
  /** Called when a drag finishes. Absent in the demo, where nothing persists. */
  onNodeMoved?: (nodeId: string, x: number, y: number) => void;
  onAnnotationMoved?: (id: string, x: number, y: number) => void;
  onAnnotationSave?: (id: string, body: string) => void;
  onAnnotationDelete?: (id: string) => void;
  /**
   * Marketing hero embed sets this false: no dragging, no pan/zoom (the page
   * keeps scrolling), no keyboard traversal. The hero wraps the canvas
   * aria-hidden with its own text description, so nothing is lost.
   */
  interactive?: boolean;
}

export function FlowCanvas({
  graph,
  layout,
  overrides,
  annotations,
  onNodeClick,
  onNodeMoved,
  onAnnotationMoved,
  onAnnotationSave,
  onAnnotationDelete,
  interactive = true,
}: Props) {
  const computed = useMemo(() => {
    const { nodes, edges } = toReactFlow(graph, layout, overrides, annotations);
    // Callbacks travel via node data: React Flow instantiates node components
    // itself, so there is no other channel. toReactFlow stays pure (and its
    // output stays serializable for export) by not setting these itself.
    return {
      edges,
      nodes: nodes.map((n) =>
        n.type === 'annotation'
          ? {
              ...n,
              data: {
                ...n.data,
                ...(onAnnotationSave ? { onSave: onAnnotationSave } : {}),
                ...(onAnnotationDelete ? { onDelete: onAnnotationDelete } : {}),
              },
            }
          : n,
      ),
    };
  }, [graph, layout, overrides, annotations, onAnnotationSave, onAnnotationDelete]);

  // Local node state so dragging is smooth, re-derived whenever the graph,
  // layout, or saved overrides change.
  //
  // Adjusted during render rather than in an effect: React documents this for
  // "resetting state when a prop changes", and it avoids the extra render pass
  // an effect would cost on every re-parse.
  const [nodes, setNodes] = useState<FlowNode[]>(computed.nodes);
  const [seen, setSeen] = useState(computed.nodes);
  if (seen !== computed.nodes) {
    setSeen(computed.nodes);
    setNodes(computed.nodes);
  }

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);

  const handleClick: NodeMouseHandler = (_, node) => {
    const span = (node.data as { span?: { startLine: number } }).span;
    if (span) onNodeClick?.(span.startLine, node.id);
  };

  // Persist on drag STOP, not on every position change: a single drag emits
  // dozens of intermediate positions, and only where it lands is intent.
  // v12 types drag handlers as OnNodeDrag, which passes a DOM event rather than
  // React's synthetic one — NodeMouseHandler does not fit here.
  const handleDragStop: OnNodeDrag<FlowNode> = (_, node) => {
    if (node.type === 'annotation') {
      onAnnotationMoved?.(node.id, node.position.x, node.position.y);
    } else {
      onNodeMoved?.(node.id, node.position.x, node.position.y);
    }
  };

  return (
    <ReactFlow
      nodes={nodes}
      edges={computed.edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onNodeClick={handleClick}
      onNodeDragStop={handleDragStop}
      fitView
      minZoom={0.15}
      maxZoom={2}
      nodesDraggable={interactive}
      nodesConnectable={false}
      nodesFocusable={interactive}
      elementsSelectable={interactive}
      panOnDrag={interactive}
      zoomOnScroll={interactive}
      proOptions={{ hideAttribution: false }}
      aria-label={interactive ? `Control flow diagram for ${graph.name}` : undefined}
      aria-hidden={!interactive || undefined}
    >
      <Background gap={24} size={1} color="var(--color-rule)" />
      {interactive && <Controls showInteractive={false} />}
      {interactive && nodes.length > MINIMAP_THRESHOLD && <MiniMap pannable zoomable />}
    </ReactFlow>
  );
}
