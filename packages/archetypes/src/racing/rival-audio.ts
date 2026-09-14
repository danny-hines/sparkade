// The race soundscape owns at most three continuous sources: the player,
// boost roar, and up to two nearby rivals. Four music voices and one transient
// still fit the shared eight-voice budget. No physics or player assists here.
import type {
  RacingDiscipline,
  RacingEngineProfile,
  RacingTraversal,
} from '@sparkade/shared';
import { HoverEngine, type HoverEngineCaps, type HoverEngineState } from './audio';
import {
  LEGACY_RIVAL,
  normalizeEngineDiscipline,
  renderEngineNoise,
  resolveEngineProfile,
  type ResolvedEngineProfile,
} from './sound-profile';
import {
  isLegacyTraversal,
  rivalHumanGain,
  rivalMagicGain,
  traversalOnWater,
  traversalPropulsion,
} from './traversal-audio';

export interface AudibleRacer {
  s: number;
  x: number;
  speed: number;
  finished: boolean;
}
export interface RivalSound {
  index: number;
  distance: number;
  pan: number;
  gain: number;
  pitchHz: number;
}

/**
 * Shortest physical gap on the closed course, including the finish seam.
 * The optional profile voices this rival's timbre (identity-derived);
 * omit it for the exact legacy pitch. The optional traversal selects the
 * composable propulsion voice (absent/null keeps the exact legacy motor
 * path): motor reuses family/tone/pitch with the traversal surface
 * engine; human returns quiet rolling/footfall gain (silent at rest,
 * never an idle engine); magic returns a restrained shimmer (silent at
 * rest). Distance envelope, seam, pan, and doppler rules never change;
 * label is never consulted.
 */
export function rivalSound(
  player: AudibleRacer,
  rival: AudibleRacer,
  index: number,
  length: number,
  profile?: RacingEngineProfile | null,
  discipline?: RacingDiscipline | null,
  traversal?: RacingTraversal | null,
): RivalSound | null {
  if (rival.finished || !(length > 0)) return null;
  const ds = ((((rival.s - player.s + length / 2) % length) + length) % length) - length / 2;
  const dx = rival.x - player.x;
  const distance = Math.hypot(ds, dx);
  if (distance >= 110) return null;
  const envelope = (1 - distance / 110) ** 2;
  const motion = Math.min(1, Math.abs(rival.speed) / 45);
  const closing = Math.sign(ds) * (player.speed - rival.speed);
  const doppler = 1 + Math.max(-0.065, Math.min(0.065, closing / 500));
  const ratio = resolveEngineProfile(profile ?? null).pitchRatio;
  const pan = Math.max(-0.9, Math.min(0.9, dx / (5 + Math.abs(ds) * 0.16)));
  if (!isLegacyTraversal(traversal)) {
    const propulsion = traversalPropulsion(traversal);
    const onWater = traversalOnWater(traversal, discipline);
    const shape =
      LEGACY_RIVAL.baseHz +
      Math.min(LEGACY_RIVAL.speedCap, Math.abs(rival.speed)) * LEGACY_RIVAL.speedCoef +
      index * LEGACY_RIVAL.indexStep;
    if (propulsion === 'human') {
      return {
        index,
        distance,
        pan,
        gain: rivalHumanGain(envelope, motion, onWater),
        pitchHz: shape * doppler * ratio,
      };
    }
    if (propulsion === 'magic') {
      return {
        index,
        distance,
        pan,
        gain: rivalMagicGain(envelope, motion, onWater),
        pitchHz: shape * 0.9 * doppler * ratio,
      };
    }
    // Motor with traversal: same family/tone/pitch through the traversal
    // surface engine (ground → hover mix, water → marine mix).
    const wet = onWater;
    return {
      index,
      distance,
      pan,
      gain: envelope * (wet ? 0.02 + motion * 0.095 : 0.025 + motion * 0.11),
      pitchHz: shape * (wet ? 0.92 : 1) * doppler * ratio,
    };
  }
  const jetski = normalizeEngineDiscipline(discipline) === 'jetski';
  // Jetski rivals run the same proximity/stereo rules through a marine
  // motor: the whole pitch shape sits 8% deeper with a softer wash gain.
  // Proportional (never additive), so the jetski voice stays separated
  // from hover at every speed instead of crossing over mid-range.
  const shape =
    LEGACY_RIVAL.baseHz +
    Math.min(LEGACY_RIVAL.speedCap, Math.abs(rival.speed)) * LEGACY_RIVAL.speedCoef +
    index * LEGACY_RIVAL.indexStep;
  return {
    index,
    distance,
    pan: Math.max(-0.9, Math.min(0.9, dx / (5 + Math.abs(ds) * 0.16))),
    gain: envelope * (jetski ? 0.02 + motion * 0.095 : 0.025 + motion * 0.11),
    pitchHz: shape * (jetski ? 0.92 : 1) * doppler * ratio,
  };
}

class RivalVoice {
  info: RivalSound | null = null;
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private pan: StereoPannerNode | null = null;
  private noise: AudioBufferSourceNode | null = null;
  private nfilter: BiquadFilterNode | null = null;
  private ngain: GainNode | null = null;
  private npan: StereoPannerNode | null = null;
  private buffer: AudioBuffer | null = null;
  private bufferContext: AudioContext | null = null;
  private voice: ResolvedEngineProfile = resolveEngineProfile();
  private rawFamily: RacingEngineProfile['family'] | undefined = undefined;
  private rawTone: number | undefined = undefined;
  private rawPitch: number | undefined = undefined;
  private rawDiscipline: RacingDiscipline | null | undefined = undefined;
  private rawPropulsion: string | null | undefined = undefined;
  private rawSurface: string | null | undefined = undefined;
  private rawRider: string | null | undefined = undefined;
  private traversal: RacingTraversal | null = null;
  private held = false;
  constructor(private caps: HoverEngineCaps) {}

  /**
   * Voice this rival's timbre. Stores parameters only (no nodes, no
   * claim); a running voice switches timbre live. Steady-state repeats
   * with the same input return after field compares, so per-update
   * calls allocate no nodes and no parameter objects. The optional
   * traversal selects the propulsion voice; absent/null keeps the exact
   * legacy motor path.
   */
  setProfile(
    profile?: RacingEngineProfile | null,
    discipline?: RacingDiscipline | null,
    traversal?: RacingTraversal | null,
  ): void {
    const t = traversal ?? null;
    const propulsion = traversalPropulsion(t);
    const surface = (t as { surface?: unknown } | null)?.surface ?? null;
    const rider = (t as { rider?: unknown } | null)?.rider ?? null;
    if (
      profile?.family === this.rawFamily &&
      profile?.tone === this.rawTone &&
      profile?.pitch === this.rawPitch &&
      (discipline ?? null) === (this.rawDiscipline ?? null) &&
      propulsion === (this.rawPropulsion ?? 'motor') &&
      (surface as string | null) === (this.rawSurface ?? null) &&
      (rider as string | null) === (this.rawRider ?? null)
    ) {
      return;
    }
    this.rawFamily = profile?.family;
    this.rawTone = profile?.tone;
    this.rawPitch = profile?.pitch;
    this.rawDiscipline = discipline ?? null;
    this.rawPropulsion = propulsion;
    this.rawSurface = (surface as string | null) ?? null;
    this.rawRider = (rider as string | null) ?? null;
    this.traversal = t;
    // A present traversal drives the surface engine; an absent one keeps
    // the discipline mix exactly.
    const effective: RacingDiscipline | null | undefined = isLegacyTraversal(t)
      ? discipline
      : traversalOnWater(t, discipline)
        ? 'jetski'
        : 'hover';
    this.voice = resolveEngineProfile(profile ?? null, effective);
    try {
      if (this.osc && propulsion !== 'human') {
        this.osc.type = propulsion === 'magic' ? 'sine' : this.voice.oscType;
      }
    } catch {
      // A dead voice must never break a profile switch.
    }
    if (propulsion === 'human') this.stopOsc();
  }

  update(info: RivalSound): void {
    const propulsion = traversalPropulsion(this.traversal);
    if (propulsion === 'human') {
      this.updateNoise(info);
      return;
    }
    if (propulsion === 'magic') {
      this.updateSoft(info);
      return;
    }
    this.updateMotor(info);
  }

  /** Motor rival: the exact legacy oscillator path. */
  private updateMotor(info: RivalSound): void {
    try {
      if (this.noise) this.stop();
      const ctx = this.caps.context();
      if (!this.osc) {
        if (!this.caps.claimVoice()) return;
        this.held = true;
        this.osc = ctx.createOscillator();
        this.osc.type = this.voice.oscType;
        this.filter = ctx.createBiquadFilter();
        this.filter.type = 'lowpass';
        this.gain = ctx.createGain();
        this.gain.gain.value = 0;
        this.osc.connect(this.filter);
        this.filter.connect(this.gain);
        if (typeof ctx.createStereoPanner === 'function') {
          this.pan = ctx.createStereoPanner();
          this.gain.connect(this.pan);
          this.pan.connect(this.caps.sfxBus);
        } else this.gain.connect(this.caps.sfxBus);
        this.osc.start();
      }
      this.info = info;
      const now = ctx.currentTime;
      this.osc.frequency.setTargetAtTime(info.pitchHz, now, 0.12);
      this.filter!.frequency.setTargetAtTime(
        (LEGACY_RIVAL.filterBase + info.gain * LEGACY_RIVAL.filterGainCoef) *
          this.voice.filterScale,
        now,
        0.12,
      );
      this.gain!.gain.setTargetAtTime(info.gain, now, 0.1);
      this.pan?.pan.setTargetAtTime(info.pan, now, 0.1);
    } catch {
      this.stop();
    }
  }

  /**
   * Magic rival: restrained soft tonal voice (forced sine, quiet gain
   * carried by rivalSound). No bells, no extra noise source.
   */
  private updateSoft(info: RivalSound): void {
    try {
      if (this.noise) this.stop();
      const ctx = this.caps.context();
      if (!this.osc) {
        if (!this.caps.claimVoice()) return;
        this.held = true;
        this.osc = ctx.createOscillator();
        this.osc.type = 'sine';
        this.filter = ctx.createBiquadFilter();
        this.filter.type = 'lowpass';
        this.gain = ctx.createGain();
        this.gain.gain.value = 0;
        this.osc.connect(this.filter);
        this.filter.connect(this.gain);
        if (typeof ctx.createStereoPanner === 'function') {
          this.pan = ctx.createStereoPanner();
          this.gain.connect(this.pan);
          this.pan.connect(this.caps.sfxBus);
        } else this.gain.connect(this.caps.sfxBus);
        this.osc.start();
      }
      try {
        this.osc.type = 'sine';
      } catch {
        // Keep the last timbre; the quiet gain still applies.
      }
      this.info = info;
      const now = ctx.currentTime;
      this.osc.frequency.setTargetAtTime(info.pitchHz, now, 0.14);
      this.filter!.frequency.setTargetAtTime(
        (LEGACY_RIVAL.filterBase + info.gain * LEGACY_RIVAL.filterGainCoef) *
          this.voice.filterScale,
        now,
        0.14,
      );
      this.gain!.gain.setTargetAtTime(info.gain, now, 0.12);
      this.pan?.pan.setTargetAtTime(info.pan, now, 0.1);
    } catch {
      this.stop();
    }
  }

  /**
   * Human rival: quiet rolling/footfall noise proportional to distance
   * and speed with stereo pan. Silent at rest — holds no voice and
   * never plays an idle engine. One repurposed looped-noise source.
   */
  private updateNoise(info: RivalSound): void {
    try {
      if (!(info.gain > 0)) {
        this.stop();
        return;
      }
      if (this.osc) this.stop();
      const ctx = this.caps.context();
      if (!this.noise) {
        if (!this.caps.claimVoice()) return;
        this.held = true;
        if (!this.buffer || this.bufferContext !== ctx) {
          this.buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
          this.bufferContext = ctx;
          renderEngineNoise(this.buffer.getChannelData(0));
        }
        this.noise = ctx.createBufferSource();
        this.noise.buffer = this.buffer;
        this.noise.loop = true;
        this.nfilter = ctx.createBiquadFilter();
        this.nfilter.type = 'lowpass';
        this.nfilter.frequency.value = 600;
        this.ngain = ctx.createGain();
        this.ngain.gain.value = 0;
        this.noise.connect(this.nfilter);
        this.nfilter.connect(this.ngain);
        if (typeof ctx.createStereoPanner === 'function') {
          this.npan = ctx.createStereoPanner();
          this.ngain.connect(this.npan);
          this.npan.connect(this.caps.sfxBus);
        } else this.ngain.connect(this.caps.sfxBus);
        this.noise.start();
      }
      this.info = info;
      const now = ctx.currentTime;
      this.nfilter!.frequency.setTargetAtTime(
        (500 + info.gain * 7000) * this.voice.filterScale,
        now,
        0.12,
      );
      this.ngain!.gain.setTargetAtTime(info.gain, now, 0.1);
      this.npan?.pan.setTargetAtTime(info.pan, now, 0.1);
    } catch {
      this.stop();
    }
  }

  /** Silence the motor/magic tone only, keeping a human noise source. */
  private stopOsc(): void {
    if (!this.osc && !this.noise) return;
    if (this.noise) return;
    this.stop();
  }

  stop(): void {
    try {
      this.osc?.stop();
    } catch {
      /* Partial/stopped oscillator. */
    }
    try {
      this.noise?.stop();
    } catch {
      /* Partial/stopped source. */
    }
    for (const node of [
      this.osc,
      this.filter,
      this.gain,
      this.pan,
      this.noise,
      this.nfilter,
      this.ngain,
      this.npan,
    ]) {
      try {
        node?.disconnect();
      } catch {
        /* Do not strand siblings. */
      }
    }
    this.osc = null;
    this.filter = null;
    this.gain = null;
    this.pan = null;
    this.noise = null;
    this.nfilter = null;
    this.ngain = null;
    this.npan = null;
    this.info = null;
    if (this.held) {
      this.held = false;
      try {
        this.caps.releaseVoice();
      } catch {
        /* Optional audio. */
      }
    }
  }
}

export class RaceEngineAudio {
  private player = new HoverEngine();
  private voices: RivalVoice[] = [];
  private held = 0;
  private playerProfile: RacingEngineProfile | null | undefined = undefined;
  private rivalProfiles: (RacingEngineProfile | null | undefined)[] = [];
  private discipline: RacingDiscipline = 'hover';
  private traversal: RacingTraversal | null = null;

  /**
   * Optional authored timbres: the player voice plus per-rival voices in
   * stable cast order (entry 0 voices the first non-player racer).
   * Omit/null anywhere for the exact legacy mix on that voice; a missing
   * rival entry falls back to the player profile. The optional
   * discipline (identity.discipline, cup-wide) selects the watercraft
   * mix for every voice; omit/null it for the exact legacy hover mix.
   * The optional fourth traversal (identity.traversal, cup-wide)
   * selects the composable propulsion voice for every voice;
   * absent/null keeps the exact legacy hover/jetski path. Label is
   * never consulted.
   */
  constructor(
    player?: RacingEngineProfile | null,
    rivals?: (RacingEngineProfile | null | undefined)[],
    discipline?: RacingDiscipline | null,
    traversal?: RacingTraversal | null,
  ) {
    this.setProfile(player, rivals, discipline, traversal);
  }

  /**
   * Select timbres (identity.sound.engine for the player, themed voices
   * per rival), optionally the discipline, and optionally the cup-wide
   * traversal. Stores parameters only: no nodes, no claims. Safe to
   * call before attach and while voices are playing. An omitted
   * discipline or traversal keeps the current mix; pass explicit null
   * for the exact legacy hover mix and legacy motor path.
   */
  setProfile(
    player?: RacingEngineProfile | null,
    rivals?: (RacingEngineProfile | null | undefined)[],
    discipline?: RacingDiscipline | null,
    traversal?: RacingTraversal | null,
  ): void {
    this.playerProfile = player ?? null;
    this.rivalProfiles = rivals ? [...rivals] : [];
    if (discipline !== undefined) this.discipline = normalizeEngineDiscipline(discipline);
    if (traversal !== undefined) this.traversal = traversal ?? null;
    this.player.setProfile(this.playerProfile, this.discipline, this.traversal);
    for (let i = 0; i < this.voices.length; i++) {
      const sounding = this.voices[i]!.info;
      this.voices[i]!.setProfile(
        this.rivalProfileFor(sounding ? sounding.index : i),
        this.discipline,
        this.traversal,
      );
    }
  }

  /** Current mix ('hover' unless 'jetski' was selected). */
  voiceDiscipline(): RacingDiscipline {
    return this.discipline;
  }

  /** Last player slot seen (PLAYER_INDEX is constant per game; defaults to 0). */
  private lastPlayerIndex = 0;

  /**
   * Rival slot for a racer index: position among the non-player racers in
   * field order. Unthemed slots fall back to the player profile.
   */
  private rivalProfileFor(racerIndex: number): RacingEngineProfile | null | undefined {
    const slot = racerIndex < this.lastPlayerIndex ? racerIndex : racerIndex - 1;
    if (slot < 0 || slot >= this.rivalProfiles.length) return this.playerProfile;
    return this.rivalProfiles[slot] ?? this.playerProfile;
  }

  attach(caps: HoverEngineCaps | null | undefined): void {
    this.stop();
    if (!caps) {
      this.player.attach(null);
      this.voices = [];
      return;
    }
    // Local quota enforces actual source accounting without raising global limits.
    const limited: HoverEngineCaps = {
      context: () => caps.context(),
      sfxBus: caps.sfxBus,
      claimVoice: () => {
        if (this.held >= 3 || !caps.claimVoice()) return false;
        this.held++;
        return true;
      },
      releaseVoice: () => {
        this.held = Math.max(0, this.held - 1);
        caps.releaseVoice();
      },
    };
    this.player.attach(limited);
    this.voices = [new RivalVoice(limited), new RivalVoice(limited)];
    // Fresh voices start legacy; re-voice them from the stored profiles so
    // setProfile-before-attach (the game.ts call order) still applies.
    for (const voice of this.voices)
      voice.setProfile(this.playerProfile, this.discipline, this.traversal);
  }

  status() {
    return this.player.status();
  }
  snapshot() {
    return {
      sources: this.held,
      rivals: this.voices.flatMap((v) => (v.info ? [{ ...v.info }] : [])),
    };
  }

  update(
    state: HoverEngineState,
    racers: readonly AudibleRacer[],
    playerIndex: number,
    length: number,
  ): void {
    this.lastPlayerIndex = playerIndex;
    // Free only the rival slots the player is actually about to need, so
    // the player's own craft never starves behind distant rivals. Motor
    // holds its tone plus a second source on boost/water (the legacy
    // priority); human holds only its movement noise (no tone), so two
    // sounding rivals plus the player still fit the budget and neither
    // is killed; magic holds tone plus wind while audible.
    {
      const wanted = this.player.requestedSources(state);
      const sounding = this.voices.filter((v) => v.info);
      if (wanted + sounding.length > 3 && sounding.length > 0) {
        sounding.sort((a, b) => a.info!.gain - b.info!.gain)[0]!.stop();
      }
    }
    this.player.update(state);
    const count = Math.min(state.boosting ? 1 : 2, Math.max(0, 3 - this.player.sources));
    const candidates = racers.flatMap((r, i) => {
      if (i === playerIndex) return [];
      const s = rivalSound(
        racers[playerIndex]!,
        r,
        i,
        length,
        this.rivalProfileFor(i),
        this.discipline,
        this.traversal,
      );
      return s ? [s] : [];
    });
    const priority = (r: RivalSound) =>
      r.distance * (this.voices.some((v) => v.info?.index === r.index) ? 0.85 : 1);
    candidates.sort((a, b) => priority(a) - priority(b));
    const chosen = candidates.slice(0, count);
    // Preserve identity in each slot while present, avoiding pitch/pan swaps.
    for (const voice of this.voices) {
      if (!chosen.some((r) => r.index === voice.info?.index)) voice.stop();
    }
    for (const candidate of chosen) {
      const voice =
        this.voices.find((v) => v.info?.index === candidate.index) ??
        this.voices.find((v) => !v.info);
      // Voice the slot for this rival (steady-state: field compares,
      // no allocation); the pitch already carries the same profile.
      voice?.setProfile(this.rivalProfileFor(candidate.index), this.discipline, this.traversal);
      voice?.update(candidate);
    }
  }

  stop(): void {
    this.player.stop();
    for (const v of this.voices) v.stop();
  }
}
