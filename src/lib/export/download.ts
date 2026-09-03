/**
 * Filenames and the download trigger for exports.
 *
 * Pure filename building (unit-tested) is kept separate from the DOM trigger
 * (a real click on a synthetic anchor — the user-initiated gesture browsers
 * require for downloads).
 */

export type ExportFileFormat = 'png' | 'jpeg' | 'svg';

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'diagram' : slug;
}

function extFor(format: ExportFileFormat): string {
  // jpg and jpeg are one format: a single JPEG option, `.jpg` on disk.
  return format === 'jpeg' ? 'jpg' : format;
}

/** `{project-title}-{function-name}.{ext}`, slugified. */
export function exportFilename(
  projectTitle: string | undefined,
  functionName: string,
  format: ExportFileFormat,
): string {
  const project = slugify(projectTitle ?? 'code-flow');
  return `${project}-${slugify(functionName)}.${extFor(format)}`;
}

/**
 * Start a download. Must run inside the user's click handling: a synthetic
 * click on an unattached anchor still counts as user-initiated for downloads,
 * where window.open would be blocked. The object URL is revoked shortly after
 * the browser has taken it — a microtask is too early in some browsers.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
