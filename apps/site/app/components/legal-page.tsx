import type { ReactNode } from 'react';
import { ArcadeFooter, ArcadeHeader } from './arcade-ui';
import styles from './legal-page.module.css';

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <ArcadeHeader viewer={null} />
      <main className={`arc-shell ${styles.page}`}>
        <article className={styles.article}>
          <p className="arc-kicker">Sparkade</p>
          <h1>{title}</h1>
          <p className={styles.date}>Last updated: September 16, 2026</p>
          {children}
        </article>
      </main>
      <ArcadeFooter />
    </>
  );
}
