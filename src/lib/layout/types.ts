export interface PositionedNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RoutedEdge {
  id: string;
  /** Ordered start -> bends -> end, already corrected to IR direction. */
  points: { x: number; y: number }[];
}

export interface LaidOutGraph {
  nodes: PositionedNode[];
  edges: RoutedEdge[];
  width: number;
  height: number;
}
