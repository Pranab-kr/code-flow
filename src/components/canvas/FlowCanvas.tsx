'use client';

import { useMemo } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './canvas.css';
import { IRNodeView } from './IRNodeView';
import { toReactFlow } from './toReactFlow';
import type { FunctionGraph } from '@/lib/ir/types';
import type { LaidOutGraph } from '@/lib/layout/types';

// Defined once at module scope: a new object per render would remount every node.
const nodeTypes = { ir: IRNodeView };
const MINIMAP_THRESHOLD = 30;

interface Props {
  graph: FunctionGraph;
  layout: LaidOutGraph;
  overrides?: Record<string, { x: number; y: number }>;
  /** Called with the 1-based source line when a node is clicked. */
  onNodeClick?: (startLine: number) => void;
}

export function FlowCanvas({ graph, layout, overrides, onNodeClick }: Props) {
  const { nodes, edges } = useMemo(
    () => toReactFlow(graph, layout, overrides),
    [graph, layout, overrides],
  );

  const handleClick: NodeMouseHandler = (_, node) => {
    const span = (node.data as { span?: { startLine: number } }).span;
    if (span) onNodeClick?.(span.startLine);
  };

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={handleClick}
      fitView
      minZoom={0.15}
      maxZoom={2}
      nodesDraggable
      nodesConnectable={false}
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
