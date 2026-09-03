import { describe, it, expect } from 'vitest';
import { ENABLED_PROVIDERS, PROVIDERS, getProvider } from './providers';

describe('provider registry', () => {
  it('every enabled provider has a real base URL', () => {
    expect(ENABLED_PROVIDERS.length).toBeGreaterThan(0);
    for (const p of ENABLED_PROVIDERS) {
      expect(p.baseUrl, `${p.id}`).toMatch(/^https:\/\//);
      expect(p.baseUrl).not.toContain('TODO');
    }
  });

  it('keeps unverified providers out of ENABLED_PROVIDERS', () => {
    const ids = new Set(ENABLED_PROVIDERS.map((p) => p.id));
    expect(ids.has('opencode-zen')).toBe(false);
    expect(ids.has('nvidia-nim')).toBe(false);
    // They still exist in the full table, marked for verification.
    expect(PROVIDERS.find((p) => p.id === 'opencode-zen')?.baseUrl).toContain('TODO');
    expect(PROVIDERS.find((p) => p.id === 'nvidia-nim')?.baseUrl).toContain('TODO');
  });

  it('resolves enabled providers by id and nothing else', () => {
    expect(getProvider('openai')?.label).toBe('OpenAI');
    expect(getProvider('no-such-provider')).toBeUndefined();
    expect(getProvider('opencode-zen')).toBeUndefined();
  });
});
