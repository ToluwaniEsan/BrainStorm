// A soft three-dot loader. `page` fills the screen and centres itself (for a
// whole page that is still loading); otherwise it centres in the space it's in.
export function Loading({ label = "Loading", page = false }: { label?: string; page?: boolean }) {
  return (
    <div className={`c-loading${page ? " page" : ""}`} role="status" aria-live="polite">
      <span className="c-loading-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="c-loading-label">{label}</span>
    </div>
  );
}

// Suspense fallback for a whole page.
export function PageLoading() {
  return (
    <main className="c-shell">
      <Loading page />
    </main>
  );
}
