import { useEffect, useRef, useState } from 'preact/hooks';
import type { ScoreRow } from '@sparkade/shared';
import { api } from '../api';
import { Modal } from '../components';
import { Btn } from '../icons';
import { shellInput } from '../shell-input';

export function HighScoresModal({
  gameId,
  title,
  onClose,
}: {
  gameId: string;
  title: string;
  onClose: () => void;
}) {
  const [scores, setScores] = useState<ScoreRow[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const state = useRef({ onClose, error });
  state.current = { onClose, error };

  useEffect(() => {
    let live = true;
    setError(false);
    setScores(null);
    void api.getScores(gameId).then(
      (rows) => {
        if (live) setScores(rows.slice(0, 10));
      },
      () => {
        if (live) setError(true);
      },
    );
    return () => {
      live = false;
    };
  }, [gameId, attempt]);

  useEffect(() => {
    shellInput.swallow();
    return shellInput.pushHandler(
      (button) => {
        if (button === 'A' && state.current.error) {
          shellInput.blip('select');
          setAttempt((value) => value + 1);
        } else if (button === 'A' || button === 'B') {
          shellInput.blip('back');
          shellInput.swallow();
          state.current.onClose();
        }
      },
      { modal: true },
    );
  }, []);

  return (
    <Modal>
      <div
        class="high-scores-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="high-scores-title"
        aria-describedby="high-scores-game"
      >
        <h3 id="high-scores-title">High Scores</h3>
        <p id="high-scores-game" class="high-scores-game">
          {title} · Top 10
        </p>
        {error ? (
          <p role="alert">Could not load high scores.</p>
        ) : scores === null ? (
          <p role="status">Loading high scores…</p>
        ) : scores.length === 0 ? (
          <p>No scores yet — be the first!</p>
        ) : (
          <table class="score-table" aria-label={`Top 10 scores for ${title}`}>
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Player</th>
                <th scope="col">Score</th>
              </tr>
            </thead>
            <tbody>
              {scores.map((score, index) => (
                <tr key={index}>
                  <td>{index + 1}</td>
                  <td class="initials">{score.initials}</td>
                  <td>{score.score.toLocaleString('en-US')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p class="high-scores-help">
          <Btn>A</Btn> {error ? 'Retry' : 'Close'} · <Btn>B</Btn> Back
        </p>
      </div>
    </Modal>
  );
}
