// Game detail: Play, Leaderboard, synopsis, control card, cost breakdown,
// Retry (failed only), Delete (extra confirmation with hold-A).
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { archetypes } from '@sparkade/archetypes';
import { DELETE_HOLD_MS, type ScoreRow } from '@sparkade/shared';
import { api, type GameDetail } from '../api';
import { FooterLegend, GameCover, HoldRing, Modal, usd } from '../components';
import { shellInput } from '../shell-input';
import { Icon, Btn } from '../icons';
import type { Screen } from '../app';

export function GameDetailScreen(props: { go: (s: Screen) => void; id: string }): ComponentChildren {
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [cursor, setCursor] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    void api.getGame(props.id).then(setDetail).catch(() => props.go({ name: 'library' }));
    void api.getScores(props.id).then(setScores).catch(() => {});
  }, [props.id]);

  const item = detail?.item;
  const playable = item?.status === 'ready';
  const failed = item?.status === 'failed';
  const generating = item?.status === 'generating' || item?.status === 'queued';
  const actions: { key: string; label: ComponentChildren; danger?: boolean }[] = [];
  if (playable) actions.push({ key: 'play', label: <><Icon name="play" />{'  '}Play</> });
  if (generating) actions.push({ key: 'progress', label: <><Icon name="sparkle" />{'  '}View progress</> });
  if (failed) actions.push({ key: 'retry', label: <><Icon name="refresh" />{'  '}Retry generation</> });
  actions.push({ key: 'delete', label: <><Icon name="close" />{'  '}Delete</>, danger: true });

  useEffect(
    () =>
      shellInput.pushHandler((btn) => {
        if (confirmDelete) return; // modal has its own handler
        if (btn === 'UP') {
          setCursor((c) => (c + actions.length - 1) % actions.length);
          shellInput.blip('move');
        } else if (btn === 'DOWN') {
          setCursor((c) => (c + 1) % actions.length);
          shellInput.blip('move');
        } else if (btn === 'A') {
          shellInput.blip('select');
          const action = actions[cursor]?.key;
          if (action === 'play') props.go({ name: 'play', id: props.id });
          else if (action === 'retry') {
            void api.retryGame(props.id).then((r) => {
              props.go({ name: 'generation', jobId: r.jobId, gameId: props.id });
            }).catch(() => shellInput.blip('error'));
          } else if (action === 'progress' && detail?.job) {
            props.go({ name: 'generation', jobId: detail.job.id, gameId: props.id });
          } else if (action === 'delete') {
            setConfirmDelete(true);
          }
        } else if (btn === 'B') {
          shellInput.blip('back');
          props.go({ name: 'library' });
        }
      }),
    [actions.length, cursor, confirmDelete, detail, props.go, props.id],
  );

  if (!detail || !item) {
    return (
      <div class="screen">
        <div class="center-col">
          <span style="font-size:34px;color:var(--cyan)"><Icon name="sparkle" class="spin" /></span>
        </div>
      </div>
    );
  }

  const spec = detail.spec;
  const attempts = detail.job?.attempt ?? 1;
  const failedCalls = detail.usage.filter((u) => u.failed).length;
  const repairCalls = detail.usage.filter((u) => u.repair).length;
  const controlHelp = spec ? archetypes[spec.archetype].controlHelp : [];

  return (
    <div class="screen">
      <div class="screen-title">
        <h2 class="pixel">{item.title.toUpperCase()}</h2>
        <span class="status-chips">
          <span class={`badge ${item.golden ? 'golden' : item.status}`}>
            {item.golden ? 'Built-in' : item.status}
          </span>
        </span>
      </div>
      <div class="screen-body two-col">
        <div>
          <GameCover cover={item.cover} gameId={item.id} seedText={item.title} class="detail-cover" />
          <p style="color:var(--text-dim);margin:8px 0 4px;font-size:14px">{item.tagline}</p>
          {spec && (
            <p style="font-size:13px;line-height:1.5;max-height:66px;overflow:hidden">
              {spec.story.intro.join(' ')}
            </p>
          )}
          <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12px;color:var(--text-dim)">
            {controlHelp.slice(0, 6).map((c) => (
              <span key={c.button}>
                <b style="color:var(--cyan)">({c.button})</b> {c.label}
              </span>
            ))}
          </div>
          <div style="margin-top:8px;font-size:13px;color:var(--text-dim)">
            {item.golden ? (
              'Hand-crafted launch title — free'
            ) : (
              <>
                Generation cost <b style="color:var(--gold)">{usd(item.costUsd)}</b>
                {attempts > 1 || failedCalls + repairCalls > 0
                  ? ` · ${attempts} attempt${attempts > 1 ? 's' : ''}, ${repairCalls} repair, ${failedCalls} failed calls included`
                  : ''}
              </>
            )}
          </div>
          {failed && item.failure && (
            <div style="margin-top:10px">
              <div style="color:var(--danger);font-size:18px">{item.failure.message}</div>
              <div class="error-code">CODE: {item.failure.code.toUpperCase()}</div>
            </div>
          )}
        </div>
        <div>
          <div class="menu-list" style="margin:0">
            {actions.map((a, i) => (
              <div
                key={a.key}
                class={`focusable menu-item ${i === cursor ? 'focused' : ''} ${a.danger ? 'danger' : ''}`}
                style={a.danger && i === cursor ? 'border-color:var(--danger);box-shadow:0 0 0 4px var(--danger)' : ''}
              >
                {a.label}
              </div>
            ))}
          </div>
          <h3 style="margin:18px 0 8px;color:var(--cyan);font-size:19px">LEADERBOARD</h3>
          <table class="score-table">
            <tbody>
              {scores.length === 0 && (
                <tr>
                  <td style="color:var(--text-dim)">No scores yet — be the first!</td>
                </tr>
              )}
              {scores.slice(0, 5).map((s, i) => (
                <tr key={i}>
                  <td style="width:36px;color:var(--text-dim)">{i + 1}.</td>
                  <td class="initials">{s.initials}</td>
                  <td style="text-align:right">{s.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <FooterLegend
        items={[
          ['A', 'Select'],
          ['B', 'Back'],
        ]}
      />
      {confirmDelete && (
        <DeleteModal
          title={item.title}
          onCancel={() => setConfirmDelete(false)}
          onConfirmed={() => {
            void api.deleteGame(props.id).then(() => {
              shellInput.blip('success');
              props.go({ name: 'library' });
            });
          }}
        />
      )}
    </div>
  );
}

/** Cancel focused by default; deleting = focus Delete then HOLD A for 3s. */
function DeleteModal(props: {
  title: string;
  onCancel: () => void;
  onConfirmed: () => void;
}): ComponentChildren {
  const [cursor, setCursor] = useState(0); // 0 = Cancel (safe default), 1 = Delete
  const [holdT, setHoldT] = useState(0);
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const fired = useRef(false);
  // Inline-arrow props get fresh identities each parent render; route the
  // timer/handler effects through refs so they mount exactly once.
  const callbacksRef = useRef(props);
  callbacksRef.current = props;

  useEffect(
    () =>
      shellInput.pushHandler(
        (btn) => {
          if (btn === 'LEFT' || btn === 'RIGHT') {
            setCursor((c) => 1 - c);
            shellInput.blip('move');
          } else if (btn === 'B') {
            shellInput.blip('back');
            callbacksRef.current.onCancel();
          } else if (btn === 'A' && cursorRef.current === 0) {
            shellInput.blip('back');
            callbacksRef.current.onCancel();
          }
        },
        { modal: true },
      ),
    [],
  );

  // Hold-A progress while Delete is focused; releasing early cancels the hold.
  useEffect(() => {
    const t = setInterval(() => {
      const held = shellInput.broker.state().A.held;
      if (cursorRef.current === 1 && held) {
        setHoldT((v) => {
          const next = v + 50;
          if (next >= DELETE_HOLD_MS && !fired.current) {
            fired.current = true;
            callbacksRef.current.onConfirmed();
          }
          return next;
        });
      } else {
        setHoldT(0);
      }
    }, 50);
    return () => clearInterval(t);
  }, []);

  return (
    <Modal>
      <h3>Delete “{props.title}”?</h3>
      <p>This removes the game, its artwork, its likeness sprites and its entire leaderboard.</p>
      <p style="font-size:17px">This cannot be undone.</p>
      <div class="choices">
        <div class={`focusable ${cursor === 0 ? 'focused' : ''}`}>Cancel</div>
        <div class={`focusable danger ${cursor === 1 ? 'focused' : ''}`}>Delete</div>
      </div>
      {cursor === 1 ? (
        <>
          <HoldRing t={holdT / DELETE_HOLD_MS} />
          <p style="font-size:16px;margin-top:8px">Hold <Btn>A</Btn> to delete · release to cancel</p>
        </>
      ) : (
        <p style="font-size:16px;margin-top:16px;color:var(--text-dim)"><Btn>B</Btn> Cancel</p>
      )}
    </Modal>
  );
}
