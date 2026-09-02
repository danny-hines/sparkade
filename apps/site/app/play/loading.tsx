export default function PlayLoading() {
  return (
    <main className="arcade-page arcade-loading" aria-busy="true">
      <div className="ambient-grid" aria-hidden="true" />
      <div className="page-shell arcade-loading-brand">Sparkade</div>
      <section className="arcade-intro page-shell">
        <div className="arcade-loading-line arcade-loading-line-small" />
        <div className="arcade-loading-line arcade-loading-line-title" />
        <div className="arcade-loading-line arcade-loading-line-copy" />
      </section>
      <section className="arcade-feed page-shell" aria-label="Loading published games">
        <div className="arcade-loading-grid">
          {Array.from({ length: 6 }, (_, index) => (
            <div className="arcade-loading-card" key={index} />
          ))}
        </div>
      </section>
    </main>
  );
}
