import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AnnotationNode } from './AnnotationNode';
import type { NodeProps } from '@xyflow/react';
import type { AnnotationNode as AnnotationNodeType } from './toReactFlow';

afterEach(() => cleanup());

function props(over: Partial<AnnotationNodeType['data']> = {}) {
  return {
    id: 'note-1',
    data: { body: 'hello', nodeId: null, ...over },
    selected: false,
  } as unknown as NodeProps<AnnotationNodeType>;
}

describe('AnnotationNode', () => {
  it('renders the saved body in a textarea', () => {
    render(<AnnotationNode {...props({ body: 'remember this' })} />);
    expect(screen.getByRole('textbox', { name: /sticky note text/i })).toHaveValue(
      'remember this',
    );
  });

  it('saves on blur when the text changed', () => {
    const onSave = vi.fn();
    render(<AnnotationNode {...props({ onSave })} />);
    const box = screen.getByRole('textbox', { name: /sticky note text/i });
    fireEvent.change(box, { target: { value: 'edited' } });
    fireEvent.blur(box);
    expect(onSave).toHaveBeenCalledWith('note-1', 'edited');
  });

  it('does not save on blur when nothing changed', () => {
    const onSave = vi.fn();
    render(<AnnotationNode {...props({ onSave })} />);
    fireEvent.blur(screen.getByRole('textbox', { name: /sticky note text/i }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('deletes through the callback', () => {
    const onDelete = vi.fn();
    render(<AnnotationNode {...props({ onDelete })} />);
    fireEvent.click(screen.getByRole('button', { name: /delete note/i }));
    expect(onDelete).toHaveBeenCalledWith('note-1');
  });

  it('labels anchored and free-floating notes differently', () => {
    const { unmount } = render(<AnnotationNode {...props({ nodeId: 'f()/b0' })} />);
    expect(screen.getByRole('group')).toHaveAttribute(
      'aria-label',
      'Sticky note on a diagram node',
    );
    unmount();
    render(<AnnotationNode {...props({ nodeId: null })} />);
    expect(screen.getByRole('group')).toHaveAttribute(
      'aria-label',
      'Free-floating sticky note',
    );
  });
});
