'use client';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { WebsiteProgress } from '@/lib/website-progress';
export function GenerationFeed({ gameId, initial }: { gameId: string; initial: WebsiteProgress }) {
  const [feed, setFeed] = useState(initial),
    [offline, setOffline] = useState(false);
  const [following, setFollowing] = useState(true);
  const panel = useRef<HTMLDivElement>(null),
    follow = useRef(true),
    status = useRef(initial.status);
  const router = useRouter();
  useEffect(() => {
    const controller = new AbortController();
    let busy = false,
      terminal = initial.terminal;
    async function refresh() {
      if (busy || terminal || document.visibilityState !== 'visible') return;
      busy = true;
      try {
        const response = await fetch(`/api/me/games/${encodeURIComponent(gameId)}/progress`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Progress unavailable');
        const next: WebsiteProgress = await response.json();
        setFeed(next);
        setOffline(false);
        terminal = next.terminal;
        if (next.status !== status.current) {
          status.current = next.status;
          router.refresh();
        }
      } catch {
        if (!controller.signal.aborted) setOffline(true);
      } finally {
        busy = false;
      }
    }
    const interval = setInterval(refresh, 5000);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      controller.abort();
      clearInterval(interval);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [gameId, initial.terminal, router]);
  useEffect(() => {
    if (follow.current && panel.current) panel.current.scrollTop = panel.current.scrollHeight;
  }, [feed.items.length]);
  useEffect(() => {
    const list = panel.current?.firstElementChild;
    if (!list) return;
    const observer = new ResizeObserver(() => {
      if (follow.current && panel.current) panel.current.scrollTop = panel.current.scrollHeight;
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, []);
  return (
    <section className="arc-panel arc-generation-feed" aria-labelledby="generation-feed-title">
      <div className="arc-section-heading">
        <div>
          <span className="arc-kicker">Inside the build</span>
          <h2 id="generation-feed-title">
            {feed.terminal ? 'Your build story' : 'Your game, coming to life'}
          </h2>
        </div>
        <span className={`arc-build-state${feed.terminal ? ' is-finished' : ''}`}>
          {feed.terminal ? 'Finished' : 'Live'}
        </span>
      </div>
      <p role="status">
        {offline
          ? 'Reconnecting… your game keeps building. We’ll catch up automatically.'
          : feed.summary}
      </p>
      <p className="arc-fine-print">
        {feed.terminal
          ? 'The decisions, art and checks that went into your game.'
          : 'You can leave this page. We’ll notify you when your game is ready. Art previews may change before the final content check.'}
      </p>
      <div
        className="arc-feed-scroll"
        ref={panel}
        tabIndex={0}
        aria-label="Generation activity"
        onWheel={(event) => {
          if (event.deltaY < 0) {
            follow.current = false;
            setFollowing(false);
          }
        }}
        onTouchMove={() => {
          follow.current = false;
          setFollowing(false);
        }}
        onPointerDown={() => {
          follow.current = false;
          setFollowing(false);
        }}
        onKeyDown={(event) => {
          if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) {
            follow.current = false;
            setFollowing(false);
          }
        }}
        onScroll={() => {
          const p = panel.current!;
          if (p.scrollHeight - p.scrollTop - p.clientHeight < 60) {
            follow.current = true;
            setFollowing(true);
          }
        }}
      >
        <ol className="arc-feed-list">
          {feed.items.map((item) => (
            <li key={item.id} className={`arc-feed-item arc-feed-${item.kind}`}>
              <span className="arc-feed-dot" aria-hidden="true" />
              <div>
                <span className="arc-feed-label">
                  {item.kind === 'review'
                    ? 'Content check'
                    : item.kind === 'asset'
                      ? 'Art studio'
                      : item.kind === 'decision'
                        ? 'Game design'
                        : 'Build update'}
                </span>
                <p>{item.message}</p>
                {item.caption && <p className="arc-fine-print">{item.caption}</p>}
                {item.image && (
                  <Image
                    className="arc-feed-image"
                    src={item.image}
                    alt={item.message}
                    width={480}
                    height={270}
                    unoptimized
                    onLoad={() => {
                      if (follow.current && panel.current)
                        panel.current.scrollTop = panel.current.scrollHeight;
                    }}
                  />
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
      {!following && (
        <button
          className="arc-button-secondary arc-feed-follow"
          onClick={() => {
            follow.current = true;
            setFollowing(true);
            if (panel.current) panel.current.scrollTop = panel.current.scrollHeight;
          }}
        >
          Jump to latest ↓
        </button>
      )}
    </section>
  );
}
