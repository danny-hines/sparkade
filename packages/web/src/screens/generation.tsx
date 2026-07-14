// Generation screen: honest stage checklist driven by the live SSE feed,
// elapsed time, retro flavor lines, running cost ticker. B backs out while the
// job continues; a reload lands right back in the real job state.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { JobEvent, JobStage, SystemInfo } from '@sparkade/shared';
import { api, subscribeJob, type GameDetail } from '../api';
import { FooterLegend, fmtElapsed, usd, useNow } from '../components';
import { Icon, Btn } from '../icons';
import { shellInput } from '../shell-input';
import type { Screen } from '../app';

const nfmt = (n: number): string => n.toLocaleString('en-US');

/** The 16 colours the model chose, as a swatch strip. */
function PaletteStrip(props: { colors: string[] }): ComponentChildren {
  if (!props.colors.length) return null;
  return (
    <span class="gen-palette">
      {props.colors.map((c, i) => (
        <span key={i} class="gen-sw" style={`background:${c}`} />
      ))}
    </span>
  );
}

const STAGES: { id: JobStage; label: string }[] = [
  { id: 'queued', label: 'Queued' },
  { id: 'designing', label: 'Designing the game' },
  { id: 'writing-spec', label: 'Writing levels · entities · music' },
  { id: 'validating', label: 'Validating every rule' },
  { id: 'repairing', label: 'Repairing (only if needed)' },
  { id: 'building-assets', label: 'Baking sprites & saving' },
];

const FLAVOR = [
  'Convincing the boss to monologue…',
  'Teaching walkers to walk…',
  'Tuning the pulse channels…',
  'Painting with all 16 colors…',
  'Hiding a secret in level 2…',
  'Arguing about coyote time…',
  'Polishing the pixels one by one…',
  'Composing a hummable hook…',
  'Placing checkpoints kindly…',
  'Rolling the dice on a seed…',
];

export function GenerationScreen(props: {
  go: (s: Screen) => void;
  jobId: string;
  gameId: string;
}): ComponentChildren {
  const [event, setEvent] = useState<JobEvent | null>(null);
  const [flavorIx, setFlavorIx] = useState(0);
  const [startClock] = useState(Date.now());
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [gd, setGd] = useState<GameDetail | null>(null);
  const eventRef = useRef<JobEvent | null>(null);
  eventRef.current = event;
  const baseElapsed = useRef(0);
  const now = useNow(1000);

  useEffect(() => {
    const unsub = subscribeJob(props.jobId, (e) => {
      if (e.type === 'progress' || e.type === 'done' || e.type === 'failed') {
        baseElapsed.current = e.elapsedMs;
      }
      setEvent(e);
      if (e.type === 'done') shellInput.blip('success');
      if (e.type === 'failed') shellInput.blip('error');
    });
    const flavor = setInterval(() => setFlavorIx((i) => i + 1), 3500);
    return () => {
      unsub();
      clearInterval(flavor);
    };
  }, [props.jobId]);

  // Which model + provider is doing the work (for the "Meta Model API" credit).
  useEffect(() => {
    void api.systemInfo().then(setInfo).catch(() => {});
  }, []);

  // Poll the game detail so we can reveal the model's design (title/tagline/
  // palette) the moment it lands, and tick the live token counter. All from
  // existing endpoints — the SSE feed stays lean.
  useEffect(() => {
    let alive = true;
    const fetchDetail = () => void api.getGame(props.gameId).then((d) => alive && setGd(d)).catch(() => {});
    fetchDetail();
    const t = setInterval(() => {
      const e = eventRef.current;
      if (e?.type === 'done' || e?.type === 'failed') return; // one more fetch happens on transition
      fetchDetail();
    }, 1400);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [props.gameId]);

  // Final refresh once the job settles (accurate final token/cost numbers).
  useEffect(() => {
    if (event?.type === 'done' || event?.type === 'failed') {
      void api.getGame(props.gameId).then(setGd).catch(() => {});
    }
  }, [event?.type, props.gameId]);

  useEffect(
    () =>
      shellInput.pushHandler((btn) => {
        const e = eventRef.current;
        if (e?.type === 'done') {
          if (btn === 'A' || btn === 'START') {
            shellInput.blip('select');
            props.go({ name: 'play', id: props.gameId });
          } else if (btn === 'B') {
            shellInput.blip('back');
            props.go({ name: 'home', id: props.gameId });
          }
          return;
        }
        if (e?.type === 'failed') {
          if (btn === 'A') {
            shellInput.blip('select');
            props.go({ name: 'home', id: props.gameId }); // Retry lives there
          } else if (btn === 'B') {
            shellInput.blip('back');
            props.go({ name: 'home' });
          }
          return;
        }
        if (btn === 'B') {
          // back out — the job keeps running in the background
          shellInput.blip('back');
          props.go({ name: 'home' });
        }
      }),
    [props.go, props.gameId],
  );

  const stage: JobStage = event
    ? event.type === 'progress'
      ? event.stage
      : event.type === 'done'
        ? 'done'
        : 'failed'
    : 'queued';
  const stageIx = STAGES.findIndex((s) => s.id === stage);
  const detail = event?.type === 'progress' ? event.detail : '';
  const cost =
    event?.type === 'progress'
      ? event.costSoFarUsd
      : event?.type === 'done'
        ? event.costUsd
        : event?.type === 'failed'
          ? event.costSoFarUsd
          : 0;
  const elapsed = baseElapsed.current + (event && event.type === 'progress' ? now - startClock - 0 : 0);
  // client clock keeps ticking between SSE frames
  const shownElapsed = Math.max(baseElapsed.current, now - startClock);
  const slow = event?.type === 'progress' && event.slow;
  const waiting = event?.type === 'progress' && event.waitingForNetwork;
  void elapsed;

  // --- Muse Spark showcase (all derived from existing endpoints) ---
  const isMock = info?.provider === 'mock' || info?.model === 'mock';
  const modelName = info ? info.model : 'muse-spark-1.1'; // real model once loaded; 'mock' when mocked
  const modelDisplay = isMock ? 'the mock model' : /muse-spark/i.test(modelName) ? 'Muse Spark' : modelName;
  const providerLabel = isMock ? 'MOCK PROVIDER' : 'META MODEL API';
  const idea = gd?.meta?.sourcePrompt ?? '';
  const gi = gd?.item;
  const designLanded = !!(gi && gi.tagline && gi.tagline !== 'Generating…');
  const palette = gi?.cover?.palette ?? [];
  const usage = gd?.usage ?? [];
  const tokens = usage.reduce((a, u) => a + u.inputTokens + u.outputTokens, 0);
  const cached = usage.reduce((a, u) => a + u.cachedTokens, 0);
  const modelByline = (
    <div class={`gen-byline${isMock ? ' mock' : ''}`}>
      <Icon name="sparkle" /> {providerLabel}
      <span class="gen-model">{modelName}</span>
    </div>
  );

  if (event?.type === 'done') {
    return (
      <div class="screen">
        <div class="center-col">
          <div style="font-size:56px"><Icon name="joystick" /></div>
          <h1 class="pixel" style="color:var(--ok)">GAME READY!</h1>
          {gi && designLanded && (
            <div class="gen-done-card">
              <div class="reveal-title pixel">{gi.title}</div>
              <div class="reveal-tagline">{gi.tagline}</div>
              <PaletteStrip colors={palette} />
            </div>
          )}
          <div style="color:var(--text-dim);font-size:18px">
            {isMock ? 'The mock model' : modelDisplay} built it in {fmtElapsed(event.elapsedMs)} · {usd(event.costUsd)}
            {tokens > 0 ? ` · ${nfmt(tokens)} tokens` : ''}
          </div>
          {!isMock && <div class="gen-byline done"><Icon name="sparkle" /> META MODEL API<span class="gen-model">{modelName}</span></div>}
          <div class="focusable focused" style="padding:16px 44px;font-size:24px;margin-top:16px">
            <Icon name="play" /> Play now
          </div>
        </div>
        <FooterLegend
          items={[
            ['A', 'Play'],
            ['B', 'Details'],
          ]}
        />
      </div>
    );
  }

  if (event?.type === 'failed') {
    return (
      <div class="screen">
        <div class="center-col">
          <div style="font-size:50px"><Icon name="warning" /></div>
          <h1 class="pixel" style="color:var(--danger);font-size:22px">GENERATION FAILED</h1>
          <div style="font-size:19px;max-width:640px;color:var(--text-dim)">{friendly(event.code, event.message)}</div>
          <div class="error-code">CODE: {event.code.toUpperCase()} · STAGE: {event.stage.toUpperCase()}</div>
          <div style="color:var(--text-dim);font-size:17px">
            Spent so far: {usd(event.costSoFarUsd)} — your idea and photo are saved; Retry won't re-record anything.
          </div>
          <div class="focusable focused" style="padding:14px 40px;font-size:22px;margin-top:10px">
            <Icon name="refresh" /> Go to Retry
          </div>
        </div>
        <FooterLegend
          items={[
            ['A', 'Retry screen'],
            ['B', 'Menu'],
          ]}
        />
      </div>
    );
  }

  return (
    <div class="screen">
      <div class="screen-title">
        <h2 class="pixel">GENERATING…</h2>
        <span class="status-chips">
          <span class="chip"><Icon name="timer" /> {fmtElapsed(shownElapsed)}</span>
          <span class="chip cost-ticker">{cost === null ? 'cost unavailable' : `$${(cost ?? 0).toFixed(3)}`}</span>
        </span>
      </div>
      <div class="screen-body" style="display:flex;gap:40px;align-items:center">
        <div class="genstage-list" style="flex:1">
          {STAGES.map((s, i) => {
            const isDone = stageIx > i || (s.id === 'repairing' && stageIx > 4);
            const isActive = stageIx === i;
            if (s.id === 'repairing' && stageIx < 4 && !isActive) {
              return null; // only appears when reached (honesty: it may be skipped)
            }
            return (
              <div key={s.id} class={`genstage ${isDone ? 'done' : ''} ${isActive ? 'active' : ''}`}>
                <span class="tick">{isDone ? <Icon name="check" /> : isActive ? <Icon name="dot" /> : null}</span>
                <span>
                  {s.label}
                  {isActive && event?.type === 'progress' && event.unitsTotal
                    ? ` (${event.unitsDone ?? 0}/${event.unitsTotal})`
                    : ''}
                </span>
              </div>
            );
          })}
        </div>
        <div style="flex:1;display:flex;flex-direction:column;gap:13px">
          {modelByline}
          {idea && <div class="gen-idea">Your idea: “{idea}”</div>}
          {designLanded && gi ? (
            <div class="gen-reveal">
              <div class="gen-reveal-label">{isMock ? 'The mock produced' : 'Muse Spark dreamed up'}</div>
              <div class="reveal-title pixel">{gi.title}</div>
              <div class="reveal-tagline">{gi.tagline}</div>
              <div class="gen-reveal-meta">
                <span class="gen-model">{gi.archetype}</span>
                <PaletteStrip colors={palette} />
              </div>
            </div>
          ) : (
            <div class="flavor-line">{FLAVOR[flavorIx % FLAVOR.length]}</div>
          )}
          <div style="font-size:19px">{detail || 'Warming up…'}</div>
          {tokens > 0 && (
            <div class="gen-tokens">
              <Icon name="sparkle" /> {nfmt(tokens)} tokens processed{cached > 0 ? ` · ${nfmt(cached)} cached` : ''}
            </div>
          )}
          {waiting && (
            <div style="color:var(--danger);font-size:19px">Waiting for network — the job will continue automatically.</div>
          )}
          {slow && !waiting && (
            <div style="color:var(--gold);font-size:18px">Taking longer than usual — still working.</div>
          )}
          <div style="color:var(--text-dim);font-size:16px">
            Press <Btn>B</Btn> to browse or play — generation continues in the background.
          </div>
        </div>
      </div>
      <FooterLegend items={[['B', 'Back (keeps generating)']]} />
    </div>
  );
}

function friendly(code: string, message: string): string {
  switch (code) {
    case 'auth':
      return 'The API key is missing or rejected. Set it in the env file (see README) and retry.';
    case 'provider-unavailable':
      return 'The model service is having a moment (rate limit or outage). Retrying later usually works.';
    case 'call-timeout':
      return 'The model took too long on one step (usually the levels). Retry — this run gives it a longer leash.';
    case 'timeout':
      return 'Generation hit the 8 minute limit. Retry — a fresh run usually lands well under it.';
    case 'validation-failed':
      return 'The model kept producing a game that failed our safety and playability checks. Retry, or reword the idea a little.';
    case 'design-invalid':
      return 'The design pass never produced a valid plan. Retry, or simplify the idea.';
    case 'interrupted':
      return 'The cabinet restarted mid-generation. Retry to pick the idea back up.';
    default:
      return message;
  }
}
