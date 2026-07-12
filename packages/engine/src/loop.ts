/**
 * Fixed-timestep game loop: update at exactly 60 Hz with an accumulator
 * (clamped to 3 updates per frame to avoid the spiral of death), render once
 * per requestAnimationFrame.
 */
export const STEP = 1 / 60;
const MAX_UPDATES_PER_FRAME = 3;

export interface LoopCallbacks {
  update(dt: number): void;
  render(): void;
}

export class GameLoop {
  private raf = 0;
  private last = 0;
  private acc = 0;
  private running = false;

  /** Rolling render-FPS estimate for the debug overlay / particle degradation. */
  fps = 60;
  private fpsAcc = 0;
  private fpsFrames = 0;

  constructor(private cb: LoopCallbacks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    const tick = (now: number) => {
      if (!this.running) return;
      let elapsed = (now - this.last) / 1000;
      this.last = now;
      // Tab was hidden / long stall: don't try to catch up more than a few steps.
      if (elapsed > 0.25) elapsed = 0.25;
      this.acc += elapsed;
      let updates = 0;
      while (this.acc >= STEP && updates < MAX_UPDATES_PER_FRAME) {
        this.cb.update(STEP);
        this.acc -= STEP;
        updates++;
      }
      if (this.acc >= STEP) this.acc = 0; // drop the backlog instead of spiraling
      this.cb.render();
      this.fpsAcc += elapsed;
      this.fpsFrames++;
      if (this.fpsAcc >= 0.5) {
        this.fps = this.fpsFrames / this.fpsAcc;
        this.fpsAcc = 0;
        this.fpsFrames = 0;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}
