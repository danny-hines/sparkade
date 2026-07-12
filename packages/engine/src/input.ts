// One InputBroker normalizes gamepad polling AND keyboard events (some encoder
// clones enumerate as keyboards) into a single logical control state with edge
// detection. The shell and archetypes only ever see logical buttons.
import {
  DEFAULT_GAMEPAD_MAP,
  DEFAULT_KEYBOARD_MAP,
  LOGICAL_BUTTONS,
  MENU_REPEAT_DELAY_MS,
  MENU_REPEAT_INTERVAL_MS,
  type LogicalButton,
} from '@sparkade/shared';
import type { ButtonState, InputSnapshot } from './types';

/**
 * Raw input ids used by mapping configs and the remap wizard:
 *   keyboard: the KeyboardEvent.code (e.g. "KeyX", "ArrowUp")
 *   gamepad button: "b<index>" (e.g. "b0")
 *   gamepad axis direction: "a<index>+" / "a<index>-" (threshold 0.5)
 */
export type RawInputId = string;

const AXIS_THRESHOLD = 0.5;

function emptySnapshot(): InputSnapshot {
  const s = {} as InputSnapshot;
  for (const b of LOGICAL_BUTTONS) s[b] = { held: false, pressed: false, released: false };
  return s;
}

export class InputBroker {
  private keyboardMap: Record<string, LogicalButton>;
  private gamepadMap: Record<string, LogicalButton>;

  /** Raw keyboard codes currently down. */
  private keysDown = new Set<string>();
  /** Codes pressed since the last poll — guarantees ultra-fast taps still register one frame. */
  private keysLatched = new Set<string>();
  /** Logical state from the previous poll, for edge detection. */
  private prevHeld = {} as Record<LogicalButton, boolean>;
  private snapshot: InputSnapshot = emptySnapshot();
  /** Buttons swallowed across a screen transition until physically released. */
  private swallowed = new Set<LogicalButton>();
  private swallowedRaw = new Set<RawInputId>();

  private keydownHandler = (e: KeyboardEvent) => {
    // Never let the browser scroll/act on game keys.
    if (this.keyboardMap[e.code] || e.code.startsWith('Arrow')) e.preventDefault();
    this.keysDown.add(e.code);
    this.keysLatched.add(e.code);
  };
  private keyupHandler = (e: KeyboardEvent) => {
    this.keysDown.delete(e.code);
  };
  private blurHandler = () => {
    this.keysDown.clear();
  };

  constructor(opts?: {
    keyboardMap?: Record<string, LogicalButton>;
    gamepadMap?: Record<string, LogicalButton>;
  }) {
    this.keyboardMap = { ...DEFAULT_KEYBOARD_MAP, ...(opts?.keyboardMap ?? {}) };
    this.gamepadMap = this.normalizeGamepadMap(opts?.gamepadMap);
    for (const b of LOGICAL_BUTTONS) this.prevHeld[b] = false;
  }

  /** Accepts legacy numeric keys ("0") as button indices as well as "b0"/"a0+". */
  private normalizeGamepadMap(map?: Record<string, LogicalButton>): Record<string, LogicalButton> {
    const source =
      map && Object.keys(map).length > 0
        ? map
        : Object.fromEntries(
            Object.entries(DEFAULT_GAMEPAD_MAP).map(([i, b]) => [`b${i}`, b] as const),
          );
    const out: Record<string, LogicalButton> = {};
    for (const [k, v] of Object.entries(source)) out[/^\d+$/.test(k) ? `b${k}` : k] = v;
    return out;
  }

  setMaps(keyboardMap: Record<string, LogicalButton>, gamepadMap: Record<string, LogicalButton>) {
    if (Object.keys(keyboardMap).length > 0) this.keyboardMap = keyboardMap;
    this.gamepadMap = this.normalizeGamepadMap(gamepadMap);
  }

  attach(target: Window = window): void {
    target.addEventListener('keydown', this.keydownHandler);
    target.addEventListener('keyup', this.keyupHandler);
    target.addEventListener('blur', this.blurHandler);
  }

  detach(target: Window = window): void {
    target.removeEventListener('keydown', this.keydownHandler);
    target.removeEventListener('keyup', this.keyupHandler);
    target.removeEventListener('blur', this.blurHandler);
  }

  /** All raw inputs currently active (for the remap wizard + remap hold trigger). */
  activeRaw(): RawInputId[] {
    const raw: RawInputId[] = [...this.keysDown];
    for (const gp of this.gamepads()) {
      gp.buttons.forEach((btn, i) => {
        if (btn.pressed) raw.push(`b${i}`);
      });
      gp.axes.forEach((v, i) => {
        if (v >= AXIS_THRESHOLD) raw.push(`a${i}+`);
        if (v <= -AXIS_THRESHOLD) raw.push(`a${i}-`);
      });
    }
    return raw.filter((r) => !this.swallowedRaw.has(r));
  }

  /** True if any gamepad is currently connected. */
  hasGamepad(): boolean {
    return this.gamepads().length > 0;
  }

  private gamepads(): Gamepad[] {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return [];
    const list: Gamepad[] = [];
    for (const gp of navigator.getGamepads()) if (gp && gp.connected) list.push(gp);
    return list;
  }

  /** Poll once per fixed update. Computes held/pressed/released for every logical button. */
  poll(): InputSnapshot {
    const heldNow = {} as Record<LogicalButton, boolean>;
    for (const b of LOGICAL_BUTTONS) heldNow[b] = false;

    for (const code of this.keysDown) {
      const btn = this.keyboardMap[code];
      if (btn) heldNow[btn] = true;
    }
    for (const code of this.keysLatched) {
      const btn = this.keyboardMap[code];
      if (btn) heldNow[btn] = true;
    }
    this.keysLatched.clear();
    for (const gp of this.gamepads()) {
      gp.buttons.forEach((button, i) => {
        if (!button.pressed) return;
        const btn = this.gamepadMap[`b${i}`];
        if (btn) heldNow[btn] = true;
      });
      gp.axes.forEach((v, i) => {
        if (v >= AXIS_THRESHOLD) {
          const btn = this.gamepadMap[`a${i}+`];
          if (btn) heldNow[btn] = true;
        } else if (v <= -AXIS_THRESHOLD) {
          const btn = this.gamepadMap[`a${i}-`];
          if (btn) heldNow[btn] = true;
        }
      });
    }

    // Release swallowed buttons once they are physically up.
    for (const b of [...this.swallowed]) if (!heldNow[b]) this.swallowed.delete(b);
    // Same for raw swallows (remap wizard).
    if (this.swallowedRaw.size) {
      const rawActive = new Set<string>();
      for (const code of this.keysDown) rawActive.add(code);
      for (const gp of this.gamepads()) {
        gp.buttons.forEach((btn, i) => btn.pressed && rawActive.add(`b${i}`));
        gp.axes.forEach((v, i) => {
          if (v >= AXIS_THRESHOLD) rawActive.add(`a${i}+`);
          if (v <= -AXIS_THRESHOLD) rawActive.add(`a${i}-`);
        });
      }
      for (const r of [...this.swallowedRaw]) if (!rawActive.has(r)) this.swallowedRaw.delete(r);
    }

    for (const b of LOGICAL_BUTTONS) {
      const held = heldNow[b] && !this.swallowed.has(b);
      const was = this.prevHeld[b];
      const state: ButtonState = this.snapshot[b];
      state.held = held;
      state.pressed = held && !was;
      state.released = !held && was;
      this.prevHeld[b] = held;
    }
    return this.snapshot;
  }

  /** Current snapshot without re-polling. */
  state(): InputSnapshot {
    return this.snapshot;
  }

  /**
   * Swallow everything currently held: used across screen transitions so a held
   * button doesn't leak into the next screen until physically released.
   */
  swallow(): void {
    for (const b of LOGICAL_BUTTONS) {
      if (this.prevHeld[b]) {
        this.swallowed.add(b);
        this.prevHeld[b] = false;
        const s = this.snapshot[b];
        s.held = false;
        s.pressed = false;
        s.released = false;
      }
    }
    for (const r of this.activeRaw()) this.swallowedRaw.add(r);
  }
}

/**
 * D-pad auto-repeat for menus: first repeat after ~350 ms, then every ~100 ms.
 * Face buttons never repeat. Use one instance per screen.
 */
export class MenuRepeater {
  private heldSince = new Map<LogicalButton, number>();
  private lastFire = new Map<LogicalButton, number>();

  /** Returns true when the button should "fire" this frame (initial press or repeat). */
  fires(input: InputSnapshot, b: LogicalButton, now: number = performance.now()): boolean {
    const s = input[b];
    if (!s.held) {
      this.heldSince.delete(b);
      this.lastFire.delete(b);
      return false;
    }
    if (s.pressed) {
      this.heldSince.set(b, now);
      this.lastFire.set(b, now);
      return true;
    }
    const since = this.heldSince.get(b);
    if (since === undefined) {
      // Held when the screen opened (or swallow released mid-hold): treat as fresh.
      this.heldSince.set(b, now);
      this.lastFire.set(b, now);
      return false;
    }
    if (now - since < MENU_REPEAT_DELAY_MS) return false;
    const last = this.lastFire.get(b) ?? now;
    if (now - last >= MENU_REPEAT_INTERVAL_MS) {
      this.lastFire.set(b, now);
      return true;
    }
    return false;
  }
}
