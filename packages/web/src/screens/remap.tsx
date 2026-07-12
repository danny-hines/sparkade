// Control remap wizard: prompts each logical control in order, captures the
// next raw gamepad button / axis direction / key, resolves duplicates
// (Replace / Swap / Try Again), then a test screen where pressed inputs light
// up. START confirms; cancel preserves the prior profile. Fully operable with
// a completely unmapped encoder (directions are captured first and immediately
// used for the wizard's own navigation).
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { LogicalButton } from '@sparkade/shared';
import { api } from '../api';
import { FooterLegend } from '../components';
import { Icon, Btn } from '../icons';
import { shellInput } from '../shell-input';
import type { Screen } from '../app';

const ORDER: { btn: LogicalButton; label: string }[] = [
  { btn: 'UP', label: 'D-pad UP' },
  { btn: 'DOWN', label: 'D-pad DOWN' },
  { btn: 'LEFT', label: 'D-pad LEFT' },
  { btn: 'RIGHT', label: 'D-pad RIGHT' },
  { btn: 'A', label: 'A — confirm / spin jump' },
  { btn: 'B', label: 'B — back / jump' },
  { btn: 'X', label: 'X — run / charge' },
  { btn: 'Y', label: 'Y — run / fire / item' },
  { btn: 'L', label: 'L — shoulder' },
  { btn: 'R', label: 'R — shoulder' },
  { btn: 'START', label: 'START — pause' },
  { btn: 'SELECT', label: 'SELECT — map / misc' },
];

type Phase =
  | { kind: 'intro'; countdown: number }
  | { kind: 'capture'; index: number }
  | { kind: 'duplicate'; index: number; raw: string; owner: LogicalButton; choice: number }
  | { kind: 'test' };

export function RemapScreen(props: {
  go: (s: Screen) => void;
  firstBoot: boolean;
  returnTo: Screen;
  onSaved: () => void;
}): ComponentChildren {
  const [phase, setPhase] = useState<Phase>({ kind: 'intro', countdown: props.firstBoot ? 10 : 0 });
  const [captured, setCaptured] = useState<Map<string, LogicalButton>>(new Map());
  const [lit, setLit] = useState<Set<LogicalButton>>(new Set());
  const capturedRef = useRef(captured);
  capturedRef.current = captured;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const cancelCapture = useRef<(() => void) | null>(null);

  const finish = (save: boolean) => {
    cancelCapture.current?.();
    if (!save) {
      shellInput.blip('back');
      props.go(props.returnTo.name === 'remap' ? { name: 'menu' } : props.returnTo);
      return;
    }
    // Split by device; keep the other device's existing profile.
    const gamepad: Record<string, LogicalButton> = {};
    const keyboard: Record<string, LogicalButton> = {};
    for (const [raw, btn] of capturedRef.current) {
      if (/^(b\d+|a\d+[+-])$/.test(raw)) gamepad[raw] = btn;
      else keyboard[raw] = btn;
    }
    const patch: { gamepad?: typeof gamepad; keyboard?: typeof keyboard } = {};
    if (Object.keys(gamepad).length) patch.gamepad = gamepad;
    if (Object.keys(keyboard).length) patch.keyboard = keyboard;
    void api
      .saveSettings({ input: patch })
      .then(() => {
        props.onSaved();
        shellInput.blip('success');
        props.go(props.returnTo.name === 'remap' ? { name: 'menu' } : props.returnTo);
      })
      .catch(() => {
        shellInput.blip('error');
        props.go(props.returnTo);
      });
  };

  /** Translate a raw id through this session's provisional captures. */
  const provisional = (raw: string): LogicalButton | null => capturedRef.current.get(raw) ?? null;

  // Escape always cancels (dev convenience; harmless in kiosk).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') finish(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Swallow normal logical dispatch while the wizard owns input.
  useEffect(() => shellInput.pushHandler(() => {}), []);

  // Intro: any fresh input starts mapping; on first boot a countdown can skip.
  useEffect(() => {
    if (phase.kind !== 'intro') return undefined;
    const cancel = shellInput.captureNextRaw(() => {
      shellInput.blip('select');
      setPhase({ kind: 'capture', index: 0 });
      setCaptured(new Map());
    });
    cancelCapture.current = cancel;
    let timer: ReturnType<typeof setInterval> | null = null;
    if (props.firstBoot) {
      timer = setInterval(() => {
        setPhase((p) => {
          if (p.kind !== 'intro') return p;
          if (p.countdown <= 1) {
            cancel();
            finish(false); // keep shipped defaults
            return p;
          }
          return { kind: 'intro', countdown: p.countdown - 1 };
        });
      }, 1000);
    }
    return () => {
      cancel();
      if (timer) clearInterval(timer);
    };
  }, [phase.kind === 'intro']);

  // Capture phase: next fresh raw input binds the current logical button.
  useEffect(() => {
    if (phase.kind !== 'capture') return undefined;
    const index = phase.index;
    const cancel = shellInput.captureNextRaw(({ raw }) => {
      const owner = provisional(raw);
      if (owner) {
        shellInput.blip('error');
        setPhase({ kind: 'duplicate', index, raw, owner, choice: 2 }); // default Try Again
        return;
      }
      shellInput.blip('select');
      setCaptured((m) => {
        const next = new Map(m);
        next.set(raw, ORDER[index]!.btn);
        return next;
      });
      if (index + 1 >= ORDER.length) setPhase({ kind: 'test' });
      else setPhase({ kind: 'capture', index: index + 1 });
    });
    cancelCapture.current = cancel;
    return cancel;
  }, [phase.kind === 'capture' ? (phase as { index: number }).index : -1]);

  // Duplicate phase: Replace / Swap / Try Again.
  // Navigation: provisional UP/DOWN move · A/RIGHT confirm · B/LEFT = try again ·
  // pressing the duplicated input again cycles choices (always available).
  useEffect(() => {
    if (phase.kind !== 'duplicate') return undefined;
    const arm = () => {
      const cancel = shellInput.captureNextRaw(({ raw }) => {
        const p = phaseRef.current;
        if (p.kind !== 'duplicate') return;
        const logical = provisional(raw);
        const apply = (choice: number) => {
          const target = ORDER[p.index]!.btn;
          if (choice === 2) {
            shellInput.blip('back');
            setPhase({ kind: 'capture', index: p.index }); // try again
            return;
          }
          setCaptured((m) => {
            const next = new Map(m);
            next.set(p.raw, target); // steal the input
            if (choice === 1) {
              // swap: the previous owner gets re-prompted right now… by walking
              // back to its slot; everything after it stays captured.
              const ownerIx = ORDER.findIndex((o) => o.btn === p.owner);
              // remove any other raw still pointing at target's old binding
              for (const [r, b] of next) if (b === target && r !== p.raw) next.delete(r);
              setPhase({ kind: 'capture', index: ownerIx });
              return next;
            }
            // replace: owner becomes unbound; re-prompt it after the sequence
            setPhase(
              p.index + 1 >= ORDER.length
                ? { kind: 'capture', index: ORDER.findIndex((o) => o.btn === p.owner) }
                : { kind: 'capture', index: p.index + 1 },
            );
            return next;
          });
          shellInput.blip('select');
        };
        if (raw === p.raw) {
          shellInput.blip('move');
          setPhase({ ...p, choice: (p.choice + 1) % 3 });
          arm();
        } else if (logical === 'UP') {
          shellInput.blip('move');
          setPhase({ ...p, choice: (p.choice + 2) % 3 });
          arm();
        } else if (logical === 'DOWN') {
          shellInput.blip('move');
          setPhase({ ...p, choice: (p.choice + 1) % 3 });
          arm();
        } else if (logical === 'A' || logical === 'RIGHT') {
          apply(p.choice);
        } else if (logical === 'B' || logical === 'LEFT') {
          apply(2);
        } else {
          arm(); // unrelated input — keep listening
        }
      });
      cancelCapture.current = cancel;
    };
    arm();
    return () => cancelCapture.current?.();
  }, [phase.kind === 'duplicate']);

  // Test phase: light up pressed inputs through the NEW map; START confirms.
  useEffect(() => {
    if (phase.kind !== 'test') return undefined;
    let raf = 0;
    let startHeldMs = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = now - last;
      last = now;
      const active = new Set<LogicalButton>();
      for (const raw of shellInput.broker.activeRaw()) {
        const b = capturedRef.current.get(raw);
        if (b) active.add(b);
      }
      setLit((old) => (sameSet(old, active) ? old : active));
      if (active.has('START')) {
        startHeldMs += dt;
        if (startHeldMs > 120) {
          cancelAnimationFrame(raf);
          finish(true);
          return;
        }
      } else startHeldMs = 0;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase.kind === 'test']);

  // ------------------------------------------------------------------ render
  if (phase.kind === 'intro') {
    return (
      <div class="screen">
        <div class="center-col">
          <h1 class="pixel" style="font-size:22px">CONTROL SETUP</h1>
          <div style="font-size:22px;max-width:620px">
            {props.firstBoot
              ? 'Let’s learn your buttons before anything needs them.'
              : 'Remap your controls.'}
          </div>
          <div style="color:var(--cyan);font-size:24px;margin-top:10px">Press any button or key to begin</div>
          {props.firstBoot && (
            <div style="color:var(--text-dim);font-size:18px">
              …or wait {phase.countdown}s to keep the default mapping
            </div>
          )}
        </div>
      </div>
    );
  }

  if (phase.kind === 'capture') {
    const item = ORDER[phase.index]!;
    return (
      <div class="screen">
        <div class="remap-prompt">
          <div style="color:var(--text-dim);font-size:19px">
            {phase.index + 1} / {ORDER.length}
          </div>
          <div style="font-size:24px;margin-top:20px">Press the button for</div>
          <div class="big-btn">{item.label}</div>
          <div style="color:var(--text-dim);font-size:17px">gamepad button · joystick direction · or key</div>
        </div>
        <div class="remap-grid">
          {ORDER.map((o, i) => (
            <div key={o.btn} class={`remap-cell ${i < phase.index ? 'lit' : ''}`}>
              <span class="btn-name">{o.btn}</span>
              {i < phase.index ? rawFor(capturedRef.current, o.btn) : i === phase.index ? '…' : ''}
            </div>
          ))}
        </div>
        <FooterLegend items={[['ESC', 'Cancel (keyboard)']]} />
      </div>
    );
  }

  if (phase.kind === 'duplicate') {
    const choices = [
      `Replace — take it from ${phase.owner} (you'll re-bind ${phase.owner} after)`,
      `Swap — give this to ${ORDER[phase.index]!.btn} and re-bind ${phase.owner} now`,
      'Try again — press a different button',
    ];
    return (
      <div class="screen">
        <div class="center-col">
          <div style="font-size:24px;color:var(--gold)">
            That input already belongs to <b>{phase.owner}</b>
          </div>
          <div class="menu-list" style="width:640px">
            {choices.map((c, i) => (
              <div key={i} class={`focusable menu-item ${phase.choice === i ? 'focused' : ''}`} style="font-size:19px">
                {c}
              </div>
            ))}
          </div>
          <div style="color:var(--text-dim);font-size:16px">
            <Icon name="arrowUp" />
            <Icon name="arrowDown" /> choose · <Btn>A</Btn>/<Icon name="arrowRight" /> confirm · same button
            again cycles
          </div>
        </div>
      </div>
    );
  }

  // test
  return (
    <div class="screen">
      <div class="screen-title">
        <h2 class="pixel">TEST YOUR CONTROLS</h2>
      </div>
      <div class="screen-body">
        <div style="text-align:center;color:var(--text-dim);font-size:19px;margin-bottom:8px">
          Press everything — each pad should light up. Press START to save.
        </div>
        <div class="remap-grid">
          {ORDER.map((o) => (
            <div key={o.btn} class={`remap-cell ${lit.has(o.btn) ? 'lit' : ''}`}>
              <span class="btn-name">{o.btn}</span>
              {rawFor(capturedRef.current, o.btn)}
            </div>
          ))}
        </div>
      </div>
      <FooterLegend
        items={[
          ['START', 'Save'],
          ['ESC', 'Cancel'],
        ]}
      />
    </div>
  );
}

function rawFor(map: Map<string, LogicalButton>, btn: LogicalButton): string {
  for (const [raw, b] of map) if (b === btn) return raw;
  return '';
}

function sameSet(a: Set<LogicalButton>, b: Set<LogicalButton>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
