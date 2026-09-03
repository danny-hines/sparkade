// Dev-only, paid-call Platformer Poses Lab
// (http://localhost:5173/?dev=platformer-poses). It exposes every stage of the
// experimental Muse Image -> Muse Spark semantic-selection pipeline in real time.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import {
  api,
  subscribePlatformerPoseLab,
  type PlatformerIdleCandidateReview,
  type PlatformerIdleJudgeDecision,
  type PlatformerPoseCandidateReview,
  type PlatformerPoseHumanVerdict,
  type PlatformerPoseJudgeDecision,
  type PlatformerPoseLabEvent,
  type PlatformerPosePairReview,
  type PlatformerPoseLabStage,
} from '../api';

interface AssetView {
  id: string;
  kind: string;
  label: string;
  status: PlatformerPoseLabEvent['status'];
  rawUrl?: string;
  recoveredUrl?: string;
  processedUrl?: string;
  error?: string;
  metrics?: Record<string, unknown>;
  elapsedMs?: number;
}

const STAGES: Array<{ id: PlatformerPoseLabStage; label: string; note: string }> = [
  { id: 'source', label: 'Source', note: 'normalize locally' },
  { id: 'idle', label: '3 front idles', note: 'parallel foundations' },
  { id: 'idle-judge', label: 'Identity judge', note: 'likeness + eyewear gate' },
  { id: 'side-anchor', label: 'Side anchor', note: 'one shared reference' },
  { id: 'candidates', label: '6 candidates', note: '3 Phase A + 3 Phase B' },
  { id: 'judge', label: 'Spark judge', note: 'score + pair selection' },
  { id: 'complete', label: 'Result', note: 'animate or reject all' },
];

export type PlatformerPosePreviewDurations = [number, number, number, number];
export interface PlatformerPosePreviewStep {
  id: string;
  blendFromId?: string;
  durationMs: number;
}

const DEFAULT_PREVIEW_DURATIONS: PlatformerPosePreviewDurations = [140, 70, 140, 70];
export const PLATFORMER_POSE_DISSOLVE_DURATION_MS = 1000 / 60;
const PREVIEW_TIMING_LABELS = ['Phase A', 'Idle after A', 'Phase B', 'Idle after B'] as const;

/** A neutral side silhouette separates the two contacts so subtle foreground
 * limb swaps read as a stride instead of a one-pixel wiggle. */
export function platformerPosePreviewSequence(
  phaseAId: string,
  phaseBId: string,
  hasSideIdle: boolean,
): string[] {
  if (!phaseAId || !phaseBId) return [];
  return hasSideIdle ? [phaseAId, 'side-anchor', phaseBId, 'side-anchor'] : [phaseAId, phaseBId];
}

export function platformerPosePreviewFrameDuration(
  frameIndex: number,
  sequenceLength: number,
  durations: PlatformerPosePreviewDurations,
): number {
  const durationIndex = sequenceLength === 4 ? frameIndex % 4 : frameIndex % 2 === 0 ? 0 : 2;
  return durations[durationIndex]!;
}

/** Match the runtime's one-tick side-idle/contact dissolve while preserving
 * each user-selected beat's total duration. */
export function platformerPosePreviewTimeline(
  sequence: readonly string[],
  durations: PlatformerPosePreviewDurations,
  dissolve: boolean,
  dissolveFrames = 1,
): PlatformerPosePreviewStep[] {
  return sequence.flatMap((id, index) => {
    const durationMs = platformerPosePreviewFrameDuration(index, sequence.length, durations);
    const blendFromId = sequence[(index + sequence.length - 1) % sequence.length];
    const eligible =
      dissolve &&
      sequence.length === 4 &&
      blendFromId !== id &&
      (blendFromId === 'side-anchor' || id === 'side-anchor');
    if (!eligible) return [{ id, durationMs }];
    const dissolveDurationMs = Math.min(
      durationMs,
      PLATFORMER_POSE_DISSOLVE_DURATION_MS * Math.max(1, Math.min(3, dissolveFrames)),
    );
    const remainingDurationMs = durationMs - dissolveDurationMs;
    const steps: PlatformerPosePreviewStep[] = [
      { id, blendFromId, durationMs: dissolveDurationMs },
    ];
    if (remainingDurationMs > 0) steps.push({ id, durationMs: remainingDurationMs });
    return steps;
  });
}

function previewPoseLabel(id: string | undefined): string {
  return id === 'side-anchor' ? 'SIDE IDLE' : (id ?? '');
}

function previewFrameLabel(step: PlatformerPosePreviewStep | undefined): string {
  if (!step) return '';
  return step.blendFromId
    ? `DISSOLVE · ${previewPoseLabel(step.blendFromId)} + ${previewPoseLabel(step.id)}`
    : previewPoseLabel(step.id);
}

function PreviewSprite(props: {
  asset: AssetView;
  blendFrom?: AssetView;
  label: string;
}): ComponentChildren {
  if (!props.blendFrom?.processedUrl) {
    return <img class="ppl-sprite" src={props.asset.processedUrl} alt={props.label} />;
  }
  return (
    <div class="ppl-dissolve-frame" role="img" aria-label={props.label}>
      <img class="ppl-sprite" src={props.blendFrom.processedUrl} alt="" />
      <img class="ppl-sprite" src={props.asset.processedUrl} alt="" />
    </div>
  );
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function decisionFrom(
  event: PlatformerPoseLabEvent | undefined,
): PlatformerPoseJudgeDecision | null {
  const decision = event?.data?.decision;
  return decision && typeof decision === 'object'
    ? (decision as unknown as PlatformerPoseJudgeDecision)
    : null;
}

function idleDecisionFrom(
  event: PlatformerPoseLabEvent | undefined,
): PlatformerIdleJudgeDecision | null {
  const decision = event?.data?.decision;
  return decision && typeof decision === 'object'
    ? (decision as unknown as PlatformerIdleJudgeDecision)
    : null;
}

function humanVerdictFrom(
  event: PlatformerPoseLabEvent | undefined,
): PlatformerPoseHumanVerdict | null {
  const verdict = event?.data?.humanVerdict;
  return verdict && typeof verdict === 'object'
    ? (verdict as unknown as PlatformerPoseHumanVerdict)
    : null;
}

function assetFrom(event: PlatformerPoseLabEvent): AssetView | null {
  if (event.type !== 'asset') return null;
  const id = stringValue(event.data?.id);
  if (!id) return null;
  return {
    id,
    kind: stringValue(event.data?.kind) ?? id,
    label: stringValue(event.data?.label) ?? id,
    status: event.status,
    rawUrl: stringValue(event.data?.rawUrl),
    recoveredUrl: stringValue(event.data?.recoveredUrl),
    processedUrl: stringValue(event.data?.processedUrl),
    error: stringValue(event.data?.error),
    metrics:
      event.data?.metrics && typeof event.data.metrics === 'object'
        ? (event.data.metrics as Record<string, unknown>)
        : undefined,
    elapsedMs: event.elapsedMs,
  };
}

function formatTime(ms: number | undefined): string {
  if (ms === undefined) return '';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function scoreClass(score: number): string {
  return score >= 4 ? 'good' : score >= 3 ? 'warn' : 'bad';
}

function latestEvent(
  events: readonly PlatformerPoseLabEvent[],
  predicate: (event: PlatformerPoseLabEvent) => boolean,
): PlatformerPoseLabEvent | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]!;
    if (predicate(event)) return event;
  }
  return undefined;
}

function ScorePips(props: { label: string; value: number }): ComponentChildren {
  return (
    <span class={`ppl-score ${scoreClass(props.value)}`} title={`${props.label}: ${props.value}/5`}>
      <span>{props.label}</span>
      <b>{props.value}/5</b>
    </span>
  );
}

function PromptDisclosure(props: { title: string; prompt?: string }): ComponentChildren {
  if (!props.prompt) return null;
  return (
    <details class="ppl-prompt">
      <summary>{props.title}</summary>
      <pre>{props.prompt}</pre>
    </details>
  );
}

function CandidateCard(props: {
  asset: AssetView;
  review?: PlatformerPoseCandidateReview;
  selected: boolean;
  prompt?: string;
}): ComponentChildren {
  const bounds = props.asset.metrics?.outputBounds as Record<string, unknown> | undefined;
  const width = numberValue(bounds?.width);
  const height = numberValue(bounds?.height);
  return (
    <article
      class={`ppl-candidate ${props.asset.status === 'rejected' ? 'rejected' : ''}${props.selected ? ' selected' : ''}`}
    >
      <header>
        <div>
          <strong>{props.asset.id}</strong>
          <span>{props.asset.kind}</span>
        </div>
        <em>{props.selected ? 'SELECTED' : props.asset.status.toUpperCase()}</em>
      </header>
      <div class="ppl-sprite-stage">
        {props.asset.processedUrl ? (
          <img
            class="ppl-sprite"
            src={props.asset.processedUrl}
            alt={`${props.asset.label} processed sprite`}
          />
        ) : props.asset.rawUrl ? (
          <img
            class="ppl-raw-fallback"
            src={props.asset.rawUrl}
            alt={`${props.asset.label} raw output`}
          />
        ) : (
          <span>waiting…</span>
        )}
      </div>
      {props.review && (
        <>
          <div class="ppl-scores">
            <ScorePips label="ID" value={props.review.scores.identity} />
            <ScorePips label="COST" value={props.review.scores.costume} />
            <ScorePips label="POSE" value={props.review.scores.pose} />
            <ScorePips label="TECH" value={props.review.scores.technical} />
          </div>
          <p class="ppl-review-summary">{props.review.summary}</p>
          {props.review.fatalIssues.length > 0 && (
            <ul class="ppl-fatals">
              {props.review.fatalIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
        </>
      )}
      {props.asset.error && <p class="ppl-asset-error">{props.asset.error}</p>}
      <footer>
        <span>{width && height ? `${width}×${height}px subject` : 'local check pending'}</span>
        <span>{formatTime(props.asset.elapsedMs)}</span>
      </footer>
      <PromptDisclosure title="Exact Muse Image prompt" prompt={props.prompt} />
      {props.asset.rawUrl && (
        <details class="ppl-raw">
          <summary>Raw Muse Image output</summary>
          <img src={props.asset.rawUrl} alt={`${props.asset.label} raw Muse Image output`} />
        </details>
      )}
    </article>
  );
}

function IdleCandidateCard(props: {
  asset: AssetView;
  review?: PlatformerIdleCandidateReview;
  selected: boolean;
  prompt?: string;
}): ComponentChildren {
  const bounds = props.asset.metrics?.outputBounds as Record<string, unknown> | undefined;
  const width = numberValue(bounds?.width);
  const height = numberValue(bounds?.height);
  return (
    <article
      class={
        'ppl-candidate ppl-idle-candidate' +
        (props.asset.status === 'rejected' ? ' rejected' : '') +
        (props.selected ? ' selected' : '')
      }
    >
      <header>
        <div>
          <strong>{props.asset.id}</strong>
          <span>front-idle foundation</span>
        </div>
        <em>{props.selected ? 'FOUNDATION' : props.asset.status.toUpperCase()}</em>
      </header>
      <div class="ppl-sprite-stage">
        {props.asset.processedUrl ? (
          <img
            class="ppl-sprite"
            src={props.asset.processedUrl}
            alt={props.asset.label + ' processed sprite'}
          />
        ) : props.asset.rawUrl ? (
          <img
            class="ppl-raw-fallback"
            src={props.asset.rawUrl}
            alt={props.asset.label + ' rejected raw output'}
          />
        ) : (
          <span>waiting…</span>
        )}
      </div>
      {props.asset.recoveredUrl && (
        <p class="ppl-recovery-note">Recovered a symmetric inset green panel before validation.</p>
      )}
      {props.review && (
        <>
          <div class="ppl-idle-eyewear">
            <span>Eyewear: {props.review.eyewear}</span>
            <em class={props.review.eyewearMatch ? 'good' : 'bad'}>
              {props.review.eyewearMatch ? 'matches source' : 'mismatch'}
            </em>
          </div>
          <div class="ppl-scores ppl-idle-scores">
            <ScorePips label="ID" value={props.review.scores.identity} />
            <ScorePips label="FACE" value={props.review.scores.faceAndHair} />
            <ScorePips label="ACC" value={props.review.scores.accessories} />
            <ScorePips label="COST" value={props.review.scores.costume} />
            <ScorePips label="BODY" value={props.review.scores.proportions} />
            <ScorePips label="POSE" value={props.review.scores.pose} />
            <ScorePips label="TECH" value={props.review.scores.technical} />
          </div>
          <p class="ppl-review-summary">{props.review.summary}</p>
          {props.review.fatalIssues.length > 0 && (
            <ul class="ppl-fatals">
              {props.review.fatalIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
        </>
      )}
      {props.asset.error && <p class="ppl-asset-error">{props.asset.error}</p>}
      <footer>
        <span>{width && height ? width + '×' + height + 'px subject' : 'local check pending'}</span>
        <span>{formatTime(props.asset.elapsedMs)}</span>
      </footer>
      <PromptDisclosure title="Exact Muse Image prompt" prompt={props.prompt} />
      {props.asset.rawUrl && (
        <details class="ppl-raw">
          <summary>Raw Muse Image output</summary>
          <img src={props.asset.rawUrl} alt={props.asset.label + ' raw Muse Image output'} />
        </details>
      )}
      {props.asset.recoveredUrl && (
        <details class="ppl-raw">
          <summary>Recovered high-resolution edit seed</summary>
          <img src={props.asset.recoveredUrl} alt={props.asset.label + ' recovered edit seed'} />
        </details>
      )}
    </article>
  );
}

function PairReviewCard(props: {
  review: PlatformerPosePairReview;
  selected: boolean;
}): ComponentChildren {
  return (
    <article class={`ppl-pair-review${props.selected ? ' selected' : ''}`}>
      <header>
        <strong>
          {props.review.phaseAId} + {props.review.phaseBId}
        </strong>
        {props.selected && <em>SPARK PICK</em>}
      </header>
      <div class="ppl-scores">
        <ScorePips label="LEGS" value={props.review.legAlternation} />
        <ScorePips label="ARMS" value={props.review.armAlternation} />
        <ScorePips label="PAIR" value={props.review.pairConsistency} />
      </div>
      <p>{props.review.summary}</p>
      {props.review.fatalIssues.length > 0 && (
        <ul class="ppl-fatals">
          {props.review.fatalIssues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
    </article>
  );
}

function FoundationCard(props: {
  asset?: AssetView;
  title: string;
  note: string;
  prompt?: string;
}): ComponentChildren {
  return (
    <article class="ppl-foundation">
      <header>
        <strong>{props.title}</strong>
        <span>{props.asset?.status ?? 'waiting'}</span>
      </header>
      <div class="ppl-foundation-image">
        {props.asset?.processedUrl ? (
          <img
            class={props.asset.id === 'source' ? 'ppl-source' : 'ppl-sprite'}
            src={props.asset.processedUrl}
            alt={props.title}
          />
        ) : (
          <span>—</span>
        )}
      </div>
      <p>{props.note}</p>
      <PromptDisclosure title="Exact Muse Image prompt" prompt={props.prompt} />
      {props.asset?.rawUrl && (
        <details class="ppl-raw">
          <summary>Raw Muse output</summary>
          <img src={props.asset.rawUrl} alt={`${props.title} raw Muse output`} />
        </details>
      )}
    </article>
  );
}

function stageStatus(
  stage: PlatformerPoseLabStage,
  events: readonly PlatformerPoseLabEvent[],
): 'waiting' | 'active' | 'complete' | 'rejected' | 'failed' {
  const matching = events.filter((event) => event.stage === stage);
  if (matching.some((event) => event.status === 'failed')) return 'failed';
  if (stage === 'idle' || stage === 'candidates') {
    const aggregate = latestEvent(
      matching,
      (event) =>
        event.type === 'stage' && (event.status === 'complete' || event.status === 'rejected'),
    );
    if (aggregate) return aggregate.status === 'rejected' ? 'rejected' : 'complete';
    return matching.some((event) => event.status === 'started') ? 'active' : 'waiting';
  }
  if (stage === 'idle-judge' && matching.some((event) => event.type === 'idle-selection')) {
    return latestEvent(matching, (event) => event.type === 'idle-selection')?.status === 'rejected'
      ? 'rejected'
      : 'complete';
  }
  if (stage === 'idle-judge') return matching.length > 0 ? 'active' : 'waiting';
  if (stage === 'judge' && matching.some((event) => event.type === 'selection')) {
    return latestEvent(matching, (event) => event.type === 'selection')?.status === 'rejected'
      ? 'rejected'
      : 'complete';
  }
  if (stage === 'judge') return matching.length > 0 ? 'active' : 'waiting';
  if (stage === 'complete') {
    if (matching.some((event) => event.type === 'failed')) return 'failed';
    if (matching.some((event) => event.type === 'done')) return 'complete';
  }
  if (
    matching.some(
      (event) =>
        event.status === 'complete' &&
        (event.type === 'asset' ||
          event.type === 'stage' ||
          event.type === 'idle-judge-response' ||
          event.type === 'judge-response'),
    )
  ) {
    return 'complete';
  }
  return matching.some((event) => event.status === 'started') ? 'active' : 'waiting';
}

export function PlatformerPosesLabScreen(): ComponentChildren {
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [heroConcept, setHeroConcept] = useState('');
  const [colors, setColors] = useState('');
  const [runId, setRunId] = useState<string | null>(() => {
    const restored = new URLSearchParams(window.location.search).get('run');
    return restored || null;
  });
  const [events, setEvents] = useState<PlatformerPoseLabEvent[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const [previewDurations, setPreviewDurations] = useState<PlatformerPosePreviewDurations>([
    ...DEFAULT_PREVIEW_DURATIONS,
  ]);
  const [dissolvePreview, setDissolvePreview] = useState(true);
  const [dissolveFrames, setDissolveFrames] = useState<1 | 2 | 3>(3);
  const [humanPhaseA, setHumanPhaseA] = useState('');
  const [humanPhaseB, setHumanPhaseB] = useState('');
  const [humanNotes, setHumanNotes] = useState('');
  const [savingHuman, setSavingHuman] = useState(false);
  const [humanError, setHumanError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const terminalRef = useRef(false);
  const loadedHumanVerdictRef = useRef('');

  useEffect(() => {
    document.documentElement.classList.add('dev-gallery');
    document.body.classList.add('dev-gallery');
    return () => {
      document.documentElement.classList.remove('dev-gallery');
      document.body.classList.remove('dev-gallery');
    };
  }, []);

  useEffect(
    () => () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    },
    [photoPreview],
  );

  useEffect(() => {
    if (!runId) return;
    terminalRef.current = false;
    let cancelled = false;
    let unsubscribe = () => {};
    void api
      .platformerPoseLabStatus(runId)
      .then((status) => {
        if (cancelled) return;
        setEvents(status.events);
        if (status.status !== 'running') {
          terminalRef.current = true;
          if (status.status === 'failed') setError(status.error ?? 'Pose lab run failed');
          return;
        }
        unsubscribe = subscribePlatformerPoseLab(
          runId,
          (event) => {
            setEvents((current) =>
              current.some(({ seq }) => seq === event.seq)
                ? current
                : [...current, event].sort((a, b) => a.seq - b.seq),
            );
            if (event.type === 'done' || event.type === 'failed') {
              terminalRef.current = true;
              unsubscribe();
            }
          },
          () => {
            if (!terminalRef.current) setError('Lost the live pose-lab connection');
          },
        );
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the requested pose-lab run');
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [runId]);

  const selectionEvent = latestEvent(events, (event) => event.type === 'selection');
  const decision = decisionFrom(selectionEvent);
  const idleSelectionEvent = latestEvent(events, (event) => event.type === 'idle-selection');
  const idleDecision = idleDecisionFrom(idleSelectionEvent);
  const selectedIdleId = idleDecision?.selection.accepted
    ? idleDecision.selection.candidateId
    : events.some((event) => event.type === 'asset' && event.data?.id === 'idle')
      ? 'idle'
      : '';
  const selectedPhaseA = decision?.selection.accepted ? decision.selection.phaseAId : '';
  const selectedPhaseB = decision?.selection.accepted ? decision.selection.phaseBId : '';
  const humanVerdictEvent = latestEvent(events, (event) => event.type === 'human-verdict');
  const humanVerdict = humanVerdictFrom(humanVerdictEvent);

  const assets = useMemo(() => {
    const map = new Map<string, AssetView>();
    for (const event of events) {
      const asset = assetFrom(event);
      if (asset) map.set(asset.id, asset);
    }
    return map;
  }, [events]);
  const phaseAAssets = [...assets.values()]
    .filter(({ kind }) => kind === 'phase-a')
    .sort((a, b) => a.id.localeCompare(b.id));
  const phaseBAssets = [...assets.values()]
    .filter(({ kind }) => kind === 'phase-b')
    .sort((a, b) => a.id.localeCompare(b.id));
  const idleAssets = [...assets.values()]
    .filter(({ kind, id }) => kind === 'idle' && /^I\d+$/.test(id))
    .sort((a, b) => a.id.localeCompare(b.id));
  const phaseAIds = phaseAAssets.map(({ id }) => id).join(',');
  const phaseBIds = phaseBAssets.map(({ id }) => id).join(',');
  useEffect(() => {
    if (humanVerdict && loadedHumanVerdictRef.current !== humanVerdict.at) {
      setHumanPhaseA(humanVerdict.phaseAId);
      setHumanPhaseB(humanVerdict.phaseBId);
      setHumanNotes(humanVerdict.notes);
      loadedHumanVerdictRef.current = humanVerdict.at;
      return;
    }
    if (!humanPhaseA && phaseAAssets.length) {
      setHumanPhaseA(selectedPhaseA || phaseAAssets[0]!.id);
    }
    if (!humanPhaseB && phaseBAssets.length) {
      setHumanPhaseB(selectedPhaseB || phaseBAssets[0]!.id);
    }
  }, [
    humanPhaseA,
    humanPhaseB,
    humanVerdict,
    phaseAIds,
    phaseBIds,
    selectedPhaseA,
    selectedPhaseB,
  ]);
  const prompts = useMemo(() => {
    const map = new Map<string, string>();
    for (const event of events) {
      const id = stringValue(event.data?.id);
      const prompt = stringValue(event.data?.prompt);
      if (id && prompt) map.set(id, prompt);
    }
    return map;
  }, [events]);
  const reviews = new Map(decision?.candidateReviews.map((review) => [review.id, review]) ?? []);
  const idleReviews = new Map<string, PlatformerIdleCandidateReview>();
  for (const event of events) {
    if (event.type !== 'idle-selection') continue;
    for (const review of idleDecisionFrom(event)?.candidateReviews ?? []) {
      idleReviews.set(review.id, review);
    }
  }
  const pairReviews = decision?.pairReviews ?? [];
  const idleJudgeResponse = latestEvent(events, (event) => event.type === 'idle-judge-response');
  const idleJudgeStart = latestEvent(
    events,
    (event) => event.type === 'stage' && event.stage === 'idle-judge' && event.status === 'started',
  );
  const idleJudgeBoardEvent = latestEvent(
    events,
    (event) => event.type === 'asset' && event.data?.kind === 'idle-judge-board',
  );
  const idleJudgeBoard = idleJudgeBoardEvent ? assetFrom(idleJudgeBoardEvent) : null;
  const rawIdleJudge = stringValue(idleJudgeResponse?.data?.raw);
  const idleJudgeSystemPrompt = stringValue(idleJudgeStart?.data?.systemPrompt);
  const idleJudgeUserPrompt = stringValue(idleJudgeStart?.data?.userPrompt);
  const judgeResponse = latestEvent(events, (event) => event.type === 'judge-response');
  const judgeStart = latestEvent(
    events,
    (event) => event.type === 'stage' && event.stage === 'judge' && event.status === 'started',
  );
  const rawJudge = stringValue(judgeResponse?.data?.raw);
  const judgeSystemPrompt = stringValue(judgeStart?.data?.systemPrompt);
  const judgeUserPrompt = stringValue(judgeStart?.data?.userPrompt);
  const done = latestEvent(events, (event) => event.type === 'done');
  const failed = latestEvent(events, (event) => event.type === 'failed');
  const running = Boolean(runId && !done && !failed);
  const hasSideIdle = Boolean(assets.get('side-anchor')?.processedUrl);
  const sparkPreviewSequence = platformerPosePreviewSequence(
    selectedPhaseA,
    selectedPhaseB,
    hasSideIdle,
  );
  const humanPreviewSequence = platformerPosePreviewSequence(humanPhaseA, humanPhaseB, hasSideIdle);
  const sparkPreviewTimeline = platformerPosePreviewTimeline(
    sparkPreviewSequence,
    previewDurations,
    dissolvePreview,
    dissolveFrames,
  );
  const humanPreviewTimeline = platformerPosePreviewTimeline(
    humanPreviewSequence,
    previewDurations,
    dissolvePreview,
    dissolveFrames,
  );
  const sparkPreviewStep = sparkPreviewTimeline.length
    ? sparkPreviewTimeline[frame % sparkPreviewTimeline.length]
    : undefined;
  const humanPreviewStep = humanPreviewTimeline.length
    ? humanPreviewTimeline[frame % humanPreviewTimeline.length]
    : undefined;
  const chosenAsset = sparkPreviewStep ? assets.get(sparkPreviewStep.id) : undefined;
  const chosenBlendFromAsset = sparkPreviewStep?.blendFromId
    ? assets.get(sparkPreviewStep.blendFromId)
    : undefined;
  const humanPreviewAsset = humanPreviewStep ? assets.get(humanPreviewStep.id) : undefined;
  const humanBlendFromAsset = humanPreviewStep?.blendFromId
    ? assets.get(humanPreviewStep.blendFromId)
    : undefined;
  const activePreviewStep = sparkPreviewStep ?? humanPreviewStep;

  useEffect(() => {
    if (!activePreviewStep) return;
    const timer = window.setTimeout(
      () => setFrame((value) => value + 1),
      activePreviewStep.durationMs,
    );
    return () => window.clearTimeout(timer);
  }, [
    frame,
    selectedPhaseA,
    selectedPhaseB,
    humanPhaseA,
    humanPhaseB,
    hasSideIdle,
    previewDurations,
    dissolvePreview,
    dissolveFrames,
  ]);

  const choosePhoto = (file: File): void => {
    setPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
    setError(null);
  };

  const start = async (): Promise<void> => {
    if (!photo || starting || running) return;
    setStarting(true);
    setError(null);
    setEvents([]);
    setRunId(null);
    setHumanPhaseA('');
    setHumanPhaseB('');
    setHumanNotes('');
    setHumanError(null);
    loadedHumanVerdictRef.current = '';
    try {
      const result = await api.startPlatformerPoseLab({ photo, heroConcept, colors });
      setRunId(result.runId);
      const url = new URL(window.location.href);
      url.searchParams.set('run', result.runId);
      window.history.replaceState(null, '', url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setStarting(false);
    }
  };

  const saveHumanVerdict = async (accepted: boolean): Promise<void> => {
    if (!runId || savingHuman) return;
    if (accepted && (!humanPhaseA || !humanPhaseB)) {
      setHumanError('Choose one Phase A and one Phase B candidate.');
      return;
    }
    setSavingHuman(true);
    setHumanError(null);
    try {
      const result = await api.savePlatformerPoseHumanVerdict(runId, {
        accepted,
        phaseAId: humanPhaseA,
        phaseBId: humanPhaseB,
        notes: humanNotes,
      });
      setEvents((current) =>
        [...current.filter((event) => event.seq !== result.event.seq), result.event].sort(
          (a, b) => a.seq - b.seq,
        ),
      );
    } catch (caught) {
      setHumanError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSavingHuman(false);
    }
  };

  const imageCalls = numberValue(done?.data?.imageCalls) ?? 0;
  const imageCost = numberValue(done?.data?.imageCostUsd);
  const judgeCost = numberValue(done?.data?.judgeCostUsd);

  return (
    <main class="ppl-page">
      <header class="ppl-header">
        <div>
          <h1>Platformer Poses Lab</h1>
          <p>Muse Image candidates → Spark identity gate → Spark animation selection</p>
        </div>
        <nav>
          <a href="/?dev=platformer-levels">Level lab</a>
          <a href="/?dev=likeness">Likeness lab</a>
          <a href="/?dev=assets">Asset gallery</a>
        </nav>
      </header>

      <section class="ppl-intro">
        <div class="ppl-form">
          <div class="ppl-photo-picker">
            {photoPreview ? (
              <img src={photoPreview} alt="Selected player reference" />
            ) : (
              <span>Player reference</span>
            )}
            <button type="button" onClick={() => fileRef.current?.click()} disabled={running}>
              {photo ? 'Choose another image' : 'Choose image'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const file = (event.target as HTMLInputElement).files?.[0];
                if (file) choosePhoto(file);
              }}
            />
          </div>
          <label>
            <span>
              Costume / hero concept <small>optional</small>
            </span>
            <textarea
              value={heroConcept}
              disabled={running}
              placeholder="Garments and body-worn details only"
              onInput={(event) => setHeroConcept((event.target as HTMLTextAreaElement).value)}
            />
          </label>
          <label>
            <span>
              Costume colors <small>optional</small>
            </span>
            <input
              value={colors}
              disabled={running}
              placeholder="#202538, #c88d52, …"
              onInput={(event) => setColors((event.target as HTMLInputElement).value)}
            />
          </label>
          <button
            class="ppl-run"
            type="button"
            disabled={!photo || starting || running}
            onClick={() => void start()}
          >
            {starting ? 'Starting…' : running ? 'Pipeline running…' : 'Run 10-image experiment'}
          </button>
          <p class="ppl-cost-note">
            Three parallel front-idle foundations, one shared side anchor, then six parallel action
            candidates. Approximately $0.10 in Muse Image calls plus two Muse Spark reviews; one
            bounded idle retry batch runs only when needed. Runs persist locally under the
            gitignored data/experiments directory.
          </p>
        </div>

        <div class="ppl-timeline" aria-label="Pipeline progress">
          {STAGES.map((stage, index) => {
            const status = stageStatus(stage.id, events);
            return (
              <div class={`ppl-stage ${status}`} key={stage.id}>
                <span class="ppl-stage-index">{index + 1}</span>
                <div>
                  <strong>{stage.label}</strong>
                  <small>{stage.note}</small>
                </div>
                <em>{status}</em>
              </div>
            );
          })}
        </div>
      </section>

      {error && <div class="ppl-error">{error}</div>}
      {failed && <div class="ppl-error">Pipeline failed: {failed.message}</div>}

      {(events.length > 0 || runId) && (
        <>
          <section class="ppl-section">
            <div class="ppl-section-heading">
              <div>
                <h2>Identity foundation</h2>
                <p>
                  Spark chooses the safest front likeness before any downstream pose can inherit its
                  mistakes.
                </p>
              </div>
              {runId && <code>{runId}</code>}
            </div>
            <div class="ppl-foundations">
              <FoundationCard
                asset={assets.get('source')}
                title="Source identity"
                note="The identity truth supplied to Muse Image and Spark."
              />
              <FoundationCard
                asset={selectedIdleId ? assets.get(selectedIdleId) : undefined}
                title="Selected front idle"
                note="The Spark-approved high-resolution identity seed for every later edit."
                prompt={selectedIdleId ? prompts.get(selectedIdleId) : undefined}
              />
              <FoundationCard
                asset={assets.get('side-anchor')}
                title="Shared side anchor"
                note="Neutral side profile used as the sole reference for all six action candidates."
                prompt={prompts.get('side-anchor')}
              />
            </div>
            {idleAssets.length > 0 && (
              <div class="ppl-idle-foundations">
                <div class="ppl-section-heading">
                  <div>
                    <h3>Front-idle candidates</h3>
                    <p>
                      Local validation runs first; Spark then compares each surviving raw seed and
                      112×128 high-density sprite directly against the source photo.
                    </p>
                  </div>
                  {idleJudgeResponse?.elapsedMs !== undefined && (
                    <span>{formatTime(idleJudgeResponse.elapsedMs)}</span>
                  )}
                </div>
                <div class="ppl-candidate-grid">
                  {idleAssets.map((asset) => (
                    <IdleCandidateCard
                      key={asset.id}
                      asset={asset}
                      review={idleReviews.get(asset.id)}
                      selected={selectedIdleId === asset.id}
                      prompt={prompts.get(asset.id)}
                    />
                  ))}
                </div>
                {idleJudgeBoard?.processedUrl && (
                  <img
                    class="ppl-judge-board"
                    src={idleJudgeBoard.processedUrl}
                    alt="Front-idle identity candidate board reviewed by Muse Spark"
                  />
                )}
                {(idleJudgeSystemPrompt || idleJudgeUserPrompt) && (
                  <details class="ppl-prompt ppl-judge-prompt">
                    <summary>Exact front-idle Muse Spark judging prompt</summary>
                    <div>
                      {idleJudgeSystemPrompt && (
                        <section>
                          <strong>System</strong>
                          <pre>{idleJudgeSystemPrompt}</pre>
                        </section>
                      )}
                      {idleJudgeUserPrompt && (
                        <section>
                          <strong>User</strong>
                          <pre>{idleJudgeUserPrompt}</pre>
                        </section>
                      )}
                    </div>
                  </details>
                )}
                {rawIdleJudge && (
                  <details class="ppl-judge-raw" open>
                    <summary>Raw front-idle Muse Spark scoring response</summary>
                    <pre>{rawIdleJudge}</pre>
                  </details>
                )}
                {idleDecision && (
                  <div
                    class={`ppl-selection ${idleDecision.selection.accepted ? 'accepted' : 'rejected'}`}
                  >
                    <div class="ppl-selection-copy">
                      <span>
                        {idleDecision.selection.accepted
                          ? 'IDENTITY FOUNDATION ACCEPTED'
                          : 'FOUNDATION BATCH REJECTED'}
                      </span>
                      <h3>
                        {idleDecision.selection.accepted
                          ? idleDecision.selection.candidateId
                          : 'No front idle met the identity bar'}
                      </h3>
                      <p>
                        Source eyewear: <strong>{idleDecision.sourceReview.eyewear}</strong> ·{' '}
                        {idleDecision.sourceReview.summary}
                      </p>
                      <p>{idleDecision.selection.rationale}</p>
                      {idleDecision.selection.retryGuidance && (
                        <p class="ppl-retry">
                          <strong>Retry guidance:</strong> {idleDecision.selection.retryGuidance}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            {decision && (
              <div
                class={`ppl-anchor-review ${decision.anchorReview.fatalIssues.length ? 'bad' : 'good'}`}
              >
                <strong>Spark’s anchor review</strong>
                <div class="ppl-scores">
                  <ScorePips label="IDENTITY" value={decision.anchorReview.identity} />
                  <ScorePips label="SIDE VIEW" value={decision.anchorReview.sideView} />
                  <ScorePips label="COSTUME" value={decision.anchorReview.costume} />
                </div>
                <p>{decision.anchorReview.summary}</p>
                {decision.anchorReview.fatalIssues.length > 0 && (
                  <ul class="ppl-fatals">
                    {decision.anchorReview.fatalIssues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>

          <section class="ppl-section">
            <div class="ppl-section-heading">
              <div>
                <h2>Phase A · camera-side leg forward</h2>
                <p>
                  The near leg reaches screen-right; the far leg and near arm reach screen-left.
                </p>
              </div>
            </div>
            <div class="ppl-candidate-grid">
              {phaseAAssets.length ? (
                phaseAAssets.map((asset) => (
                  <CandidateCard
                    key={asset.id}
                    asset={asset}
                    review={reviews.get(asset.id)}
                    selected={selectedPhaseA === asset.id}
                    prompt={prompts.get(asset.id)}
                  />
                ))
              ) : (
                <div class="ppl-waiting">Waiting for Phase A candidates…</div>
              )}
            </div>
          </section>

          <section class="ppl-section">
            <div class="ppl-section-heading">
              <div>
                <h2>Phase B · far-side leg forward</h2>
                <p>The far leg reaches screen-right; the near leg and far arm reach screen-left.</p>
              </div>
            </div>
            <div class="ppl-candidate-grid">
              {phaseBAssets.length ? (
                phaseBAssets.map((asset) => (
                  <CandidateCard
                    key={asset.id}
                    asset={asset}
                    review={reviews.get(asset.id)}
                    selected={selectedPhaseB === asset.id}
                    prompt={prompts.get(asset.id)}
                  />
                ))
              ) : (
                <div class="ppl-waiting">Waiting for Phase B candidates…</div>
              )}
            </div>
          </section>

          {(assets.get('judge-board') || rawJudge || decision) && (
            <section class="ppl-section ppl-judge-section">
              <div class="ppl-section-heading">
                <div>
                  <h2>Muse Spark review</h2>
                  <p>
                    The exact labeled board, raw structured response, and normalized pair decision.
                  </p>
                </div>
                {judgeResponse?.elapsedMs !== undefined && (
                  <span>{formatTime(judgeResponse.elapsedMs)}</span>
                )}
              </div>
              {assets.get('judge-board')?.processedUrl && (
                <img
                  class="ppl-judge-board"
                  src={assets.get('judge-board')!.processedUrl}
                  alt="Labeled pose candidate board reviewed by Muse Spark"
                />
              )}
              {(judgeSystemPrompt || judgeUserPrompt) && (
                <details class="ppl-prompt ppl-judge-prompt">
                  <summary>Exact Muse Spark judging prompt</summary>
                  <div>
                    {judgeSystemPrompt && (
                      <section>
                        <strong>System</strong>
                        <pre>{judgeSystemPrompt}</pre>
                      </section>
                    )}
                    {judgeUserPrompt && (
                      <section>
                        <strong>User</strong>
                        <pre>{judgeUserPrompt}</pre>
                      </section>
                    )}
                  </div>
                </details>
              )}
              {rawJudge && (
                <details class="ppl-judge-raw" open>
                  <summary>Raw Muse Spark scoring response</summary>
                  <pre>{rawJudge}</pre>
                </details>
              )}
              {pairReviews.length > 0 && (
                <div class="ppl-pair-matrix">
                  <header>
                    <strong>Spark’s pairwise comparison matrix</strong>
                    <span>{pairReviews.length} A+B pairs scored independently</span>
                  </header>
                  <div>
                    {pairReviews.map((review) => (
                      <PairReviewCard
                        key={`${review.phaseAId}-${review.phaseBId}`}
                        review={review}
                        selected={
                          decision?.selection.accepted === true &&
                          decision.selection.phaseAId === review.phaseAId &&
                          decision.selection.phaseBId === review.phaseBId
                        }
                      />
                    ))}
                  </div>
                </div>
              )}
              {decision && (
                <div
                  class={`ppl-selection ${decision.selection.accepted ? 'accepted' : 'rejected'}`}
                >
                  <div class="ppl-selection-copy">
                    <span>{decision.selection.accepted ? 'PAIR ACCEPTED' : 'BATCH REJECTED'}</span>
                    <h3>
                      {decision.selection.accepted
                        ? `${decision.selection.phaseAId} + ${decision.selection.phaseBId}`
                        : 'No candidate pair met the bar'}
                    </h3>
                    <div class="ppl-scores">
                      <ScorePips label="PAIR" value={decision.selection.pairConsistency} />
                      <ScorePips label="LEGS" value={decision.selection.legAlternation} />
                      <ScorePips label="ARMS" value={decision.selection.armAlternation} />
                      <span class="ppl-confidence">
                        {Math.round(decision.selection.confidence * 100)}% confidence
                      </span>
                    </div>
                    <p>{decision.selection.rationale}</p>
                    {decision.selection.retryGuidance && (
                      <p class="ppl-retry">
                        <strong>Retry guidance:</strong> {decision.selection.retryGuidance}
                      </p>
                    )}
                  </div>
                  {decision.selection.accepted && chosenAsset?.processedUrl && (
                    <div class="ppl-animation">
                      <span>
                        A {previewDurations[0]}ms → idle {previewDurations[1]}ms → B{' '}
                        {previewDurations[2]}ms → idle {previewDurations[3]}ms ·{' '}
                        {dissolvePreview
                          ? `${dissolveFrames}f / ${Math.round(PLATFORMER_POSE_DISSOLVE_DURATION_MS * dissolveFrames)}ms dissolve`
                          : 'hard cuts'}
                      </span>
                      <div>
                        <PreviewSprite
                          asset={chosenAsset}
                          blendFrom={chosenBlendFromAsset}
                          label={`Animated selected ${chosenAsset.kind} frame`}
                        />
                      </div>
                      <small>{previewFrameLabel(sparkPreviewStep)}</small>
                    </div>
                  )}
                </div>
              )}
              {(decision?.selection.accepted ||
                (phaseAAssets.length > 0 && phaseBAssets.length > 0)) && (
                <div class="ppl-timing-controls">
                  <header>
                    <div>
                      <strong>Animation timing</strong>
                      <span>
                        Dissolve time replaces the start of each pose hold, so cycle speed stays
                        fixed.
                      </span>
                    </div>
                    <div class="ppl-timing-actions">
                      <div class="ppl-preview-mode" role="group" aria-label="Transition preview">
                        <button
                          type="button"
                          class={!dissolvePreview ? 'active' : ''}
                          aria-pressed={!dissolvePreview}
                          onClick={() => {
                            setDissolvePreview(false);
                            setFrame(0);
                          }}
                        >
                          Hard cuts
                        </button>
                        <button
                          type="button"
                          class={dissolvePreview ? 'active' : ''}
                          aria-pressed={dissolvePreview}
                          onClick={() => {
                            setDissolvePreview(true);
                            setFrame(0);
                          }}
                        >
                          Dissolve
                        </button>
                      </div>
                      <div class="ppl-dissolve-length" role="group" aria-label="Dissolve duration">
                        {([1, 2, 3] as const).map((frames) => (
                          <button
                            type="button"
                            class={dissolveFrames === frames ? 'active' : ''}
                            aria-pressed={dissolveFrames === frames}
                            disabled={!dissolvePreview}
                            title={frames === 1 ? 'Current gameplay duration' : undefined}
                            onClick={() => {
                              setDissolveFrames(frames);
                              setFrame(0);
                            }}
                            key={frames}
                          >
                            {frames}f{frames === 1 ? ' runtime' : ''}
                          </button>
                        ))}
                      </div>
                      <div class="ppl-timing-presets">
                        {[
                          { label: 'Snappy', durations: [110, 50, 110, 50] },
                          { label: 'Balanced', durations: [140, 70, 140, 70] },
                          { label: 'Readable', durations: [170, 80, 170, 80] },
                        ].map((preset) => (
                          <button
                            type="button"
                            class={
                              previewDurations.every(
                                (duration, index) => duration === preset.durations[index],
                              )
                                ? 'active'
                                : ''
                            }
                            onClick={() => {
                              setPreviewDurations(
                                preset.durations as PlatformerPosePreviewDurations,
                              );
                              setFrame(0);
                            }}
                            key={preset.label}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </header>
                  <div>
                    {PREVIEW_TIMING_LABELS.map((label, index) => {
                      const idle = index === 1 || index === 3;
                      return (
                        <label key={label}>
                          <span>{label}</span>
                          <input
                            type="range"
                            min={idle ? '30' : '80'}
                            max={idle ? '160' : '220'}
                            step="10"
                            value={previewDurations[index]}
                            onInput={(event) => {
                              const next = [...previewDurations] as PlatformerPosePreviewDurations;
                              next[index] = Number((event.target as HTMLInputElement).value);
                              setPreviewDurations(next);
                              setFrame(0);
                            }}
                          />
                          <output>{previewDurations[index]}ms</output>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
              {done && phaseAAssets.length > 0 && phaseBAssets.length > 0 && (
                <div class="ppl-human-verdict">
                  <div class="ppl-human-copy">
                    <span>HUMAN GROUND TRUTH</span>
                    <h3>Record the pair that actually animates best</h3>
                    <p>
                      This verdict is saved beside Spark’s untouched response, so false rejects and
                      false accepts can be analyzed across runs.
                    </p>
                    <div class="ppl-human-fields">
                      <label>
                        <span>Phase A</span>
                        <select
                          value={humanPhaseA}
                          onChange={(event) => {
                            setHumanPhaseA((event.target as HTMLSelectElement).value);
                            setFrame(0);
                          }}
                        >
                          {phaseAAssets.map(({ id }) => (
                            <option value={id} key={id}>
                              {id}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Phase B</span>
                        <select
                          value={humanPhaseB}
                          onChange={(event) => {
                            setHumanPhaseB((event.target as HTMLSelectElement).value);
                            setFrame(0);
                          }}
                        >
                          {phaseBAssets.map(({ id }) => (
                            <option value={id} key={id}>
                              {id}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label class="ppl-human-notes">
                        <span>Notes</span>
                        <textarea
                          value={humanNotes}
                          placeholder="What reads well or fails?"
                          onInput={(event) =>
                            setHumanNotes((event.target as HTMLTextAreaElement).value)
                          }
                        />
                      </label>
                    </div>
                    <div class="ppl-human-actions">
                      <button
                        type="button"
                        disabled={savingHuman}
                        onClick={() => void saveHumanVerdict(true)}
                      >
                        {savingHuman ? 'Saving…' : 'Save accepted pair'}
                      </button>
                      <button
                        type="button"
                        class="danger"
                        disabled={savingHuman}
                        onClick={() => void saveHumanVerdict(false)}
                      >
                        Save reject-all
                      </button>
                    </div>
                    {humanError && <p class="ppl-asset-error">{humanError}</p>}
                    {humanVerdict && (
                      <div class={`ppl-human-saved ${humanVerdict.accepted ? 'good' : 'bad'}`}>
                        <strong>
                          Saved:{' '}
                          {humanVerdict.accepted
                            ? `${humanVerdict.phaseAId} + ${humanVerdict.phaseBId}`
                            : 'reject all'}
                        </strong>
                        <span>{new Date(humanVerdict.at).toLocaleString()}</span>
                        {humanVerdict.notes && <p>{humanVerdict.notes}</p>}
                      </div>
                    )}
                  </div>
                  {humanPreviewAsset?.processedUrl && (
                    <div class="ppl-animation">
                      <span>
                        A {previewDurations[0]}ms → idle {previewDurations[1]}ms → B{' '}
                        {previewDurations[2]}ms → idle {previewDurations[3]}ms ·{' '}
                        {dissolvePreview
                          ? `${dissolveFrames}f / ${Math.round(PLATFORMER_POSE_DISSOLVE_DURATION_MS * dissolveFrames)}ms dissolve`
                          : 'hard cuts'}
                      </span>
                      <div>
                        <PreviewSprite
                          asset={humanPreviewAsset}
                          blendFrom={humanBlendFromAsset}
                          label={`Human-selected ${humanPreviewAsset.kind} frame`}
                        />
                      </div>
                      <small>{previewFrameLabel(humanPreviewStep)}</small>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          <section class="ppl-section ppl-log-section">
            <div class="ppl-section-heading">
              <div>
                <h2>Live pipeline log</h2>
                <p>Every provider call, local gate, judge response, and human verdict.</p>
              </div>
              {done && (
                <span>
                  {imageCalls} images · ${imageCost?.toFixed(2) ?? '—'} + Spark $
                  {judgeCost?.toFixed(4) ?? '—'}
                </span>
              )}
            </div>
            <ol class="ppl-log">
              {events.map((event) => (
                <li class={event.status} key={event.seq}>
                  <time>{new Date(event.at).toLocaleTimeString()}</time>
                  <span>{event.stage}</span>
                  <p>{event.message}</p>
                  <em>{formatTime(event.elapsedMs)}</em>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </main>
  );
}
