// Shared WebAudio graph: master gain -> soft compressor -> destination, with
// music/sfx/ui buses and a hard voice budget (8 simultaneous incl. SFX).
import { BUDGET } from '@sparkade/shared';

export class AudioSys {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private compressor!: DynamicsCompressorNode;
  musicBus!: GainNode;
  sfxBus!: GainNode;
  uiBus!: GainNode;
  /** Extra gain used for jingle ducking, in series with musicBus. */
  duckGain!: GainNode;
  /** Jingles play here: music volume, but NOT ducked (they sit on top). */
  jingleBus!: GainNode;

  private volumes = { musicVol: 0.7, sfxVol: 0.8, uiVol: 0.4 };
  private activeVoices = 0;

  /** Lazily create the context (autoplay flag makes this work pre-gesture in kiosk). */
  context(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: 44100 });
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -18;
      this.compressor.knee.value = 20;
      this.compressor.ratio.value = 4;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.2;
      this.master.connect(this.compressor);
      this.compressor.connect(this.ctx.destination);

      this.duckGain = this.ctx.createGain();
      this.duckGain.connect(this.master);
      this.musicBus = this.ctx.createGain();
      this.musicBus.connect(this.duckGain);
      this.jingleBus = this.ctx.createGain();
      this.jingleBus.connect(this.master);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.connect(this.master);
      this.uiBus = this.ctx.createGain();
      this.uiBus.connect(this.master);
      this.applyVolumes();
    }
    return this.ctx;
  }

  /** Fallback for autoplay policies: call from the first input event. */
  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolumes(v: { musicVol: number; sfxVol: number; uiVol: number }): void {
    this.volumes = { ...v };
    if (this.ctx) this.applyVolumes();
  }

  getVolumes() {
    return { ...this.volumes };
  }

  private applyVolumes(): void {
    this.musicBus.gain.value = this.volumes.musicVol;
    this.jingleBus.gain.value = this.volumes.musicVol;
    this.sfxBus.gain.value = this.volumes.sfxVol;
    this.uiBus.gain.value = this.volumes.uiVol;
  }

  /**
   * Voice accounting. Callers claim before starting a source and MUST arrange
   * release (the helper wires `ended`). Returns false when the budget is spent —
   * caller should skip the sound rather than exceed the cap.
   */
  claimVoice(): boolean {
    if (this.activeVoices >= BUDGET.maxAudioVoices) return false;
    this.activeVoices++;
    return true;
  }

  releaseVoice(): void {
    this.activeVoices = Math.max(0, this.activeVoices - 1);
  }

  voicesInUse(): number {
    return this.activeVoices;
  }

  /** Play an AudioBuffer on a bus with voice accounting. */
  playBuffer(
    buffer: AudioBuffer,
    bus: GainNode,
    opts: { playbackRate?: number; gain?: number } = {},
  ): void {
    if (!this.claimVoice()) return;
    const ctx = this.context();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = opts.playbackRate ?? 1;
    let node: AudioNode = src;
    if (opts.gain !== undefined && opts.gain !== 1) {
      const g = ctx.createGain();
      g.gain.value = opts.gain;
      src.connect(g);
      node = g;
    }
    node.connect(bus);
    src.onended = () => {
      this.releaseVoice();
      src.disconnect();
      if (node !== src) node.disconnect();
    };
    src.start();
  }

  dispose(): void {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
      this.activeVoices = 0;
    }
  }
}
