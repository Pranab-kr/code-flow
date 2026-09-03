import { describe, it, expect } from 'vitest';
import { anchoredTo, shiftAnchored, type Annotation } from './annotations';

const notes: Annotation[] = [
  { id: 'n1', nodeId: 'f()/b0', body: 'anchored', x: 10, y: 20 },
  { id: 'n2', nodeId: null, body: 'free', x: 30, y: 40 },
  { id: 'n3', nodeId: 'f()/b0', body: 'anchored too', x: 50, y: 60 },
];

describe('shiftAnchored', () => {
  it('moves notes anchored to the dragged node', () => {
    const next = shiftAnchored(notes, 'f()/b0', 5, -10);
    expect(next.find((n) => n.id === 'n1')).toMatchObject({ x: 15, y: 10 });
    expect(next.find((n) => n.id === 'n3')).toMatchObject({ x: 55, y: 50 });
  });

  it('leaves free-floating notes where they are', () => {
    const next = shiftAnchored(notes, 'f()/b0', 5, -10);
    expect(next.find((n) => n.id === 'n2')).toMatchObject({ x: 30, y: 40 });
  });

  it('ignores notes anchored to other nodes', () => {
    const next = shiftAnchored(notes, 'f()/other', 100, 100);
    expect(next).toBe(notes);
  });

  it('is a no-op for a zero delta', () => {
    expect(shiftAnchored(notes, 'f()/b0', 0, 0)).toBe(notes);
  });

  it('does not mutate the input', () => {
    shiftAnchored(notes, 'f()/b0', 5, 5);
    expect(notes.find((n) => n.id === 'n1')).toMatchObject({ x: 10, y: 20 });
  });
});

describe('anchoredTo', () => {
  it('returns only notes anchored to that node', () => {
    expect(anchoredTo(notes, 'f()/b0').map((n) => n.id)).toEqual(['n1', 'n3']);
    expect(anchoredTo(notes, 'missing')).toEqual([]);
  });
});
