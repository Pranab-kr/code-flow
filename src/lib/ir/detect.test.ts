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

  it('detects JavaScript from arrows, strict equality, and console', () => {
    expect(
      detectLanguage(
        'const binarySearch = (arr, target) => {\n  if (arr[0] === target) return 0;\n  return -1;\n}\n',
      ),
    ).toBe('javascript');
  });

  it('detects JavaScript from import-from and export', () => {
    expect(
      detectLanguage("import { parse } from './parse';\nexport function f() { return 1; }\n"),
    ).toBe('javascript');
  });

  it('leaves TypeScript-annotated code unselected (spec §7)', () => {
    expect(
      detectLanguage('function add(a: number, b: number): number {\n  return a + b;\n}\n'),
    ).toBeNull();
    expect(detectLanguage('interface User {\n  name: string;\n}\n')).toBeNull();
  });
});
