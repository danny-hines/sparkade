'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { usePathname } from 'next/navigation';
import {
  notificationMessage,
  type GameNotification,
  type NotificationSnapshot,
} from '@/lib/notification-types';

type Toast = GameNotification & { expires: number };
const NotificationContext = createContext<{
  snapshot: NotificationSnapshot | null;
  error: boolean;
  read: (ids: string[], all?: boolean) => Promise<void>;
} | null>(null);
function storedCursor(key: string) {
  try {
    const value = localStorage.getItem(`sparkade-notifications:${key}`);
    return value && /^\d{1,18}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}
function rememberCursor(key: string, value: string) {
  try {
    const old = storedCursor(key);
    localStorage.setItem(
      `sparkade-notifications:${key}`,
      old && BigInt(old) > BigInt(value) ? old : value,
    );
  } catch {
    /* Session memory still deduplicates when storage is disabled. */
  }
}
async function update(action: string, ids: string[], through = '0', signal?: AbortSignal) {
  const response = await fetch('/api/me/notifications', {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, ids, through }),
  });
  if (!response.ok) throw new Error('Notification update failed');
  return (await response.json()) as { claimed: string[] };
}
export function NotificationProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { isLoaded, userId } = useAuth();
  const [snapshot, setSnapshot] = useState<NotificationSnapshot | null>(null),
    [error, setError] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const cursor = useRef<{ key: string; value: string } | null>(null),
    refresh = useRef<() => void>(() => {});
  useEffect(() => {
    if (!isLoaded) return;
    if (!userId) {
      setSnapshot(null);
      setToasts([]);
      cursor.current = null;
      setError(false);
      return;
    }
    const controller = new AbortController();
    let busy = false,
      signedOut = false,
      nextCheck = 0;
    async function poll() {
      if (busy || document.visibilityState !== 'visible' || Date.now() < nextCheck) return;
      busy = true;
      try {
        const response = await fetch('/api/me/notifications', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (response.status === 401) {
          setSnapshot(null);
          setToasts([]);
          cursor.current = null;
          setError(false);
          signedOut = true;
          nextCheck = Date.now() + 60_000;
          return;
        }
        if (!response.ok) throw new Error('Notifications unavailable');
        signedOut = false;
        const next: NotificationSnapshot = await response.json();
        if (controller.signal.aborted) return;
        if (cursor.current?.key !== next.userKey) {
          setToasts([]);
          cursor.current = { key: next.userKey, value: storedCursor(next.userKey) ?? next.cursor };
        }
        const previous = cursor.current.value;
        setSnapshot(next);
        setError(false);
        const incoming = next.items.filter((n) => !n.read && BigInt(n.id) > BigInt(previous));
        if (incoming.length) {
          const { claimed } = await update(
            'claim-toasts',
            incoming.map((n) => n.id),
            '0',
            controller.signal,
          );
          if (controller.signal.aborted) return;
          const accepted = incoming.filter((n) => claimed.includes(n.id));
          if (accepted.length)
            setToasts((old) =>
              [
                ...old,
                ...accepted
                  .slice(0, 3)
                  .reverse()
                  .map((n) => ({ ...n, expires: Date.now() + 10_000 })),
              ].slice(-3),
            );
        }
        cursor.current = { key: next.userKey, value: next.cursor };
        rememberCursor(next.userKey, next.cursor);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        busy = false;
      }
    }
    function wake() {
      nextCheck = 0;
      void poll();
    }
    refresh.current = wake;
    void poll();
    const interval = setInterval(() => {
      if (!signedOut || Date.now() >= nextCheck) void poll();
    }, 10_000);
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    window.addEventListener('storage', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      controller.abort();
      clearInterval(interval);
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', wake);
      window.removeEventListener('storage', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [pathname, isLoaded, userId]);
  useEffect(() => {
    if (!toasts.length) return;
    const timer = setTimeout(
      () => setToasts((current) => current.filter((n) => n.expires > Date.now())),
      Math.max(0, Math.min(...toasts.map((n) => n.expires)) - Date.now()) + 20,
    );
    return () => clearTimeout(timer);
  }, [toasts]);
  const read = useCallback(
    async (ids: string[], all = false) => {
      try {
        await update(all ? 'read-all' : 'read', ids, snapshot?.cursor ?? '0');
        setSnapshot((current) =>
          current
            ? {
                ...current,
                items: current.items.map((n) =>
                  all || ids.includes(n.id) ? { ...n, read: true } : n,
                ),
                unread: all
                  ? 0
                  : Math.max(
                      0,
                      current.unread -
                        current.items.filter((n) => !n.read && ids.includes(n.id)).length,
                    ),
              }
            : null,
        );
        setToasts((current) => current.filter((n) => !all && !ids.includes(n.id)));
        setError(false);
        refresh.current();
      } catch {
        setError(true);
      }
    },
    [snapshot?.cursor],
  );
  return (
    <NotificationContext.Provider value={{ snapshot, error, read }}>
      {children}
      <div className="arc-toast-stack" aria-live="polite" aria-atomic="false">
        {toasts.map((n) => (
          <div key={n.id} className="arc-toast">
            <Link href={`/me/games/${n.gameId}`} onClick={() => void read([n.id])}>
              <strong>{notificationMessage(n.kind)}</strong>
              <span>{n.title}</span>
            </Link>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => setToasts((current) => current.filter((t) => t.id !== n.id))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </NotificationContext.Provider>
  );
}
export function NotificationBell() {
  const context = useContext(NotificationContext),
    [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  if (!context) return null;
  const { snapshot, error, read } = context;
  return (
    <div ref={root} className="arc-notifications">
      <button
        ref={trigger}
        className="arc-notification-bell"
        type="button"
        aria-label={`Notifications${snapshot?.unread ? `, ${snapshot.unread} unread` : ''}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <svg
          width="21"
          height="21"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" />
          <path d="M10 21h4" />
        </svg>
        {!!snapshot?.unread && (
          <span className="arc-notification-count">
            {snapshot.unread > 99 ? '99+' : snapshot.unread}
          </span>
        )}
      </button>
      {open && (
        <section className="arc-notification-panel" aria-label="Game notifications">
          <div className="arc-notification-heading">
            <h2>Notifications</h2>
            {!!snapshot?.unread && (
              <button type="button" onClick={() => void read([], true)}>
                Mark all read
              </button>
            )}
          </div>
          {error && (
            <p role="status">Updates are temporarily unavailable. We’ll reconnect automatically.</p>
          )}
          {!snapshot ? (
            <p>Loading your updates…</p>
          ) : !snapshot.items.length ? (
            <p>You’re all caught up. Updates to your games will appear here.</p>
          ) : (
            <ul>
              {snapshot.items.map((n) => (
                <li key={n.id} className={n.read ? '' : 'is-unread'}>
                  <Link
                    href={`/me/games/${n.gameId}`}
                    onClick={() => {
                      void read([n.id]);
                      setOpen(false);
                    }}
                  >
                    <strong>{notificationMessage(n.kind)}</strong>
                    <span>{n.title}</span>
                    <small>
                      {new Date(n.createdAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </small>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
