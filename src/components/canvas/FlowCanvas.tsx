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
import { IRNodeView } from './IRNodeView';
import { toReactFlow, type RFNode } from './toReactFlow';
import type { FunctionGraph } from '@/lib/ir/types';
import type { LaidOutGraph } from '@/lib/layout/types';

// Module scope: a fresh object each render would remount every node.
const nodeTypes = { ir: IRNodeView };
const MINIMAP_THRESHOLD = 30;

interface Props {
  graph: FunctionGraph;
  layout: LaidOutGraph;
  overrides?: Record<string, { x: number; y: number }>;
  /** Called with the 1-based source line when a node is clicked. */
  onNodeClick?: (startLine: number) => void;
  /** Called when a drag finishes. Absent in the demo, where nothing persists. */
  onNodeMoved?: (nodeId: string, x: number, y: number) => void;
}

export function FlowCanvas({
  graph,
  layout,
  overrides,
  onNodeClick,
  onNodeMoved,
}: Props) {
  const computed = useMemo(
    () => toReactFlow(graph, layout, overrides),
    [graph, layout, overrides],
  );

  // Local node state so dragging is smooth, re-derived whenever the graph,
  // layout, or saved overrides change.
  //
  // Adjusted during render rather than in an effect: React documents this for
  // "resetting state when a prop changes", and it avoids the extra render pass
  // an effect would cost on every re-parse.
  const [nodes, setNodes] = useState<RFNode[]>(computed.nodes);
  const [seen, setSeen] = useState(computed.nodes);
  if (seen !== computed.nodes) {
    setSeen(computed.nodes);
    setNodes(computed.nodes);
  }

  const onNodesChange = useCallback((changes: NodeChange<RFNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);

  const handleClick: NodeMouseHandler = (_, node) => {
    const span = (node.data as { span?: { startLine: number } }).span;
    if (span) onNodeClick?.(span.startLine);
  };

  // Persist on drag STOP, not on every position change: a single drag emits
  // dozens of intermediate positions, and only where it lands is intent.
  // v12 types drag handlers as OnNodeDrag, which passes a DOM event rather than
  // React's synthetic one — NodeMouseHandler does not fit here.
  const handleDragStop: OnNodeDrag<RFNode> = (_, node) => {
    onNodeMoved?.(node.id, node.position.x, node.position.y);
  };

  return (
    <ReactFlow
      nodes={nodes}
      edges={computed.edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeClick={handleClick}
      onNodeDragStop={handleDragStop}
      fitView
      minZoom={0.15}
      maxZoom={2}
      nodesDraggable
      nodesConnectable={false}
      nodesFocusable
      elementsSelectable
      proOptions={{ hideAttribution: false }}
      aria-label={`Control flow diagram for ${graph.name}`}
    >
      <Background gap={24} size={1} color="var(--color-rule)" />
      <Controls showInteractive={false} />
      {nodes.length > MINIMAP_THRESHOLD && <MiniMap pannable zoomable />}
    </ReactFlow>
  );
}
