/**
 * Shown on FIRST load only, while the grammar wasm downloads — a real wait.
 * After a graph exists, edits update in place: a loading state for work that
 * finishes in ~50ms would be a lie.
 */
export function Skeleton({ label }: { label: string }) {
  return (
    <div className="cf-skeleton" role="status" aria-live="polite">
      <div className="cf-skeleton__stack" aria-hidden="true">
        <span className="cf-skeleton__box" style={{ width: '38%' }} />
        <span className="cf-skeleton__box cf-skeleton__box--diamond" />
        <span className="cf-skeleton__box" style={{ width: '52%' }} />
        <span className="cf-skeleton__box" style={{ width: '30%' }} />
      </div>
      <p className="cf-skeleton__label">{label}</p>
    </div>
  );
}
