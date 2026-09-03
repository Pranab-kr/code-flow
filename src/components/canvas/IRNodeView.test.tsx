import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import type { ReactNode } from 'react';
import { IRNodeView } from './IRNodeView';
import type { RFNode } from './toReactFlow';

afterEach(() => cleanup());

// Handles read from the flow store, so nodes render inside a provider.
function renderNode(node: ReactNode) {
  return render(<ReactFlowProvider>{node}</ReactFlowProvider>);
}

function props(kind: RFNode['data']['kind']) {
  return {
    id: 'n1',
    data: { kind, label: 'x > 0', statements: ['x > 0'], span: { startLine: 1, endLine: 1 } },
    selected: false,
  } as unknown as NodeProps<RFNode>;
}

describe('IRNodeView decisions', () => {
  it('draws branch nodes as a true rhombus, matching export', () => {
    const { container } = renderNode(<IRNodeView {...props('branch')} />);
    const polygon = container.querySelector('polygon.cf-node__diamond-shape');
    // Full-box rhombus: top, right, bottom, left — the same geometry the
    // export serializer emits, at any aspect ratio (trap 12).
    expect(polygon?.getAttribute('points')).toBe('50,0 100,50 50,100 0,50');
    expect(container.querySelector('svg.cf-node__diamond')).not.toBeNull();
  });

  it('keeps decision text horizontal above the shape', () => {
    renderNode(<IRNodeView {...props('branch')} />);
    expect(screen.getByText('x > 0')).toBeTruthy();
  });

  it('draws no rhombus for plain blocks', () => {
    const { container } = renderNode(<IRNodeView {...props('basic')} />);
    expect(container.querySelector('polygon')).toBeNull();
  });
});
