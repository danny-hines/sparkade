import type { GenerationFeedEvent } from '@sparkade/shared';

/** Merge history and live SSE rows without duplicates, even when a row lands
 * between the initial HTTP request and EventSource subscription. */
export function mergeGenerationEvents(
  current: readonly GenerationFeedEvent[],
  incoming: readonly GenerationFeedEvent[],
): GenerationFeedEvent[] {
  const byId = new Map<number, GenerationFeedEvent>();
  for (const event of current) byId.set(event.id, event);
  for (const event of incoming) byId.set(event.id, event);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

export function isNearFeedBottom(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
): boolean {
  return scrollHeight - clientHeight - scrollTop <= 48;
}
