// Durable generation feed. History is loaded from SQLite, new cards arrive by
// SSE, and the player can scroll away from live updates without being yanked
// back to the bottom.
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import QRCode from 'qrcode';
import {
  type GenerationFeedEvent,
  type JobEvent,
  type JobStage,
  type PublicGameLink,
} from '@sparkade/shared';
import { api, subscribeJob } from '../api';
import { FooterLegend, fmtElapsed, usd, useNow } from '../components';
import {
  isCompactGenerationAssetRole,
  isNearFeedBottom,
  mergeGenerationEvents,
} from '../generation-feed';
import { Icon } from '../icons';
import { shellInput } from '../shell-input';
import type { Screen } from '../app';

const STAGE_LABELS: Record<JobStage, string> = {
  queued: 'Queued',
  designing: 'Designing',
  'writing-spec': 'Building game',
  validating: 'Validating',
  repairing: 'Repairing',
  'building-assets': 'Painting assets',
  done: 'Ready',
  failed: 'Failed',
};

export function PublicGameQrCard({
  link,
  mode = 'progress',
}: {
  link: PublicGameLink;
  mode?: 'progress' | 'ready';
}): ComponentChildren {
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [qrFailed, setQrFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setQrSrc(null);
    setQrFailed(false);
    void QRCode.toDataURL(link.url, {
      width: 260,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#07101fff', light: '#ffffffff' },
    })
      .then((src) => {
        if (alive) setQrSrc(src);
      })
      .catch(() => {
        if (alive) setQrFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [link.url]);

  return (
    <article class="gen-feed-card public-game-card">
      <div class={`public-game-qr-frame ${qrFailed ? 'failed' : ''}`}>
        {qrSrc ? (
          <img src={qrSrc} width="260" height="260" alt={`QR code for ${link.url}`} />
        ) : qrFailed ? (
          <Icon name="warning" />
        ) : (
          <Icon name="sparkle" class="spin" />
        )}
      </div>
      <div class="public-game-copy">
        <span class="public-game-kicker">TAKE IT WITH YOU</span>
        <h3 class="pixel">{mode === 'ready' ? 'SCAN TO PLAY' : 'SCAN TO FOLLOW'}</h3>
        <p>
          {mode === 'ready'
            ? 'Open this game on any screen, or send the link to someone else.'
            : 'Watch this build from any screen, then come back when it’s ready.'}
        </p>
        <strong>{link.url.replace(/^https?:\/\//, '')}</strong>
        <span class="public-game-id">{link.id.toUpperCase()}</span>
      </div>
    </article>
  );
}

function textPayload(event: GenerationFeedEvent, key: string): string | null {
  const value = event.payload?.[key];
  return typeof value === 'string' ? value : null;
}

function numberPayload(event: GenerationFeedEvent, key: string): number | null {
  const value = event.payload?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringArrayPayload(event: GenerationFeedEvent, key: string): string[] {
  const value = event.payload?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function eventTime(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.valueOf())
    ? ''
    : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function FeedCard(props: {
  event: GenerationFeedEvent;
  jobId: string;
  onRetry?: () => void;
  retrying?: boolean;
  retryError?: string | null;
}): ComponentChildren {
  const event = props.event;
  const title = textPayload(event, 'title');
  const tagline = textPayload(event, 'tagline');
  const archetype = textPayload(event, 'archetype');
  const heroName = textPayload(event, 'heroName');
  const details = textPayload(event, 'details');
  const palette = stringArrayPayload(event, 'palette');
  const levelNames = stringArrayPayload(event, 'levelNames');
  const filename = textPayload(event, 'filename');
  const role = textPayload(event, 'role');
  const bpm = numberPayload(event, 'bpm');
  const key = textPayload(event, 'key');

  if (event.kind === 'decision') {
    return (
      <article class="gen-feed-card decision">
        <div class="gen-feed-card-head">
          <span class="gen-feed-icon">
            <Icon name="sparkle" />
          </span>
          <span>DECISION</span>
          <time>{eventTime(event.at)}</time>
        </div>
        <div class="gen-feed-message">{event.message}</div>
        {title ? <div class="gen-feed-title pixel">{title}</div> : null}
        {tagline ? <div class="gen-feed-tagline">{tagline}</div> : null}
        {archetype || heroName ? (
          <div class="gen-feed-chips">
            {archetype ? <span>{archetype}</span> : null}
            {heroName ? <span>Hero: {heroName}</span> : null}
          </div>
        ) : null}
        {details ? <div class="gen-feed-details">“{details}”</div> : null}
        {palette.length ? (
          <div class="gen-feed-palette">
            {palette.map((color, index) => (
              <span key={`${color}-${index}`} style={`background:${color}`} />
            ))}
          </div>
        ) : null}
        {levelNames.length ? <div class="gen-feed-levels">{levelNames.join(' · ')}</div> : null}
        {key || bpm ? (
          <div class="gen-feed-music">
            <Icon name="play" /> {key ?? 'Original key'}
            {bpm ? ` · ${bpm} BPM` : ''}
          </div>
        ) : null}
      </article>
    );
  }

  if (event.kind === 'asset') {
    return (
      <article class="gen-feed-card asset">
        <div class="gen-feed-card-head">
          <span class="gen-feed-icon">
            <Icon name="camera" />
          </span>
          <span>ASSET READY</span>
          <time>{eventTime(event.at)}</time>
        </div>
        {filename ? (
          <img
            src={api.jobAssetUrl(props.jobId, filename)}
            alt={role ? `${role} preview` : 'Generated asset preview'}
            class={`gen-feed-asset ${isCompactGenerationAssetRole(role) ? 'compact' : ''}`}
            onError={(domEvent) => {
              domEvent.currentTarget.hidden = true;
            }}
          />
        ) : null}
        <div class="gen-feed-message">{event.message}</div>
      </article>
    );
  }

  if (event.kind === 'complete') {
    return (
      <article class="gen-feed-card terminal complete">
        <div class="gen-feed-terminal-icon">
          <Icon name="joystick" />
        </div>
        <div class="gen-feed-terminal-label">GAME READY!</div>
        {title ? <div class="gen-feed-title pixel">{title}</div> : null}
        {tagline ? <div class="gen-feed-tagline">{tagline}</div> : null}
        <div class="focusable focused gen-feed-action">
          <Icon name="play" /> Play now
        </div>
      </article>
    );
  }

  if (event.kind === 'failure') {
    const code = textPayload(event, 'code');
    return (
      <article class="gen-feed-card terminal failure">
        <div class="gen-feed-terminal-icon">
          <Icon name="warning" />
        </div>
        <div class="gen-feed-terminal-label">GENERATION FAILED</div>
        <div class="gen-feed-message">{friendly(code ?? 'failed', event.message)}</div>
        {code ? <div class="error-code">CODE: {code.toUpperCase()}</div> : null}
        {props.onRetry ? (
          <button
            type="button"
            class="focusable focused gen-feed-action"
            disabled={props.retrying}
            onClick={props.onRetry}
          >
            <Icon name="refresh" /> {props.retrying ? 'Starting retry…' : 'Retry now'}
          </button>
        ) : (
          <div class="gen-feed-note">This attempt ended here; retry progress continues below.</div>
        )}
        {props.retryError ? <div class="gen-feed-retry-error">{props.retryError}</div> : null}
      </article>
    );
  }

  const waiting = event.payload?.['waitingForNetwork'] === true;
  const slow = event.payload?.['slow'] === true;
  const unitsDone = numberPayload(event, 'unitsDone');
  const unitsTotal = numberPayload(event, 'unitsTotal');
  const unitsLabel =
    unitsTotal !== null && !event.message.includes(`/${unitsTotal}`)
      ? ` (${unitsDone ?? 0}/${unitsTotal})`
      : '';
  return (
    <article class={`gen-feed-card progress ${waiting ? 'waiting' : ''}`}>
      <div class="gen-feed-card-head">
        <span class="gen-feed-icon">
          <Icon name={waiting ? 'warning' : 'dot'} />
        </span>
        <span>{event.stage ? STAGE_LABELS[event.stage] : 'Working'}</span>
        <time>{eventTime(event.at)}</time>
      </div>
      <div class="gen-feed-message">
        {event.message}
        {unitsLabel}
      </div>
      {waiting ? (
        <div class="gen-feed-note">Waiting for network — work resumes automatically.</div>
      ) : null}
      {slow && !waiting ? (
        <div class="gen-feed-note">Taking longer than usual — still working.</div>
      ) : null}
    </article>
  );
}

export function GenerationScreen(props: {
  go: (s: Screen) => void;
  jobId: string;
  gameId: string;
  publicGame?: PublicGameLink;
}): ComponentChildren {
  const [jobEvent, setJobEvent] = useState<JobEvent | null>(null);
  const [events, setEvents] = useState<GenerationFeedEvent[]>([]);
  const [newCount, setNewCount] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const startClock = useRef(Date.now());
  const feedRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const autoScrollingRef = useRef(false);
  const scrollIntentRef = useRef(0);
  const eventRef = useRef<JobEvent | null>(null);
  const retryingRef = useRef(false);
  const newCountRef = useRef(0);
  const priorCountRef = useRef(0);
  const baseElapsed = useRef(0);
  const now = useNow(1000);
  eventRef.current = jobEvent;
  newCountRef.current = newCount;

  const jumpToBottom = useCallback(() => {
    const element = feedRef.current;
    if (!element) return;
    scrollIntentRef.current += 1;
    autoScrollingRef.current = true;
    element.scrollTop = element.scrollHeight;
    followRef.current = true;
    setNewCount(0);
    requestAnimationFrame(() => {
      autoScrollingRef.current = false;
    });
  }, []);

  useEffect(() => {
    let alive = true;
    void api
      .getGenerationFeed(props.jobId)
      .then(({ events: history }) => {
        if (alive) setEvents((current) => mergeGenerationEvents(current, history));
      })
      .catch(() => {});
    const unsubscribe = subscribeJob(props.jobId, (incoming) => {
      if (incoming.type === 'feed') {
        setEvents((current) => mergeGenerationEvents(current, [incoming.event]));
        return;
      }
      baseElapsed.current = incoming.elapsedMs;
      startClock.current = Date.now() - incoming.elapsedMs;
      setJobEvent(incoming);
      if (incoming.type === 'done') shellInput.blip('success');
      if (incoming.type === 'failed') shellInput.blip('error');
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [props.jobId]);

  const startRetry = useCallback(async (): Promise<void> => {
    if (retryingRef.current) return;
    retryingRef.current = true;
    setRetrying(true);
    setRetryError(null);
    shellInput.blip('select');
    try {
      const result = await api.retryGame(props.gameId);
      if (result.jobId !== props.jobId) {
        props.go({
          name: 'generation',
          jobId: result.jobId,
          gameId: props.gameId,
          publicGame: props.publicGame,
        });
        return;
      }
      const current = eventRef.current;
      const costSoFarUsd =
        current?.type === 'failed' || current?.type === 'progress'
          ? current.costSoFarUsd
          : current?.type === 'done'
            ? current.costUsd
            : 0;
      baseElapsed.current = 0;
      startClock.current = Date.now();
      followRef.current = true;
      setNewCount(0);
      setJobEvent({
        type: 'progress',
        jobId: props.jobId,
        stage: 'queued',
        detail: 'Retrying — restoring completed work',
        elapsedMs: 0,
        costSoFarUsd,
      });
      requestAnimationFrame(() => {
        const element = feedRef.current;
        if (element) element.scrollTop = element.scrollHeight;
      });
    } catch (error) {
      shellInput.blip('error');
      setRetryError(error instanceof Error ? error.message : 'Could not start the retry.');
    } finally {
      retryingRef.current = false;
      setRetrying(false);
    }
  }, [props.gameId, props.go, props.jobId, props.publicGame]);

  useEffect(() => {
    const added = Math.max(0, events.length - priorCountRef.current);
    priorCountRef.current = events.length;
    const element = feedRef.current;
    if (!element || added === 0) return;
    if (followRef.current) {
      const scrollIntent = scrollIntentRef.current;
      requestAnimationFrame(() => {
        if (scrollIntent !== scrollIntentRef.current || !followRef.current) return;
        autoScrollingRef.current = true;
        element.scrollTop = element.scrollHeight;
        requestAnimationFrame(() => {
          if (scrollIntent !== scrollIntentRef.current) {
            autoScrollingRef.current = false;
            return;
          }
          followRef.current = true;
          autoScrollingRef.current = false;
          setNewCount(0);
        });
      });
    } else {
      setNewCount((count) => count + added);
    }
  }, [events.length]);

  useEffect(
    () =>
      shellInput.pushHandler((button) => {
        const current = eventRef.current;
        if (button === 'UP' || button === 'DOWN') {
          const element = feedRef.current;
          if (element) {
            scrollIntentRef.current += 1;
            autoScrollingRef.current = false;
            followRef.current =
              button === 'DOWN' &&
              isNearFeedBottom(element.scrollTop, element.clientHeight, element.scrollHeight);
            element.scrollBy({ top: button === 'UP' ? -190 : 190, behavior: 'smooth' });
            shellInput.blip('move');
          }
          return;
        }
        if (button === 'L' || button === 'R') {
          const element = feedRef.current;
          if (element) {
            scrollIntentRef.current += 1;
            autoScrollingRef.current = false;
            followRef.current =
              button === 'R' &&
              isNearFeedBottom(element.scrollTop, element.clientHeight, element.scrollHeight);
            const jump = Math.max(720, Math.round(element.clientHeight * 1.75));
            element.scrollBy({ top: button === 'L' ? -jump : jump, behavior: 'smooth' });
            shellInput.blip('move');
          }
          return;
        }
        const activeGeneration = current === null || current.type === 'progress';
        if (button === 'A' && (activeGeneration || !followRef.current || newCountRef.current > 0)) {
          jumpToBottom();
          shellInput.blip('move');
          return;
        }
        if (current?.type === 'done') {
          if (button === 'A' || button === 'START') {
            shellInput.blip('select');
            props.go({ name: 'play', id: props.gameId });
          } else if (button === 'B') {
            shellInput.blip('back');
            props.go({ name: 'home', id: props.gameId });
          }
          return;
        }
        if (current?.type === 'failed') {
          if (button === 'A') {
            void startRetry();
          } else if (button === 'B') {
            shellInput.blip('back');
            props.go({ name: 'home' });
          }
          return;
        }
        if (button === 'B') {
          shellInput.blip('back');
          props.go({ name: 'home' });
        }
      }),
    [jumpToBottom, props.gameId, props.go, startRetry],
  );

  const elapsed =
    jobEvent?.type === 'done' || jobEvent?.type === 'failed'
      ? baseElapsed.current
      : Math.max(baseElapsed.current, now - startClock.current);
  const stage: JobStage = jobEvent
    ? jobEvent.type === 'progress'
      ? jobEvent.stage
      : jobEvent.type === 'done'
        ? 'done'
        : jobEvent.type === 'failed'
          ? 'failed'
          : 'queued'
    : 'queued';
  const cost =
    jobEvent?.type === 'progress'
      ? jobEvent.costSoFarUsd
      : jobEvent?.type === 'done'
        ? jobEvent.costUsd
        : jobEvent?.type === 'failed'
          ? jobEvent.costSoFarUsd
          : 0;
  const terminal = jobEvent?.type === 'done' || jobEvent?.type === 'failed';
  const shownEvents = events.length
    ? events
    : [
        {
          id: 0,
          jobId: props.jobId,
          gameId: props.gameId,
          attempt: 1,
          kind: 'progress' as const,
          stage,
          message: jobEvent?.type === 'progress' ? jobEvent.detail : 'Loading generation history…',
          at: new Date().toISOString(),
        },
      ];
  const activeFailureId =
    jobEvent?.type === 'failed'
      ? [...events].reverse().find((event) => event.kind === 'failure')?.id
      : undefined;

  return (
    <div class="screen generation-feed-screen">
      <div class="screen-title generation-feed-header">
        <h2 class="pixel">SPARK IS BUILDING</h2>
        <span class="status-chips">
          <span class={`chip gen-state ${stage}`}>
            <Icon name={terminal ? (stage === 'done' ? 'check' : 'warning') : 'dot'} />{' '}
            {STAGE_LABELS[stage]}
          </span>
          <span class="chip">
            <Icon name="timer" /> {fmtElapsed(elapsed)}
          </span>
          <span class="chip cost-ticker">
            {cost === null ? 'cost unavailable' : usd(cost ?? 0)}
          </span>
        </span>
      </div>
      <div
        ref={feedRef}
        class="generation-feed"
        onScroll={(domEvent) => {
          const element = domEvent.currentTarget;
          if (autoScrollingRef.current) return;
          followRef.current = isNearFeedBottom(
            element.scrollTop,
            element.clientHeight,
            element.scrollHeight,
          );
          if (followRef.current) setNewCount(0);
        }}
      >
        {props.publicGame ? (
          <div class="gen-feed-entry public-game-entry">
            <PublicGameQrCard link={props.publicGame} />
          </div>
        ) : null}
        {shownEvents.map((feedEvent, index) => {
          const previousAttempt = index > 0 ? shownEvents[index - 1]!.attempt : feedEvent.attempt;
          return (
            <div key={feedEvent.id || `placeholder-${feedEvent.at}`} class="gen-feed-entry">
              {feedEvent.attempt !== previousAttempt ? (
                <div class="gen-attempt-divider">RETRY {feedEvent.attempt}</div>
              ) : null}
              <FeedCard
                event={feedEvent}
                jobId={props.jobId}
                onRetry={feedEvent.id === activeFailureId ? () => void startRetry() : undefined}
                retrying={feedEvent.id === activeFailureId && retrying}
                retryError={feedEvent.id === activeFailureId ? retryError : null}
              />
            </div>
          );
        })}
        {!terminal ? (
          <div class="gen-feed-live">
            <Icon name="sparkle" class="spin" /> Live updates
          </div>
        ) : null}
      </div>
      {newCount > 0 ? (
        <button
          type="button"
          class="gen-new-updates"
          onClick={() => {
            jumpToBottom();
          }}
        >
          <span class="gen-new-updates-key">A</span>
          {newCount} new {newCount === 1 ? 'update' : 'updates'} ↓
        </button>
      ) : null}
      <FooterLegend
        items={
          jobEvent?.type === 'done'
            ? [
                ['↑/↓', 'Scroll'],
                ['A', 'Play'],
                ['B', 'Details'],
              ]
            : jobEvent?.type === 'failed'
              ? [
                  ['↑/↓', 'Scroll'],
                  ['A', retrying ? 'Starting retry' : 'Retry now'],
                  ['B', 'Menu'],
                ]
              : [
                  ['↑/↓', 'Scroll'],
                  ['B', 'Back (keeps generating)'],
                ]
        }
      />
    </div>
  );
}

function friendly(code: string, message: string): string {
  switch (code) {
    case 'auth':
      return 'The API key is missing or rejected. Set it in the env file and retry.';
    case 'provider-unavailable':
      return 'The model service is having a moment. Retrying later usually works.';
    case 'call-timeout':
      return 'One model step took too long. Retry — completed work and images are preserved.';
    case 'timeout':
      return 'Generation hit the time limit. Retry — cached work makes the next attempt faster.';
    case 'validation-failed':
      return 'The game kept failing safety or playability checks. Retry, or simplify the idea.';
    case 'design-invalid':
      return 'The design pass never produced a valid plan. Retry, or simplify the idea.';
    case 'interrupted':
      return 'The cabinet restarted mid-generation. Retry to pick the idea back up.';
    default:
      return message;
  }
}
