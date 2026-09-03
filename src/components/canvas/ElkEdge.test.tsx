import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { EdgeProps } from '@xyflow/react';
import { ElkEdge, elkPathFor, elkMidpoint } from './ElkEdge';
import type { RFEdge } from './toReactFlow';

afterEach(() => cleanup());

function props(over: Partial<EdgeProps<RFEdge>> = {}) {
  return {
    id: 'e1',
    data: { kind: 'true' as const },
    label: 'true',
    sourceX: 0,
    sourceY: 0,
    targetX: 100,
    targetY: 50,
    ...over,
  } as unknown as EdgeProps<RFEdge>;
}

describe('elkPathFor', () => {
  it('draws routed points as a polyline', () => {
    expect(
      elkPathFor(
        [
          { x: 10, y: 200 },
          { x: 200, y: 200 },
          { x: 10, y: 40 },
        ],
        0,
        0,
        0,
        0,
      ),
    ).toBe('M 10 200 L 200 200 L 10 40');
  });

  it('falls back to a straight endpoint line without routed points', () => {
    expect(elkPathFor(undefined, 0, 0, 100, 50)).toBe('M 0 0 L 100 50');
    expect(elkPathFor([{ x: 1, y: 1 }], 0, 0, 100, 50)).toBe('M 0 0 L 100 50');
  });
});

describe('elkMidpoint', () => {
  it('averages two points and takes the middle element otherwise', () => {
    expect(elkMidpoint(undefined, 0, 0, 100, 50)).toEqual({ x: 50, y: 25 });
    expect(
      elkMidpoint(
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
        ],
        0,
        0,
        0,
        0,
      ),
    ).toEqual({ x: 100, y: 0 });
  });
});

describe('ElkEdge', () => {
  it('renders the routed polyline, not a handle-to-handle guess', () => {
    const points = [
      { x: 10, y: 200 },
      { x: 200, y: 200 },
      { x: 10, y: 40 },
    ];
    const { container } = render(
      <svg>
        <ElkEdge {...props({ data: { kind: 'back', points } })} />
      </svg>,
    );
    const path = container.querySelector('.react-flow__edge-path');
    expect(path?.getAttribute('d')).toBe('M 10 200 L 200 200 L 10 40');
  });

  it('renders the label at the routed midpoint', () => {
    render(
      <svg>
        <ElkEdge
          {...props({
            data: { kind: 'true' as const, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
            label: 'while',
          })}
        />
      </svg>,
    );
    const text = screen.getByText('while');
    expect(text.getAttribute('x')).toBe('50');
    expect(text.getAttribute('y')).toBe('0');
  });

  it('renders no label element when the edge is unlabeled', () => {
    const { container } = render(
      <svg>
        <ElkEdge {...props({ label: undefined })} />
      </svg>,
    );
    expect(container.querySelector('text')).toBeNull();
  });
});
