import type { GenerationFeedEvent } from '@sparkade/shared';

export interface ProgressItem {
  id: string;
  kind: 'progress' | 'decision' | 'asset' | 'review' | 'complete' | 'failure';
  message: string;
  at: string;
  image?: string;
  caption?: string;
}
export interface WebsiteProgress {
  status: string;
  attempt: number;
  terminal: boolean;
  title: string;
  summary: string;
  failure: string | null;
  items: ProgressItem[];
  timing: ProgressTiming;
}
export const BUILD_PHASES = [
  { id: 'idea', label: 'Idea check' },
  { id: 'design', label: 'Game design' },
  { id: 'assets', label: 'Art & music' },
  { id: 'checks', label: 'Final checks' },
  { id: 'ready', label: 'Ready' },
] as const;
type BuildPhase = (typeof BUILD_PHASES)[number]['id'];
export interface ProgressTiming {
  phase: BuildPhase;
  startedAt: string;
  phaseStartedAt: string;
  lastActivityAt: string;
  finishedAt: string | null;
  asOf: string;
}
export const STAGES: Record<string, string> = {
  queued: 'Waiting to begin',
  analyzing: 'Looking at your photo',
  designing: 'Designing your game',
  design: 'Designing your game',
  writing: 'Writing the game',
  'writing-spec': 'Writing game rules, levels and music',
  'analyzing-photo': 'Looking at your photo',
  generating: 'Building the game',
  validating: 'Checking game rules',
  repairing: 'Refining the game',
  'building-assets': 'Creating the art and music',
  'waiting-network': 'Waiting for the generation service',
  publishing: 'Checking the finished game',
};
export const imageFilename = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.(png|jpe?g|webp)$/i.test(value);
const briefText = (value: unknown, limit = 160) =>
  typeof value === 'string' ? value.slice(0, limit) : '';

/** Translate known pipeline messages into activity, never expose arbitrary logs. */
function activityMessage(message: string): string | undefined {
  if (/\$|https?:|provider|token|secret|api.key|traceback|unavailable/i.test(message)) return;
  // Durable passes restore already completed work. That isn't a new milestone.
  if (/^(Restored|Resuming)\b/.test(message)) return;
  const poses = message.match(/^(.{1,60})'s (mobility|attacks) sheet yielded (\d+)\/(\d+) poses\b/);
  if (poses)
    return `Prepared ${poses[3]} of ${poses[4]} ${poses[2] === 'mobility' ? 'movement' : 'attack'} poses for ${poses[1]}`;
  if (/failed local (sprite )?validation|sheet cell failed local validation/.test(message))
    return 'Refining character art to fit the game';
  const repaint = message.match(/^Repainting \d+ (?:rejected |weak )(.+?)(?: sheet cells| poses)/);
  if (repaint) return `Refining ${briefText(repaint[1], 60)}’s animation`;
  if (/\bfailed\b/i.test(message)) return;
  const identity = message.match(/^(.{1,60}) identity \d+$/);
  if (identity) return `Exploring fighter designs for ${identity[1]}`;
  if (/^Player identity candidate \w+$/.test(message)) return 'Exploring your hero’s appearance';
  if (/^Player run Phase [AB] candidate \d+$/.test(message)) return 'Animating your hero’s run';
  if (/^Player jump candidate \d+$/.test(message)) return 'Animating your hero’s jump';
  if (/^Player neutral side identity anchor$/.test(message))
    return 'Defining your hero’s side view';
  if (/^(walker|flyer|shooter|chaser) candidate \w+$/.test(message))
    return `Exploring ${message.split(' ')[0]} enemy designs`;
  if (/^Boss candidate \w+$/.test(message)) return 'Exploring boss designs';
  const sheet = message.match(
    /^(.{1,60}) (mobility, defense, and reactions|ground and aerial attacks) sheet$/,
  );
  if (sheet)
    return `Animating ${sheet[1]}’s ${sheet[2].startsWith('mobility') ? 'movement and defense' : 'attacks'}`;
  if (/^.{1,80} (background|portrait|scene|gameplay prop)$/.test(message))
    return `Illustrating ${message}`;
  const part = message.match(/^(Levels|Entities|Music) done \((\d+)\/3\)$/i);
  if (part) return `${part[1]} drafted · ${part[2]} of 3 game design parts ready`;
  // Keep activity from older kiosks and stored jobs visible during rollout.
  if (
    /^(Painting|Finished|(?:Muse|Spark) (?:selected|reviewed)|Composing|Animating|Creating|Designing|Checking|Building|Generated)\b/.test(
      message,
    )
  )
    return message.slice(0, 200);
}
/** Explicit projection: never serialize pipeline state, pricing, logs or arbitrary event payloads. */
export function projectGenerationEvents(
  events: GenerationFeedEvent[],
  gameId: string,
  attempt: number,
): ProgressItem[] {
  const genericStages = new Set<string>();
  const items = events
    .filter((e) => e.attempt === attempt && e.kind !== 'complete' && e.kind !== 'failure')
    .slice(-500)
    .map((e) => {
      const item: ProgressItem = {
        id: `build:${attempt}:${e.id}`,
        kind: 'progress',
        at: e.at,
        message: STAGES[e.stage ?? ''] ?? 'Working on your game',
      };
      if (e.kind === 'progress') {
        if (/^(Restored|Resuming)\b/.test(e.message)) return null;
        const activity = activityMessage(e.message);
        if (activity) item.message = activity;
        else {
          // Hidden technical events used to produce a generic row each time.
          // Keep one stage marker, even when other cards are interleaved.
          const stage = e.stage ?? '';
          if (genericStages.has(stage)) return null;
          genericStages.add(stage);
        }
      }
      if (e.stage === 'queued') item.message = 'Your creation request is saved';
      if (e.kind === 'decision') {
        item.kind = 'decision';
        const title = briefText(e.payload?.title),
          role = briefText(e.payload?.role);
        item.message = title
          ? `Game concept: ${title}`
          : role
            ? `Art direction chosen for ${role}`
            : 'Game design decision saved';
        item.caption = briefText(e.payload?.tagline, 240) || undefined;
        if (typeof e.payload?.bpm === 'number' && Number.isFinite(e.payload.bpm)) {
          item.message = 'Your soundtrack is composed';
          item.caption = `${Math.round(e.payload.bpm)} BPM${briefText(e.payload.key, 24) ? ` · ${briefText(e.payload.key, 24)}` : ''}`;
        }
        if (e.payload?.category === 'sprite-validation')
          item.message = 'Refining a character to fit the game';
      }
      if (e.kind === 'asset' && imageFilename(e.payload?.filename)) {
        const role = briefText(e.payload?.role)
          .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
          .replace(/([a-z])(\d+)/gi, '$1 $2')
          .toLowerCase()
          .replace(/^fighter /, '')
          .replace(/\batlas\b/g, 'animations')
          .replace(/^key art$/, 'cover art');
        item.kind = 'asset';
        item.message = `${role ? role[0]!.toUpperCase() + role.slice(1) : 'Game art'} is ready`;
        item.image = `/api/me/games/${encodeURIComponent(gameId)}/preview/${encodeURIComponent(e.payload.filename)}`;
      }
      return item;
    });
  return items.filter((item, index): item is ProgressItem => {
    if (!item) return false;
    // Keep the first timestamp and stable ID. Art cards always remain separate.
    let previous = index - 1;
    while (previous >= 0 && !items[previous]) previous--;
    const before = items[previous];
    return (
      item.kind === 'asset' ||
      !before ||
      item.kind !== before.kind ||
      item.message !== before.message ||
      item.caption !== before.caption
    );
  });
}

const stagePhase = (stage?: string): BuildPhase | undefined => {
  if (stage === 'building-assets') return 'assets';
  if (stage === 'publishing' || stage === 'done') return 'checks';
  if (
    stage &&
    [
      'analyzing',
      'analyzing-photo',
      'designing',
      'design',
      'writing',
      'writing-spec',
      'validating',
      'repairing',
    ].includes(stage)
  )
    return 'design';
};

/** Use persisted activity times, never polling time, for stage and activity clocks. */
export function progressTiming(
  input: {
    attempt: number;
    createdAt: string;
    updatedAt: string;
    startedAt?: string;
    status: string;
    stage?: string;
    inputApproved: boolean;
    rejected: boolean;
    events: GenerationFeedEvent[];
    reviews: {
      phase: string;
      decision: string | null;
      createdAt: string;
      completedAt: string | null;
    }[];
  },
  asOf = new Date().toISOString(),
): ProgressTiming {
  const events = input.events.filter((e) => e.attempt === input.attempt);
  const times = [...events.map((e) => e.at), ...input.reviews.map((r) => r.createdAt)];
  if (input.startedAt) times.push(input.startedAt);
  // Retries must not inherit elapsed time from the original, failed attempt.
  const startedAt = input.attempt === 1 ? input.createdAt : (times.sort()[0] ?? input.updatedAt);
  const markers: { at: string; phase?: BuildPhase }[] = events.map((e) => ({
    at: e.at,
    phase: stagePhase(e.stage),
  }));
  for (const review of input.reviews) {
    markers.push({ at: review.createdAt, phase: review.phase === 'input' ? 'idea' : 'checks' });
    if (review.completedAt)
      markers.push({
        at: review.completedAt,
        phase: review.phase === 'input' && review.decision === 'allow' ? 'design' : undefined,
      });
  }
  let phase: BuildPhase = 'idea',
    phaseStartedAt = startedAt,
    lastActivityAt = startedAt;
  for (const marker of markers.sort((a, b) => a.at.localeCompare(b.at))) {
    if (marker.at > lastActivityAt) lastActivityAt = marker.at;
    // Resumed passes may replay earlier stages; the overview must not jump back.
    if (
      marker.phase &&
      BUILD_PHASES.findIndex((p) => p.id === marker.phase) >
        BUILD_PHASES.findIndex((p) => p.id === phase)
    ) {
      phase = marker.phase;
      phaseStartedAt = marker.at;
    }
  }
  const currentPhase =
    input.status === 'done' && !input.rejected
      ? 'ready'
      : ['publishing', 'review'].includes(input.status)
        ? 'checks'
        : (stagePhase(input.stage) ?? (input.inputApproved ? 'design' : 'idea'));
  if (
    BUILD_PHASES.findIndex((p) => p.id === currentPhase) >
    BUILD_PHASES.findIndex((p) => p.id === phase)
  ) {
    phase = currentPhase;
    phaseStartedAt = input.updatedAt;
  }
  const finishedAt = ['done', 'failed', 'canceled'].includes(input.status) ? input.updatedAt : null;
  if (finishedAt) lastActivityAt = finishedAt;
  return { phase, startedAt, phaseStartedAt, lastActivityAt, finishedAt, asOf };
}

export function elapsedTime(from: string, to: string | number): string {
  const seconds =
    Math.max(
      0,
      Math.floor(((typeof to === 'number' ? to : Date.parse(to)) - Date.parse(from)) / 1000),
    ) || 0;
  const hours = Math.floor(seconds / 3600),
    minutes = Math.floor(seconds / 60) % 60;
  return `${hours ? `${hours}:${String(minutes).padStart(2, '0')}` : minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
