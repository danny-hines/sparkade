import type { ScoreRow } from '@sparkade/shared';

export async function fetchHighScores(id: string, signal?: AbortSignal): Promise<ScoreRow[]> {
  const response = await fetch(`/api/games/${encodeURIComponent(id)}/scores`, {
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new Error('Could not load high scores. Please try again.');
  return response.json();
}

export async function submitHighScore(
  id: string,
  initials: string,
  score: number,
): Promise<ScoreRow[]> {
  const response = await fetch(`/api/games/${encodeURIComponent(id)}/scores`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ initials, score }),
  });
  if (!response.ok) throw new Error('Your score could not be saved.');
  return response.json();
}
