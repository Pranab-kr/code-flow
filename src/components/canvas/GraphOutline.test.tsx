import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { GraphOutline } from './GraphOutline';
import type { FunctionGraph, IRNode } from '@/lib/ir/types';

afterEach(() => cleanup());

const FN = 'binary_search(arr,target)';
const node = (id: string, kind: IRNode['kind'], label: string, startLine = 1): IRNode => ({
  id,
  kind,
  label,
  statements: [label],
  span: { startLine, endLine: startLine },
});

const graph: FunctionGraph = {
  id: FN,
  name: 'binary_search',
  params: ['arr', 'target'],
  entryId: `${FN}#entry`,
  exitIds: [],
  nodes: [
    node(`${FN}#entry`, 'entry', 'binary_search(arr, target)', 1),
    node(`${FN}#b0`, 'basic', 'lo = 0', 2),
    node(`${FN}/while@0#cond-b0`, 'loop-header', 'lo <= hi', 4),
    node(`${FN}/while@0/if@0#cond-b0`, 'branch', 'arr[mid] == target', 6),
    node(`${FN}#return-b1`, 'return', 'return -1', 12),
  ],
  edges: [],
};

describe('GraphOutline', () => {
  it('names the function and its size for screen readers', () => {
    render(<GraphOutline graph={graph} />);
    expect(
      screen.getByRole('navigation', { name: /binary_search.*4 nodes/i }),
    ).toBeTruthy();
  });

  it('lists one button per step, skipping the entry terminal', () => {
    render(<GraphOutline graph={graph} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(4);
    expect(screen.getByText('lo = 0')).toBeTruthy();
  });

  it('activating a step reports its line and node id', () => {
    const onSelect = vi.fn();
    render(<GraphOutline graph={graph} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('lo <= hi'));
    expect(onSelect).toHaveBeenCalledWith(4, `${FN}/while@0#cond-b0`);
  });

  it('marks the selected step with aria-current', () => {
    render(<GraphOutline graph={graph} selectedId={`${FN}#b0`} />);
    const current = screen.getByRole('button', { name: /lo = 0/ });
    expect(current.getAttribute('aria-current')).toBe('true');
  });

  it('announces back edges as a return to the target step', () => {
    const looped: FunctionGraph = {
      ...graph,
      edges: [
        {
          id: 'e9',
          source: `${FN}/while@0/if@0#cond-b0`,
          target: `${FN}/while@0#cond-b0`,
          kind: 'back',
          label: 'while',
        },
      ],
    };
    render(<GraphOutline graph={looped} />);
    expect(screen.getByText(/back to step 2/i)).toBeTruthy();
  });
});
