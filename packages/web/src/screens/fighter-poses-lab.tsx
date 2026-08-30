// Dev-only Fighter Poses Lab (http://localhost:5173/?dev=fighter-poses).
// Runs one avatar through the production candidate/judge/atlas path.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import {
  api,
  subscribeFighterPoseLab,
  type FighterPoseJudgeDecision,
  type FighterPoseLabEvent,
  type FighterPoseLabStage,
  type FighterPoseName,
} from '../api';

interface AssetView {
  id: string;
  label: string;
  pose?: FighterPoseName;
  status: FighterPoseLabEvent['status'];
  rawUrl?: string;
  processedUrl?: string;
  discardedComponentCount?: number;
  reclaimedBleedPixels?: number;
  excludedNeighborPixels?: number;
  error?: string;
}

const STAGES: Array<{ id: FighterPoseLabStage; label: string; note: string }> = [
  { id: 'source', label: 'Source', note: 'normalize photo' },
  { id: 'foundations', label: '3 identities', note: 'parallel anchors' },
  { id: 'identity-judge', label: 'Identity judge', note: 'Spark selects seed' },
  { id: 'poses', label: '12 states', note: 'one shared anchor' },
  { id: 'pose-judge', label: 'Set judge', note: 'identity + readability' },
  { id: 'retry', label: 'Targeted retry', note: 'up to 4 weak poses' },
  { id: 'atlas', label: 'Atlas', note: 'pack selected cells' },
  { id: 'complete', label: 'Result', note: 'inspect + verdict' },
];

const POSES: FighterPoseName[] = [
  'idle',
  'walk',
  'crouch',
  'jump',
  'punchHigh',
  'punchLow',
  'kickHigh',
  'kickLow',
  'airPunch',
  'airKick',
  'block',
  'hit',
  'ko',
];

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function assetFrom(event: FighterPoseLabEvent): AssetView | null {
  if (event.type !== 'asset') return null;
  const id = stringValue(event.data?.id);
  if (!id) return null;
  return {
    id,
    label: stringValue(event.data?.label) ?? id,
    pose: stringValue(event.data?.pose) as FighterPoseName | undefined,
    status: event.status,
    rawUrl: stringValue(event.data?.rawUrl),
    processedUrl: stringValue(event.data?.processedUrl),
    discardedComponentCount: numberValue(event.data?.discardedComponentCount),
    reclaimedBleedPixels: numberValue(event.data?.reclaimedBleedPixels),
    excludedNeighborPixels: numberValue(event.data?.excludedNeighborPixels),
    error: stringValue(event.data?.error),
  };
}

function latest(
  events: readonly FighterPoseLabEvent[],
  predicate: (event: FighterPoseLabEvent) => boolean,
): FighterPoseLabEvent | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    if (predicate(events[index]!)) return events[index];
  }
  return undefined;
}

function scoreClass(value: number): string {
  return value >= 4 ? 'good' : value >= 3 ? 'warn' : 'bad';
}

function Score(props: { label: string; value: number }): ComponentChildren {
  return (
    <span class={`ppl-score ${scoreClass(props.value)}`}>
      <span>{props.label}</span>
      <b>{props.value}/5</b>
    </span>
  );
}

export function FighterPosesLabScreen(): ComponentChildren {
  const initialRun = new URLSearchParams(location.search).get('run') ?? '';
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [name, setName] = useState('PLAYER');
  const [visualConcept, setVisualConcept] = useState(
    'A heroic adult rooftop fighter in a cropped indigo jacket, wrapped forearms, fitted trousers, split-toe boots, and a brass comet shoulder crest.',
  );
  const [build, setBuild] = useState('balanced');
  const [outfit, setOutfit] = useState('street');
  const [colors, setColors] = useState('#315a9c, #e8b35d, #f4f0dc');
  const [generationMode, setGenerationMode] = useState<'sheets' | 'individual'>('sheets');
  const [runId, setRunId] = useState(initialRun);
  const [events, setEvents] = useState<FighterPoseLabEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [imageCalls, setImageCalls] = useState(0);
  const [judgeCalls, setJudgeCalls] = useState(0);
  const [imageCost, setImageCost] = useState(0);
  const [judgeCost, setJudgeCost] = useState<number | null>(null);
  const [identityDecision, setIdentityDecision] =
    useState<Awaited<ReturnType<typeof api.fighterPoseLabStatus>>['identityDecision']>();
  const [poseDecision, setPoseDecision] = useState<FighterPoseJudgeDecision>();
  const [previewIndex, setPreviewIndex] = useState(0);
  const [notes, setNotes] = useState('');
  const [humanVerdict, setHumanVerdict] = useState<{ accepted: boolean; notes: string } | null>(
    null,
  );
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.documentElement.classList.add('dev-gallery');
    document.body.classList.add('dev-gallery');
    return () => {
      document.documentElement.classList.remove('dev-gallery');
      document.body.classList.remove('dev-gallery');
    };
  }, []);

  useEffect(() => {
    if (!file) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!runId) return;
    let disposed = false;
    void api
      .fighterPoseLabStatus(runId)
      .then((status) => {
        if (disposed) return;
        setEvents(status.events);
        setRunning(status.status === 'running');
        setImageCalls(status.imageCalls);
        setJudgeCalls(status.judgeCalls);
        setImageCost(status.imageCostUsd);
        setJudgeCost(status.judgeCostUsd);
        setGenerationMode(status.generationMode);
        setIdentityDecision(status.identityDecision);
        setPoseDecision(status.poseDecision);
        if (status.humanVerdict) setHumanVerdict(status.humanVerdict);
        if (status.error) setError(status.error);
      })
      .catch(
        (reason) =>
          !disposed && setError(reason instanceof Error ? reason.message : String(reason)),
      );
    const unsubscribe = subscribeFighterPoseLab(
      runId,
      (event) => {
        if (disposed) return;
        setEvents((current) =>
          current.some(({ seq }) => seq === event.seq)
            ? current
            : [...current, event].sort((a, b) => a.seq - b.seq),
        );
        if (event.type === 'done' || event.type === 'failed') {
          setRunning(false);
          void api.fighterPoseLabStatus(runId).then((status) => {
            setImageCalls(status.imageCalls);
            setJudgeCalls(status.judgeCalls);
            setImageCost(status.imageCostUsd);
            setJudgeCost(status.judgeCostUsd);
            setGenerationMode(status.generationMode);
            setIdentityDecision(status.identityDecision);
            setPoseDecision(status.poseDecision);
          });
        }
      },
      () => {},
    );
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [runId]);

  const assets = useMemo(() => {
    const map = new Map<string, AssetView>();
    for (const event of events) {
      const asset = assetFrom(event);
      if (asset) map.set(asset.id, { ...map.get(asset.id), ...asset });
    }
    return map;
  }, [events]);
  const foundationAssets = [...assets.values()].filter((asset) => /^I\d+$/.test(asset.id));
  const sheetAssets = [...assets.values()].filter(
    (asset) => asset.id === 'pose-sheet-seed' || /^sheet-(mobility|attacks)$/.test(asset.id),
  );
  const poseAssets = [...assets.values()].filter((asset) => asset.pose && !/^I\d+$/.test(asset.id));
  const selectedFoundation = stringValue(
    latest(events, (event) => event.type === 'selection' && event.stage === 'identity-judge')?.data
      ?.selectedId,
  );
  const atlasSelection = latest(
    events,
    (event) => event.type === 'selection' && event.stage === 'atlas',
  );
  const selectedIds =
    atlasSelection?.data?.selectedIds && typeof atlasSelection.data.selectedIds === 'object'
      ? (atlasSelection.data.selectedIds as Record<string, string>)
      : {};
  const selectedPoseUrls = Object.fromEntries(
    POSES.map((pose) => {
      if (pose === 'idle')
        return [
          pose,
          assets.get(`${selectedFoundation}-processed`)?.processedUrl ??
            assets.get(selectedFoundation ?? '')?.processedUrl,
        ];
      const id = selectedIds[pose];
      return [pose, id ? assets.get(id)?.processedUrl : undefined];
    }),
  ) as Record<FighterPoseName, string | undefined>;
  const availablePreview = POSES.filter((pose) => selectedPoseUrls[pose]);
  useEffect(() => {
    if (availablePreview.length === 0) return;
    const timer = setInterval(() => setPreviewIndex((index) => index + 1), 420);
    return () => clearInterval(timer);
  }, [availablePreview.join('|')]);
  const previewPose = availablePreview[previewIndex % Math.max(1, availablePreview.length)];

  const stageStatus = (stage: FighterPoseLabStage) => {
    const relevant = events.filter((event) => event.stage === stage);
    if (relevant.some((event) => event.status === 'failed')) return 'failed';
    if (relevant.some((event) => event.status === 'complete')) return 'complete';
    if (relevant.some((event) => event.status === 'rejected')) return 'rejected';
    if (relevant.some((event) => event.status === 'started')) return 'active';
    return '';
  };

  const start = async () => {
    if (!file || running) return;
    setError('');
    setEvents([]);
    setIdentityDecision(undefined);
    setPoseDecision(undefined);
    setHumanVerdict(null);
    setRunning(true);
    try {
      const started = await api.startFighterPoseLab({
        photo: file,
        name,
        visualConcept,
        build,
        outfit,
        colors,
        generationMode,
      });
      setRunId(started.runId);
      const params = new URLSearchParams(location.search);
      params.set('dev', 'fighter-poses');
      params.set('run', started.runId);
      history.replaceState(null, '', `${location.pathname}?${params}`);
    } catch (reason) {
      setRunning(false);
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const saveVerdict = async (accepted: boolean) => {
    if (!runId) return;
    try {
      const response = await api.saveFighterPoseHumanVerdict(runId, { accepted, notes });
      setHumanVerdict(response.humanVerdict);
      const status = await api.fighterPoseLabStatus(runId);
      setEvents(status.events);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <main class="ppl-page fpl-page">
      <header class="ppl-header">
        <div>
          <h1>Fighter Poses Lab</h1>
          <p>
            Photo identity → 3 foundations → two six-pose sheets → local split → Spark review →
            targeted repairs → 13-state atlas
          </p>
        </div>
        <nav>
          <a href="/?dev=platformer-poses">Platformer poses</a>
          <a href="/?dev=assets">Asset gallery</a>
          <a href="/">Kiosk</a>
        </nav>
      </header>

      <section class="ppl-intro">
        <div class="ppl-form fpl-form">
          <div class="ppl-photo-picker">
            {preview ? <img src={preview} alt="Fighter source" /> : <span>PHOTO REQUIRED</span>}
            <button type="button" onClick={() => fileInput.current?.click()} disabled={running}>
              Choose photo
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) =>
                setFile((event.currentTarget as HTMLInputElement).files?.[0] ?? null)
              }
            />
          </div>
          <label>
            Fighter name
            <input value={name} onInput={(event) => setName(event.currentTarget.value)} />
          </label>
          <label>
            Visual concept
            <textarea
              value={visualConcept}
              onInput={(event) => setVisualConcept(event.currentTarget.value)}
            />
          </label>
          <div class="fpl-selects">
            <label>
              Build
              <select value={build} onChange={(event) => setBuild(event.currentTarget.value)}>
                <option value="nimble">Nimble</option>
                <option value="balanced">Balanced</option>
                <option value="heavy">Heavy</option>
              </select>
            </label>
            <label>
              Outfit
              <select value={outfit} onChange={(event) => setOutfit(event.currentTarget.value)}>
                {['gi', 'boxer', 'wrestler', 'street', 'robe', 'armor'].map((value) => (
                  <option value={value}>{value}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Costume colors
            <input value={colors} onInput={(event) => setColors(event.currentTarget.value)} />
          </label>
          <label>
            Pose generation
            <select
              value={generationMode}
              onChange={(event) =>
                setGenerationMode(event.currentTarget.value as 'sheets' | 'individual')
              }
              disabled={running}
            >
              <option value="sheets">2 × 6-state sheets (recommended)</option>
              <option value="individual">12 isolated calls (comparison baseline)</option>
            </select>
          </label>
          <button class="ppl-run" type="button" onClick={start} disabled={!file || running}>
            {running ? 'Generating fighter…' : 'Run Fighter pose experiment'}
          </button>
          <p class="ppl-cost-note">
            {generationMode === 'sheets'
              ? 'Happy path: 5 image edits (3 identity candidates + 2 pose sheets) and 2 Spark reviews. Invalid cells get up to two isolated recovery attempts; a rejected set adds at most 8 targeted image edits and one review.'
              : 'Comparison baseline: 15 image edits (3 identity candidates + 12 isolated poses) and 2 Spark reviews. A rejected set adds at most 8 targeted image edits and one review.'}
            {runId && (
              <>
                {' '}
                Run <code>{runId}</code> · {imageCalls} images · {judgeCalls} reviews · $
                {imageCost.toFixed(2)} image cost ·{' '}
                {judgeCost === null
                  ? 'judge cost unavailable'
                  : `$${judgeCost.toFixed(3)} judge cost`}
              </>
            )}
          </p>
        </div>
        <div class="ppl-timeline" aria-label="Fighter pose pipeline progress">
          {STAGES.map((stage, index) => (
            <div class={`ppl-stage ${stageStatus(stage.id)}`}>
              <span class="ppl-stage-index">{index + 1}</span>
              <div>
                <strong>{stage.label}</strong>
                <small>{stage.note}</small>
              </div>
              <em>{stageStatus(stage.id) || 'waiting'}</em>
            </div>
          ))}
        </div>
      </section>

      {error && <div class="ppl-error">{error}</div>}

      {foundationAssets.length > 0 && (
        <section class="ppl-section">
          <div class="ppl-section-heading">
            <div>
              <h2>Identity foundations</h2>
              <p>
                Spark compares the raw seeds and normalized runtime silhouettes directly with the
                source photo.
              </p>
            </div>
            <span>{selectedFoundation ? `${selectedFoundation} selected` : 'reviewing'}</span>
          </div>
          <div class="ppl-candidate-grid">
            {foundationAssets.map((asset) => {
              const review = identityDecision?.candidateReviews.find(({ id }) => id === asset.id);
              return (
                <article
                  class={`ppl-candidate ${selectedFoundation === asset.id ? 'selected' : ''}`}
                >
                  <header>
                    <div>
                      <strong>{asset.id}</strong>
                      <span>identity foundation</span>
                    </div>
                    <em>{selectedFoundation === asset.id ? 'SELECTED' : asset.status}</em>
                  </header>
                  <div class="ppl-sprite-stage">
                    {asset.processedUrl && (
                      <img
                        class="ppl-sprite fpl-sprite"
                        src={asset.processedUrl}
                        alt={asset.label}
                      />
                    )}
                  </div>
                  {review && (
                    <>
                      <div class="ppl-scores">
                        <Score label="ID" value={review.scores.identity} />
                        <Score label="CON" value={review.scores.concept} />
                        <Score label="COST" value={review.scores.costume} />
                        <Score label="SIL" value={review.scores.silhouette} />
                        <Score label="TECH" value={review.scores.technical} />
                      </div>
                      <p class="ppl-review-summary">{review.summary}</p>
                    </>
                  )}
                  {asset.rawUrl && (
                    <details class="ppl-raw">
                      <summary>High-resolution seed</summary>
                      <img src={asset.rawUrl} alt={`${asset.id} raw`} />
                    </details>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {sheetAssets.length > 0 && (
        <section class="ppl-section">
          <div class="ppl-section-heading">
            <div>
              <h2>Pose sheet evidence</h2>
              <p>
                Muse returns six poses in fixed row-major order; full-sheet foreground components
                retain ownership across a bounded cell-edge tolerance.
              </p>
            </div>
            <span>component-owned split</span>
          </div>
          <div class="fpl-sheet-grid">
            {sheetAssets.map((asset) => (
              <article class="ppl-candidate fpl-sheet-card">
                <header>
                  <div>
                    <strong>{asset.label}</strong>
                    <span>{asset.id === 'pose-sheet-seed' ? 'edit seed' : 'raw Muse output'}</span>
                  </div>
                  <em>{asset.status}</em>
                </header>
                {(asset.rawUrl || asset.processedUrl) && (
                  <img
                    class="fpl-sheet-image"
                    src={asset.rawUrl ?? asset.processedUrl}
                    alt={asset.label}
                  />
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {poseAssets.length > 0 && (
        <section class="ppl-section">
          <div class="ppl-section-heading">
            <div>
              <h2>Combat pose candidates</h2>
              <p>
                {generationMode === 'sheets'
                  ? 'Locally split S candidates, isolated repairs for invalid cells, and only the B/C alternatives requested by Spark.'
                  : 'Initial A candidates plus only the B/C alternatives requested by Spark.'}
              </p>
            </div>
            <span>{poseAssets.length} locally valid</span>
          </div>
          <div class="fpl-pose-grid">
            {poseAssets.map((asset) => {
              const review = poseDecision?.candidateReviews.find(({ id }) => id === asset.id);
              const selected = asset.pose ? selectedIds[asset.pose] === asset.id : false;
              return (
                <article class={`ppl-candidate ${selected ? 'selected' : ''}`}>
                  <header>
                    <div>
                      <strong>{asset.id}</strong>
                      <span>
                        {asset.pose}
                        {asset.discardedComponentCount
                          ? ` · ${asset.discardedComponentCount} leak${asset.discardedComponentCount === 1 ? '' : 's'} removed`
                          : ''}
                        {asset.reclaimedBleedPixels
                          ? ` · ${asset.reclaimedBleedPixels}px reclaimed`
                          : ''}
                        {asset.excludedNeighborPixels
                          ? ` · ${asset.excludedNeighborPixels}px reassigned`
                          : ''}
                      </span>
                    </div>
                    <em>{selected ? 'SELECTED' : asset.status}</em>
                  </header>
                  <div class="ppl-sprite-stage fpl-small-stage">
                    {asset.processedUrl && (
                      <img
                        class="ppl-sprite fpl-sprite"
                        src={asset.processedUrl}
                        alt={asset.label}
                      />
                    )}
                  </div>
                  {review && (
                    <>
                      <div class="ppl-scores">
                        <Score label="ID" value={review.scores.identity} />
                        <Score label="COST" value={review.scores.costume} />
                        <Score label="POSE" value={review.scores.pose} />
                        <Score label="TECH" value={review.scores.technical} />
                      </div>
                      <p class="ppl-review-summary">{review.summary}</p>
                    </>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {assets.get('atlas')?.processedUrl && (
        <section class="ppl-section ppl-judge-section">
          <div class="ppl-section-heading">
            <div>
              <h2>Final runtime atlas</h2>
              <p>
                Stable 4×4 layout, thirteen populated 96px cells, loaded atomically by gameplay.
              </p>
            </div>
            <span>
              {poseDecision?.setReview.accepted ? 'Spark accepted' : 'best bounded result'}
            </span>
          </div>
          <div class="fpl-result">
            <div>
              <img
                class="fpl-atlas"
                src={assets.get('atlas')!.processedUrl}
                alt="Final fighter atlas"
              />
            </div>
            <div class="ppl-animation fpl-animation">
              {previewPose && selectedPoseUrls[previewPose] && (
                <img
                  class="ppl-sprite fpl-sprite"
                  src={selectedPoseUrls[previewPose]}
                  alt={previewPose}
                />
              )}
              <strong>{previewPose}</strong>
            </div>
            {poseDecision && (
              <div class="fpl-set-review">
                <div class="ppl-scores">
                  <Score label="ID SET" value={poseDecision.setReview.identityConsistency} />
                  <Score label="COSTUME" value={poseDecision.setReview.costumeConsistency} />
                  <Score label="SCALE" value={poseDecision.setReview.scaleConsistency} />
                  <Score label="POSES" value={poseDecision.setReview.poseReadability} />
                </div>
                <p>{poseDecision.setReview.summary}</p>
                <label>
                  Human notes
                  <textarea
                    value={notes}
                    onInput={(event) => setNotes(event.currentTarget.value)}
                  />
                </label>
                <div class="ppl-human-actions">
                  <button onClick={() => saveVerdict(true)}>Approve atlas</button>
                  <button class="danger" onClick={() => saveVerdict(false)}>
                    Reject atlas
                  </button>
                </div>
                {humanVerdict && (
                  <p class={humanVerdict.accepted ? 'good' : 'bad'}>
                    Saved: {humanVerdict.accepted ? 'approved' : 'rejected'}.
                  </p>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {events.length > 0 && (
        <section class="ppl-section ppl-log-section">
          <div class="ppl-section-heading">
            <div>
              <h2>Experiment log</h2>
              <p>
                Every prompt, asset, judge response, selection, retry, and verdict is persisted.
              </p>
            </div>
            <span>{events.length} events</span>
          </div>
          <ol class="ppl-log">
            {events.map((event) => (
              <li class={event.status}>
                <time>{new Date(event.at).toLocaleTimeString()}</time>
                <strong>{event.stage}</strong>
                <span>{event.message}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
