// Durable generation feed. History is loaded from SQLite, new cards arrive by
// SSE, and the player can scroll away from live updates without being yanked
// back to the bottom.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { type GenerationFeedEvent, type JobEvent, type JobStage } from '@sparkade/shared';
import { api, subscribeJob } from '../api';
import { FooterLegend, fmtElapsed, usd, useNow } from '../components';
import { isNearFeedBottom, mergeGenerationEvents } from '../generation-feed';
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

function FeedCard(props: { event: GenerationFeedEvent; jobId: string }): ComponentChildren {
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
            class="gen-feed-asset"
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
        <div class="focusable focused gen-feed-action">
          <Icon name="refresh" /> Go to Retry
        </div>
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
}): ComponentChildren {
  const [jobEvent, setJobEvent] = useState<JobEvent | null>(null);
  const [events, setEvents] = useState<GenerationFeedEvent[]>([]);
  const [newCount, setNewCount] = useState(0);
  const [startClock] = useState(Date.now());
  const feedRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const autoScrollingRef = useRef(false);
  const eventRef = useRef<JobEvent | null>(null);
  const priorCountRef = useRef(0);
  const baseElapsed = useRef(0);
  const now = useNow(1000);
  eventRef.current = jobEvent;

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
      setJobEvent(incoming);
      if (incoming.type === 'done') shellInput.blip('success');
      if (incoming.type === 'failed') shellInput.blip('error');
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [props.jobId]);

  useEffect(() => {
    const added = Math.max(0, events.length - priorCountRef.current);
    priorCountRef.current = events.length;
    const element = feedRef.current;
    if (!element || added === 0) return;
    if (followRef.current) {
      requestAnimationFrame(() => {
        autoScrollingRef.current = true;
        element.scrollTop = element.scrollHeight;
        requestAnimationFrame(() => {
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
          if (button === 'UP') followRef.current = false;
          feedRef.current?.scrollBy({ top: button === 'UP' ? -190 : 190, behavior: 'smooth' });
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
            shellInput.blip('select');
            props.go({ name: 'home', id: props.gameId });
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
    [props.gameId, props.go],
  );

  const elapsed = Math.max(baseElapsed.current, now - startClock);
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
        {shownEvents.map((feedEvent, index) => {
          const previousAttempt = index > 0 ? shownEvents[index - 1]!.attempt : feedEvent.attempt;
          return (
            <div key={feedEvent.id || `placeholder-${feedEvent.at}`} class="gen-feed-entry">
              {feedEvent.attempt !== previousAttempt ? (
                <div class="gen-attempt-divider">RETRY {feedEvent.attempt}</div>
              ) : null}
              <FeedCard event={feedEvent} jobId={props.jobId} />
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
            const element = feedRef.current;
            if (element) {
              autoScrollingRef.current = true;
              element.scrollTop = element.scrollHeight;
              requestAnimationFrame(() => {
                autoScrollingRef.current = false;
              });
            }
            followRef.current = true;
            setNewCount(0);
          }}
        >
          {newCount} new {newCount === 1 ? 'update' : 'updates'} ↓
        </button>
      ) : null}
      <FooterLegend
        items={
          jobEvent?.type === 'done'
            ? [
                ['↑ ↓', 'Scroll'],
                ['A', 'Play'],
                ['B', 'Details'],
              ]
            : jobEvent?.type === 'failed'
              ? [
                  ['↑ ↓', 'Scroll'],
                  ['A', 'Retry screen'],
                  ['B', 'Menu'],
                ]
              : [
                  ['↑ ↓', 'Scroll'],
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
