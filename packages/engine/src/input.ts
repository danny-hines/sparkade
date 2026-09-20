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

/** Native hosts can supply gamepad state without replacing browser APIs. */
export interface ExternalGamepadState {
  buttons: readonly boolean[];
  axes: readonly number[];
}

type PolledGamepad = { buttons: readonly { pressed: boolean }[]; axes: readonly number[] };

const AXIS_THRESHOLD = 0.5;

/**
 * The broker is attached to window, so keyboard events from ordinary form
 * controls reach it too. Those controls must keep ownership of their keys:
 * preventing a mapped KeyA/KeyS/etc. event also prevents the character from
 * being entered, while swallowing arrows breaks selects and range inputs.
 *
 * Keep this structural so it is safe to exercise in the engine's Node tests
 * without requiring a browser DOM implementation.
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const element = target as EventTarget & {
    tagName?: unknown;
    isContentEditable?: unknown;
  };
  if (element.isContentEditable === true) return true;
  if (typeof element.tagName !== 'string') return false;
  return ['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName.toUpperCase());
}

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
  private virtual = new Map<string, LogicalButton>();
  private virtualLatched = new Set<LogicalButton>();
  private externalGamepads = new Map<string, PolledGamepad>();
  private externalLatched = new Map<string, Set<RawInputId>>();
  /** Codes pressed since the last poll — guarantees ultra-fast taps still register one frame. */
  private keysLatched = new Set<string>();
  /** Logical state from the previous poll, for edge detection. */
  private prevHeld = {} as Record<LogicalButton, boolean>;
  private snapshot: InputSnapshot = emptySnapshot();
  private physicalHeld: Partial<Record<LogicalButton, boolean>> = {};
  /** Buttons swallowed across a screen transition until physically released. */
  private swallowed = new Set<LogicalButton>();
  private swallowedRaw = new Set<RawInputId>();

  private keydownHandler = (e: KeyboardEvent) => {
    if (isTextEntryTarget(e.target)) {
      // A repeat event can arrive after focus moves while a game key is held.
      // Clear both stores so editing a field can never leave gameplay input stuck.
      this.keysDown.delete(e.code);
      this.keysLatched.delete(e.code);
      return;
    }
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
    this.keysLatched.clear();
    this.releaseVirtualInputs();
    this.externalGamepads.clear();
    this.externalLatched.clear();
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

  /** Independent pointer/accessibility sources merge with physical controls. */
  setVirtualButton(source: string, button: LogicalButton, held: boolean): void {
    if (held) {
      this.virtual.set(source, button);
      this.virtualLatched.add(button);
    } else this.virtual.delete(source);
  }

  releaseVirtualInputs(): void {
    this.virtual.clear();
    this.virtualLatched.clear();
  }

  /** Raw buttons/axes retain saved mappings, hold-to-remap, and game escape. */
  setExternalGamepad(source: string, state: ExternalGamepadState | null): void {
    if (!state) {
      this.externalGamepads.delete(source);
      this.externalLatched.delete(source);
      return;
    }
    this.externalGamepads.set(source, {
      buttons: state.buttons.map((pressed) => ({ pressed })),
      axes: [...state.axes],
    });
    const latched = this.externalLatched.get(source) ?? new Set<RawInputId>();
    state.buttons.forEach((pressed, i) => {
      if (pressed) latched.add(`b${i}`);
    });
    state.axes.forEach((value, i) => {
      if (value >= AXIS_THRESHOLD) latched.add(`a${i}+`);
      if (value <= -AXIS_THRESHOLD) latched.add(`a${i}-`);
    });
    this.externalLatched.set(source, latched);
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

  private gamepads(): PolledGamepad[] {
    const list: PolledGamepad[] = [...this.externalGamepads.values()];
    if (typeof navigator !== 'undefined' && navigator.getGamepads) {
      for (const gp of navigator.getGamepads()) if (gp && gp.connected) list.push(gp);
    }
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

    for (const latched of this.externalLatched.values()) {
      for (const raw of latched) {
        const button = this.gamepadMap[raw];
        if (button) heldNow[button] = true;
      }
      latched.clear();
    }
    for (const button of this.virtual.values()) heldNow[button] = true;
    for (const button of this.virtualLatched) heldNow[button] = true;
    this.virtualLatched.clear();
    this.physicalHeld = heldNow;
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

  /** Last poll before transition suppression; only global hold-to-exit uses this. */
  physicallyHeld(button: LogicalButton): boolean {
    return this.physicalHeld[button] ?? false;
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
