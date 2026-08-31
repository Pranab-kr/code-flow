import { describe, expect, it } from 'vitest';
import { detectLanguage } from './detect';

describe('detectLanguage', () => {
  it('detects Python from def and colons', () => {
    expect(detectLanguage('def f(x):\n    return x\n')).toBe('python');
  });

  it('detects Java from a class with a typed method', () => {
    expect(detectLanguage('class T { int f(int a) { return a; } }')).toBe('java');
  });

  it('detects C++ from include or std namespace evidence', () => {
    expect(detectLanguage('#include <vector>\nint f() { return 0; }')).toBe('cpp');
    expect(detectLanguage('std::vector<int> values;')).toBe('cpp');
  });

  it('returns null when genuinely ambiguous', () => {
    expect(detectLanguage('x = 1')).toBeNull();
    expect(detectLanguage('int f() { return 0; }')).toBeNull();
  });
});
