'use client';

import Link from 'next/link';

export default function PlayError({ reset }: { reset: () => void }) {
  return (
    <main className="arcade-page">
      <div className="ambient-grid" aria-hidden="true" />
      <section className="arcade-error page-shell">
        <span aria-hidden="true">!</span>
        <p>Player one, stand by</p>
        <h1>The arcade needs a quick reset.</h1>
        <button type="button" onClick={reset}>
          Try again
        </button>
        <Link href="/">Back to Sparkade</Link>
      </section>
    </main>
  );
}
