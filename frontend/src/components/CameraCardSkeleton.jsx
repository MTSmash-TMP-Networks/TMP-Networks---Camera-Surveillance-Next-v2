export function CameraCardSkeleton() {
  return <article className="camera-card camera-card-skeleton" aria-hidden="true">
    <div className="camera-preview skeleton-block" />
    <div className="camera-body">
      <div className="skeleton-line skeleton-title" />
      <div className="skeleton-line skeleton-subtitle" />
      <div className="camera-capabilities skeleton-capabilities">
        <span className="skeleton-pill" />
        <span className="skeleton-pill" />
      </div>
      <div className="skeleton-line skeleton-action" />
    </div>
  </article>;
}
