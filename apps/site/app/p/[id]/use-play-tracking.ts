'use client';
import { useEffect } from 'react';
/** Count ten visible, focused seconds after the engine starts. Page views do not count. */
export function usePlayTracking(id: string, playing: boolean, enabled: boolean) {
  useEffect(() => {
    if (!playing || !enabled) return;
    let stopped = false,
      ticket: string | null = null,
      seconds = 0;
    const send = (body: object) =>
      fetch(`/api/games/${id}/plays`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    void send({})
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        ticket = data?.ticket ?? null;
      })
      .catch(() => {});
    const interval = setInterval(() => {
      if (stopped || !ticket || document.visibilityState !== 'visible' || !document.hasFocus())
        return;
      seconds++;
      if (seconds >= 10) {
        stopped = true;
        clearInterval(interval);
        void send({ ticket }).catch(() => {});
      }
    }, 1000);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [id, playing, enabled]);
}
