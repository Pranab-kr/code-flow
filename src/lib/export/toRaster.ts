/**
 * SVG string -> PNG/JPEG Blob, via a canvas.
 *
 * The SVG is drawn by `toSvg.ts` from graph geometry (never the DOM), so this
 * step is only rasterization: decode the SVG into an image, paint it at scale
 * onto a canvas, encode the canvas. Nothing here parses the graph.
 *
 * Two traps this avoids:
 * - UTF-8 diagrams must be base64-encoded, not `encodeURIComponent`-escaped:
 *   Safari mishandles some UTF-8 in data URLs built the second way.
 * - Browsers cap canvas area (around 268MP on Chrome, lower on iOS Safari).
 *   Past the cap the canvas silently goes blank, so refuse above a fixed
 *   budget with a plain-language error instead of producing a blank image.
 */

export type RasterFormat = 'png' | 'jpeg';

/**
 * Refuse above ~64MP: well under every browser's blank-canvas cliff, well
 * above any honest 3x diagram export.
 */
export const MAX_EXPORT_PIXELS = 64_000_000;

/** An explicit white for JPEG, which has no alpha — not a theme color. */
const JPEG_FALLBACK_BG = '#ffffff';

export interface SvgSize {
  width: number;
  height: number;
}

/**
 * Read the intrinsic size off the svg root. `graphToSvg` always emits
 * width/height; the viewBox fallback keeps hand-made SVGs working.
 */
export function parseSvgSize(svg: string): SvgSize {
  const root = svg.slice(0, svg.indexOf('>') + 1);
  const w = root.match(/width="([\d.]+)"/)?.[1];
  const h = root.match(/height="([\d.]+)"/)?.[1];
  if (w !== undefined && h !== undefined) {
    const width = Number(w);
    const height = Number(h);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return { width, height };
    }
  }
  const vb = root.match(/viewBox="([-\d. ]+)"/)?.[1];
  if (vb) {
    const parts = vb.trim().split(/\s+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      const width = parts[2];
      const height = parts[3];
      if (width > 0 && height > 0) return { width, height };
    }
  }
  throw new Error('Could not determine the diagram size, so the export was stopped.');
}

/** Unicode-safe base64: btoa alone throws on non-Latin1 diagrams. */
function base64Encode(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The diagram could not be rendered as an image.'));
    img.src = url;
  });
}

/**
 * Rasterize an SVG string.
 *
 * `background` is a CSS color, or 'transparent'/'' to keep the alpha channel
 * (PNG only). JPEG has no alpha, so a missing background paints white rather
 * than exporting a black box where transparency was.
 */
export async function svgToBlob(
  svg: string,
  format: RasterFormat,
  scale: number,
  background: string,
): Promise<Blob> {
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error('The export scale must be a positive number.');
  }
  const size = parseSvgSize(svg);
  const width = Math.round(size.width * scale);
  const height = Math.round(size.height * scale);
  if (width <= 0 || height <= 0) {
    throw new Error('Could not determine the diagram size, so the export was stopped.');
  }
  if (width * height > MAX_EXPORT_PIXELS) {
    throw new Error(
      `That export would be ${width}×${height} pixels, which is too large to render. Try 1× scale.`,
    );
  }

  const img = await loadImage(`data:image/svg+xml;base64,${base64Encode(svg)}`);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('This browser could not provide a drawing canvas, so the export was stopped.');
  }
  const transparent = background === '' || background === 'transparent';
  if (format === 'jpeg' && transparent) {
    ctx.fillStyle = JPEG_FALLBACK_BG;
    ctx.fillRect(0, 0, width, height);
  } else if (!transparent) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(img, 0, 0, width, height);

  const type = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), type, 0.92),
  );
  if (!blob) throw new Error('The browser could not encode the image.');
  return blob;
}
