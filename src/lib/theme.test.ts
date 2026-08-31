import { describe, it, expect } from 'vitest';
import { resolveTheme } from './theme';

describe('resolveTheme', () => {
  it('returns the explicit preference regardless of system', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('follows the system when preference is system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('defaults to dark for system preference with no signal', () => {
    // Aurora Night is the designed default (spec §10)
    expect(resolveTheme('system', undefined as unknown as boolean)).toBe('dark');
  });
});
