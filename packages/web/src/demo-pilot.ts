// Synthetic input for the library's self-playing demos. A PilotBroker stands in
// for the hardware InputBroker the GameHost expects: it ignores the keyboard/pad
// and instead emits a scripted InputSnapshot each poll, so a game plays itself
// while you browse. The scripts are deliberately "blind" (time-based, no world
// knowledge) — good enough because the demo loops and restarts on death:
//  - shmups actively weave + autofire (enemies supply the action);
//  - the fighter ignores this entirely and runs both sides on its own AI
//    (engine.attract), so its pilot is neutral;
//  - platformer/adventure stay low-risk (idle/short shuffles) so the real world,
//    backdrop and weather read as a living diorama rather than a bot faceplanting.
import { InputBroker, type InputSnapshot } from '@sparkade/engine';
import { LOGICAL_BUTTONS, type ArchetypeId, type LogicalButton } from '@sparkade/shared';

type Held = Partial<Record<LogicalButton, boolean>>;
/** Given elapsed demo seconds, return which buttons are held this frame. */
type Strategy = (t: number) => Held;

const STEP = 1 / 60; // fixed advance per poll; pilot timing needn't be exact

const STRATEGIES: Record<ArchetypeId, Strategy> = {
  // Vertical shmup: hold fire, weave across the bottom, bob a little.
  shooter: (t) => {
    const h: Held = { Y: true };
    const sx = Math.sin(t * 1.7);
    if (sx > 0.3) h.RIGHT = true;
    else if (sx < -0.3) h.LEFT = true;
    const sy = Math.sin(t * 0.9 + 1.2);
    if (sy > 0.6) h.UP = true;
    else if (sy < -0.6) h.DOWN = true;
    return h;
  },
  // Horizontal shmup: hold fire, dodge vertically, drift fore/aft. Blind, so it
  // clips terrain sometimes and restarts — fine for a looping preview.
  hshooter: (t) => {
    const h: Held = { Y: true };
    const sy = Math.sin(t * 2.1);
    if (sy > 0.25) h.DOWN = true;
    else if (sy < -0.25) h.UP = true;
    const sx = Math.sin(t * 0.6);
    if (sx > 0.2) h.RIGHT = true;
    else if (sx < -0.75) h.LEFT = true;
    return h;
  },
  // Side-scroll platformer: low commitment. Short walk bursts (so the run cycle
  // shows) separated by pauses, with the odd hop. Never sprints off a ledge.
  platformer: (t) => {
    const h: Held = {};
    const cycle = t % 5;
    if (cycle < 0.7) h.RIGHT = true;
    else if (cycle > 2.5 && cycle < 3.0) h.LEFT = true;
    if (Math.sin(t * 4) > 0.94) h.A = true; // occasional jump
    return h;
  },
  // Top-down adventure: wander the compass and swing occasionally. No ledges to
  // fall off, so free roaming reads well.
  adventure: (t) => {
    const h: Held = {};
    const dir = (['UP', 'RIGHT', 'DOWN', 'LEFT'] as const)[Math.floor(t / 1.6) % 4]!;
    h[dir] = true;
    if (Math.sin(t * 3.3) > 0.88) h.A = true; // occasional attack
    return h;
  },
  // Fighter self-plays via engine.attract (both actors on AI); pilot stays idle.
  fighter: () => ({}),
};

/** A GameHost-compatible input source that plays `archetype` on autopilot. */
export class PilotBroker extends InputBroker {
  private t = 0;
  private readonly prev: Record<LogicalButton, boolean>;
  private readonly snap: InputSnapshot;
  private readonly strategy: Strategy;

  constructor(archetype: ArchetypeId) {
    super();
    this.strategy = STRATEGIES[archetype] ?? (() => ({}));
    this.prev = {} as Record<LogicalButton, boolean>;
    this.snap = {} as InputSnapshot;
    for (const b of LOGICAL_BUTTONS) {
      this.prev[b] = false;
      this.snap[b] = { held: false, pressed: false, released: false };
    }
  }

  // GameHost polls once per update; we ignore hardware and script the snapshot.
  override poll(): InputSnapshot {
    this.t += STEP;
    const held = this.strategy(this.t);
    for (const b of LOGICAL_BUTTONS) {
      const now = !!held[b];
      const was = this.prev[b];
      const s = this.snap[b];
      s.held = now;
      s.pressed = now && !was;
      s.released = !now && was;
      this.prev[b] = now;
    }
    return this.snap;
  }

  // Nothing to flush — the pilot has no real hardware state.
  override swallow(): void {}
}
