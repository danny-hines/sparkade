'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { ScoreRow } from '@sparkade/shared';
import { fetchHighScores } from '@/lib/score-client';

export function HighScoresButton({ id, title }: { id: string; title: string }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={button}
        type="button"
        className="arc-heart"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        High Scores
      </button>
      {open && (
        <HighScoresDialog
          id={id}
          title={title}
          onClose={() => {
            setOpen(false);
            button.current?.focus();
          }}
        />
      )}
    </>
  );
}

function HighScoresDialog({
  id,
  title,
  onClose,
}: {
  id: string;
  title: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const labelId = useId();
  const [scores, setScores] = useState<ScoreRow[] | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const close = () => {
    dialog.current?.close();
    onClose();
  };

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setScores(null);
    setError('');
    void fetchHighScores(id, controller.signal).then(
      (rows) => {
        if (!controller.signal.aborted) setScores(rows.slice(0, 10));
      },
      () => {
        if (!controller.signal.aborted) setError('Could not load high scores. Please try again.');
      },
    );
    return () => controller.abort();
  }, [id, attempt]);

  return (
    <dialog
      ref={dialog}
      className="arc-scores-dialog"
      aria-labelledby={labelId}
      aria-describedby={`${labelId}-game`}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="arc-scores-content">
        <div className="arc-scores-heading">
          <h2 id={labelId}>High Scores</h2>
          <button type="button" className="arc-heart" onClick={close} autoFocus>
            Close
          </button>
        </div>
        <p id={`${labelId}-game`} className="arc-scores-game">
          {title} · Top 10
        </p>
        {error ? (
          <div>
            <p role="alert">{error}</p>
            <button
              type="button"
              className="arc-heart"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Try again
            </button>
          </div>
        ) : scores === null ? (
          <p role="status">Loading high scores…</p>
        ) : scores.length === 0 ? (
          <p>No scores yet — be the first!</p>
        ) : (
          <table className="arc-scores-table" aria-label={`Top 10 scores for ${title}`}>
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
                  <td>{score.initials}</td>
                  <td>{score.score.toLocaleString('en-US')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </dialog>
  );
}
