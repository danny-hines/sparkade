// SSE hub: per-job subscriber lists with last-event replay so a reloaded page
// immediately reflects real job state.
import type { JobEvent } from '@sparkade/shared';

type Listener = (event: JobEvent) => void;

export class SseHub {
  private listeners = new Map<string, Set<Listener>>();
  private lastEvent = new Map<string, JobEvent>();

  subscribe(jobId: string, listener: Listener): () => void {
    let set = this.listeners.get(jobId);
    if (!set) {
      set = new Set();
      this.listeners.set(jobId, set);
    }
    set.add(listener);
    const last = this.lastEvent.get(jobId);
    if (last) listener(last);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.listeners.delete(jobId);
    };
  }

  emit(event: JobEvent): void {
    this.lastEvent.set(event.jobId, event);
    const set = this.listeners.get(event.jobId);
    if (set) for (const l of [...set]) l(event);
    // Terminal events linger for late subscribers, then get dropped.
    if (event.type === 'done' || event.type === 'failed') {
      setTimeout(() => {
        if (this.lastEvent.get(event.jobId) === event) this.lastEvent.delete(event.jobId);
      }, 10 * 60 * 1000).unref?.();
    }
  }
}
