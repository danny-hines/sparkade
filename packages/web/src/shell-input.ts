// Shell input layer: wraps the engine's InputBroker in a rAF loop that emits
// logical button events to the focused screen, with menu auto-repeat on the
// d-pad, transition swallowing, raw capture for the remap wizard, the 5s
// hold-to-remap trigger, and full suspension while a game owns the broker.
import { AudioSys, InputBroker, MenuRepeater, SfxSynth } from '@sparkade/engine';
import { LOGICAL_BUTTONS, REMAP_HOLD_MS, type LogicalButton } from '@sparkade/shared';

export type ShellButtonHandler = (btn: LogicalButton) => void;

export interface RawCapture {
  raw: string;
  kind: 'keyboard' | 'gamepad';
}

class ShellInputImpl {
  readonly broker = new InputBroker();
  readonly audio = new AudioSys();
  readonly uiSfx = new SfxSynth(this.audio, {});

  private handlers: ShellButtonHandler[] = [];
  /** Modal handlers always outrank screen handlers, no matter the push order. */
  private modalHandlers: ShellButtonHandler[] = [];
  private repeater = new MenuRepeater();
  private suspended = false;
  private raf = 0;
  private started = false;

  // remap hold trigger (single input held steady in shell menus)
  private holdRaw: string | null = null;
  private holdSince = 0;
  private holdEnabled = true;
  onRemapHoldProgress: ((ms: number | null) => void) | null = null;
  onRemapHoldFire: (() => void) | null = null;

  // raw capture mode (remap wizard)
  private capture: ((c: RawCapture) => void) | null = null;
  private prevRaw = new Set<string>();

  onAnyInput: (() => void) | null = null;

  start(): void {
    if (this.started) return;
    this.started = true;
    this.broker.attach(window);
    window.addEventListener('pointerdown', () => this.audio.resume(), { once: true });
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      if (this.suspended) return;
      const snap = this.broker.poll();
      const rawActive = this.broker.activeRaw();

      if (rawActive.length > 0) {
        this.onAnyInput?.();
        this.audio.resume(); // autoplay fallback: first d-pad/button press unlocks audio
      }

      // ---- raw capture mode (remap wizard) --------------------------------
      if (this.capture) {
        for (const raw of rawActive) {
          if (!this.prevRaw.has(raw)) {
            const cb = this.capture;
            this.capture = null;
            this.broker.swallow();
            this.prevRaw = new Set(this.broker.activeRaw());
            cb({ raw, kind: raw.startsWith('b') || raw.startsWith('a') ? 'gamepad' : 'keyboard' });
            return;
          }
        }
        this.prevRaw = new Set(rawActive);
        return; // capture mode consumes everything
      }
      this.prevRaw = new Set(rawActive);

      // ---- 5s single-input hold → remap wizard ----------------------------
      // Suppressed while a modal is open (hold-to-confirm dialogs own long holds).
      if (this.holdEnabled && this.modalHandlers.length === 0) {
        if (rawActive.length === 1) {
          const raw = rawActive[0]!;
          if (this.holdRaw !== raw) {
            this.holdRaw = raw;
            this.holdSince = performance.now();
          }
          const heldMs = performance.now() - this.holdSince;
          this.onRemapHoldProgress?.(heldMs >= 2000 ? heldMs : null);
          if (heldMs >= REMAP_HOLD_MS) {
            this.holdRaw = null;
            this.onRemapHoldProgress?.(null);
            this.broker.swallow();
            this.onRemapHoldFire?.();
            return;
          }
        } else {
          if (this.holdRaw !== null) this.onRemapHoldProgress?.(null);
          this.holdRaw = null;
        }
      }

      // ---- logical dispatch ------------------------------------------------
      for (const btn of LOGICAL_BUTTONS) {
        const directional = btn === 'UP' || btn === 'DOWN' || btn === 'LEFT' || btn === 'RIGHT';
        const fire = directional ? this.repeater.fires(snap, btn) : snap[btn].pressed;
        if (fire) {
          const top =
            this.modalHandlers[this.modalHandlers.length - 1] ??
            this.handlers[this.handlers.length - 1];
          top?.(btn);
        }
      }
    };
    this.raf = requestAnimationFrame(tick);
  }

  /**
   * Screens push a handler on mount and pop on unmount. Pass modal: true for
   * dialog handlers — they stay on top even when the screen underneath
   * re-registers its handler on a state change.
   */
  pushHandler(h: ShellButtonHandler, opts: { modal?: boolean } = {}): () => void {
    const list = opts.modal ? this.modalHandlers : this.handlers;
    list.push(h);
    return () => {
      const ix = list.lastIndexOf(h);
      if (ix >= 0) list.splice(ix, 1);
    };
  }

  /** Swallow held inputs across a screen transition. */
  swallow(): void {
    this.broker.swallow();
  }

  /** Hand the broker to a GameHost (gameplay) and back. */
  setSuspended(v: boolean): void {
    this.suspended = v;
    if (!v) {
      this.broker.swallow();
      this.prevRaw = new Set();
      this.holdRaw = null;
      // The shell saw zero input while a game owned the broker — without this,
      // a long play session reads as "idle" and bounces the player to Attract
      // moments after they return to a menu.
      this.onAnyInput?.();
    }
  }

  /** Enable/disable the 5s remap hold (disabled during gameplay & the wizard itself). */
  setRemapHoldEnabled(v: boolean): void {
    this.holdEnabled = v;
    if (!v) this.holdRaw = null;
  }

  /** Next fresh raw input goes to cb (remap wizard). Returns a cancel function. */
  captureNextRaw(cb: (c: RawCapture) => void): () => void {
    this.prevRaw = new Set(this.broker.activeRaw());
    this.capture = cb;
    return () => {
      if (this.capture === cb) this.capture = null;
    };
  }

  setMaps(keyboard: Record<string, LogicalButton>, gamepad: Record<string, LogicalButton>): void {
    this.broker.setMaps(keyboard, gamepad);
  }

  blip(kind: 'move' | 'select' | 'back' | 'error' | 'success'): void {
    const event =
      kind === 'move'
        ? 'uiMove'
        : kind === 'select'
          ? 'uiSelect'
          : kind === 'back'
            ? 'uiBack'
            : kind === 'success'
              ? 'powerup'
              : 'lose';
    try {
      this.uiSfx.play(event, { gain: kind === 'error' || kind === 'success' ? 0.5 : 1 });
    } catch {
      /* audio not ready yet (pre-gesture without kiosk flag) */
    }
  }

  setVolumes(v: { musicVol: number; sfxVol: number; uiVol: number }): void {
    this.audio.setVolumes(v);
  }
}

export const shellInput = new ShellInputImpl();
