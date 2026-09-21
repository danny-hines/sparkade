import type { ScoreRow } from '@sparkade/shared';
import { ensureArcadeSchema } from './arcade-schema';
import { resolveCreditEnvironment } from './invites';
import { getSql } from './db';

export async function topScores(gameId: string): Promise<ScoreRow[]> {
  await ensureArcadeSchema();
  const rows = await getSql()`SELECT initials,score,created_at FROM arcade_scores
    WHERE environment=${resolveCreditEnvironment()} AND game_id=${gameId}
    ORDER BY score DESC,created_at,id LIMIT 10`;
  return rows.map((row) => ({
    initials: String(row.initials),
    score: Number(row.score),
    at: new Date(row.created_at).toISOString(),
  }));
}

export async function addScore(
  gameId: string,
  initials: string,
  score: number,
): Promise<ScoreRow[]> {
  await ensureArcadeSchema();
  await getSql()`INSERT INTO arcade_scores(environment,game_id,initials,score)
    VALUES(${resolveCreditEnvironment()},${gameId},${initials},${score})`;
  return topScores(gameId);
}
