import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { slugify, exportFilename, downloadBlob } from './download';

describe('slugify', () => {
  it('lowercases and dashes non-alphanumerics', () => {
    expect(slugify('My Project 2!')).toBe('my-project-2');
    expect(slugify('binary_search')).toBe('binary-search');
  });

  it('falls back when nothing slugifiable remains', () => {
    expect(slugify('')).toBe('diagram');
    expect(slugify('---')).toBe('diagram');
  });
});

describe('exportFilename', () => {
  it('joins project and function with one extension', () => {
    expect(exportFilename('My Project', 'binary_search', 'png')).toBe(
      'my-project-binary-search.png',
    );
  });

  it('writes jpeg as a single .jpg option', () => {
    expect(exportFilename('T', 'f', 'jpeg')).toBe('t-f.jpg');
    expect(exportFilename('T', 'f', 'svg')).toBe('t-f.svg');
  });

  it('falls back to code-flow without a project title', () => {
    expect(exportFilename(undefined, 'f', 'png')).toBe('code-flow-f.png');
  });
});

describe('downloadBlob', () => {
  const realCreateObjectURL = URL.createObjectURL;
  const realRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:mock'),
      configurable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: vi.fn(),
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(URL, 'createObjectURL', {
      value: realCreateObjectURL,
      configurable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: realRevokeObjectURL,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it('clicks a download anchor and revokes the URL', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const blob = new Blob(['x'], { type: 'image/png' });
    downloadBlob(blob, 'demo-f.png');
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('demo-f.png');
    expect(anchor.href).toBe('blob:mock');
    vi.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock');
  });
});
