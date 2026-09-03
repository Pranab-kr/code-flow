import { describe, it, expect, vi, afterEach } from 'vitest';
import { svgToBlob, parseSvgSize, MAX_EXPORT_PIXELS } from './toRaster';

const SMALL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 150" width="200" height="150"><rect width="200" height="150"/></svg>';

function fakeImageClass(fail: boolean) {
  return class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private _src = '';
    set src(v: string) {
      this._src = v;
      queueMicrotask(() => {
        if (fail) this.onerror?.();
        else this.onload?.();
      });
    }
    get src(): string {
      return this._src;
    }
  };
}

interface CanvasStub {
  ctx: { fillStyle: string; fillRect: ReturnType<typeof vi.fn>; drawImage: ReturnType<typeof vi.fn> };
  createSpy: ReturnType<typeof vi.spyOn>;
}

/** jsdom has no real canvas, so stub the element svgToBlob creates internally. */
function stubCanvas(): CanvasStub {
  const ctx = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'getContext', {
    value: vi.fn(() => ctx),
    configurable: true,
  });
  Object.defineProperty(canvas, 'toBlob', {
    value: vi.fn((cb: (b: Blob | null) => void, type?: string) => {
      cb(new Blob(['img'], { type }));
    }),
    configurable: true,
  });
  const realCreate = document.createElement.bind(document);
  const createSpy = vi
    .spyOn(document, 'createElement')
    .mockImplementation(((tag: string) =>
      tag === 'canvas' ? canvas : realCreate(tag)) as typeof document.createElement);
  return { ctx, createSpy };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('parseSvgSize', () => {
  it('reads width and height off the svg root', () => {
    expect(parseSvgSize(SMALL_SVG)).toEqual({ width: 200, height: 150 });
  });

  it('falls back to the viewBox when width/height are absent', () => {
    expect(parseSvgSize('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 -20 240 190"></svg>')).toEqual({
      width: 240,
      height: 190,
    });
  });

  it('throws a plain-language error when no size can be found', () => {
    expect(() => parseSvgSize('<svg></svg>')).toThrow(/size/i);
  });
});

describe('svgToBlob', () => {
  it('rejects a scale that would exceed the canvas limit', async () => {
    expect(MAX_EXPORT_PIXELS).toBe(64_000_000);
    await expect(svgToBlob('<svg width="8000" height="8000"/>', 'png', 4, '#fff')).rejects.toThrow(
      /too large/i,
    );
  });

  it('rejects a diagram with no determinable size', async () => {
    await expect(svgToBlob('<svg></svg>', 'png', 1, '#fff')).rejects.toThrow(/size/i);
  });

  it('resolves to a Blob of the requested type, scaled', async () => {
    vi.stubGlobal('Image', fakeImageClass(false));
    const stub = stubCanvas();
    const blob = await svgToBlob(SMALL_SVG, 'png', 2, 'transparent');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
    const el = stub.createSpy.mock.results[0].value as HTMLCanvasElement;
    expect(el.width).toBe(400);
    expect(el.height).toBe(300);
  });

  it('always paints a background for jpeg — it has no alpha', async () => {
    vi.stubGlobal('Image', fakeImageClass(false));
    const { ctx } = stubCanvas();
    const blob = await svgToBlob(SMALL_SVG, 'jpeg', 1, 'transparent');
    expect(blob.type).toBe('image/jpeg');
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
  });

  it('keeps transparency for png when asked', async () => {
    vi.stubGlobal('Image', fakeImageClass(false));
    const { ctx } = stubCanvas();
    await svgToBlob(SMALL_SVG, 'png', 1, 'transparent');
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it('paints the requested background color', async () => {
    vi.stubGlobal('Image', fakeImageClass(false));
    const { ctx } = stubCanvas();
    await svgToBlob(SMALL_SVG, 'png', 1, '#ebeff0');
    expect(ctx.fillStyle).toBe('#ebeff0');
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
  });

  it('rejects when the image fails to render', async () => {
    vi.stubGlobal('Image', fakeImageClass(true));
    stubCanvas();
    await expect(svgToBlob(SMALL_SVG, 'png', 1, '#fff')).rejects.toThrow(/render/i);
  });
});
