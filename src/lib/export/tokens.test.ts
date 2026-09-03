import { describe, it, expect } from 'vitest';
import { TOKEN_NAMES, readTokens } from './tokens';

describe('tokens', () => {
  it('exports the token contract the exporter reads', () => {
    expect(TOKEN_NAMES).toContain('--color-node-brdr');
    expect(TOKEN_NAMES).toContain('--color-edge-back');
    expect(TOKEN_NAMES).toContain('--color-canvas');
    expect(TOKEN_NAMES).toContain('--font-mono');
  });

  it('reads one value per token name', () => {
    const tokens = readTokens();
    for (const name of TOKEN_NAMES) {
      expect(tokens).toHaveProperty(name);
      expect(typeof tokens[name]).toBe('string');
    }
  });
});
