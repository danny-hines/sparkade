// SFX synthesizer: renders parameter sets offline into cached AudioBuffers at
// game load. Spec overrides merge over engine defaults; the seed drives subtle
// per-play pitch variation on gameplay events (never UI events).
import type { SfxBlock, SfxEvent } from '@sparkade/shared';
import type { Rng } from '../rng';
import type { AudioSys } from './audio';
import { DEFAULT_SFX, renderSfx, SFX_SAMPLE_RATE } from './sfx-render';

const UI_EVENTS: ReadonlySet<string> = new Set(['uiMove', 'uiSelect', 'uiBack']);

export class SfxSynth {
  private buffers = new Map<string, AudioBuffer>();

  constructor(
    private audio: AudioSys,
    private overrides: SfxBlock = {},
    private rng: Rng | null = null,
  ) {}

  /** Render every event's buffer up front (call at game load). */
  bake(): void {
    const ctx = this.audio.context();
    for (const event of Object.keys(DEFAULT_SFX)) {
      const params = this.overrides[event as SfxEvent] ?? DEFAULT_SFX[event]!;
      const samples = renderSfx(params, SFX_SAMPLE_RATE);
      const buf = ctx.createBuffer(1, samples.length, SFX_SAMPLE_RATE);
      buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
      this.buffers.set(event, buf);
    }
  }

  play(event: SfxEvent | string, opts: { gain?: number } = {}): void {
    let buf = this.buffers.get(event);
    if (!buf) {
      // Lazy bake (e.g. shell UI blips before any game loads).
      const params = this.overrides[event as SfxEvent] ?? DEFAULT_SFX[event];
      if (!params) return;
      const samples = renderSfx(params, SFX_SAMPLE_RATE);
      const ctx = this.audio.context();
      buf = ctx.createBuffer(1, samples.length, SFX_SAMPLE_RATE);
      buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
      this.buffers.set(event, buf);
    }
    const isUi = UI_EVENTS.has(event);
    let rate = 1;
    if (!isUi && this.rng) {
      // ±60 cents of seed-driven variation keeps repeated SFX lively.
      rate = Math.pow(2, this.rng.range(-0.6, 0.6) / 12);
    }
    this.audio.playBuffer(buf, isUi ? this.audio.uiBus : this.audio.sfxBus, {
      playbackRate: rate,
      gain: opts.gain,
    });
  }
}
