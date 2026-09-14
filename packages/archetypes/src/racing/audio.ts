// Continuous engine and afterburner for the racing archetype.
//
// A harmonic engine tone and a second noise source share the SFX bus, so
// bus volume and mute apply with no extra plumbing. Pitch and gain follow
// the real craft state (speed, throttle, boost, drift) with smoothed WebAudio
// ramps; everything is created lazily on the first racing update and torn
// down on pause/results/restart/dispose. At most two voices are held, and
// a spent voice budget (or missing capability) stays silent instead of loud.
// On hover the noise source is boost-only; on jetski the same source is
// repurposed as the water rush (silent at rest, swelling with speed and
// carve, surging under boost). Omit the discipline for the exact legacy mix.

import type {
  RacingDiscipline,
  RacingEngineProfile,
  RacingTraversal,
} from '@sparkade/shared';
import {
  JETSKI_WATER_REST_NORM,
  jetskiWaterCutoff,
  jetskiWaterGain,
  normalizeEngineDiscipline,
  renderEngineNoise,
  resolveEngineProfile,
  type ResolvedEngineProfile,
} from './sound-profile';
import {
  applyCadence,
  humanCadenceHz,
  humanDriveCutoff,
  humanDriveGain,
  isLegacyTraversal,
  magicToneGain,
  magicToneHz,
  magicWindCutoff,
  magicWindGain,
  traversalOnWater,
  traversalPropulsion,
  traversalRider,
  traversalSurface,
  traversalWaterCutoff,
  traversalWaterGain,
  TRAVERSAL_REST_NORM,
  type TraversalRider,
} from './traversal-audio';

/** Minimal structural capability; AudioSys satisfies it, fakes are trivial. */
export interface HoverEngineCaps {
  context(): AudioContext;
  sfxBus: GainNode;
  claimVoice(): boolean;
  releaseVoice(): void;
}

/** Live craft state driving the hum. Numbers only — no allocation. */
export interface HoverEngineState {
  /** Forward speed in track units. */
  speed: number;
  /** Throttle held. */
  throttle: boolean;
  /** Manual boost burning. */
  boosting: boolean;
  /** Drift/airbrake held at speed. */
  drifting: boolean;
}

/** Read-only activity snapshot for DEV telemetry. */
export interface HoverEngineStatus {
  on: boolean;
  /** Current target pitch in Hz (0 while stopped). */
  pitchHz: number;
}

const TOP_SPEED = 128;

function pitchFor(s: HoverEngineState, v: ResolvedEngineProfile): number {
  const norm = Math.max(0, Math.min(1, Math.abs(s.speed) / TOP_SPEED));
  const rpm =
    v.baseHz + norm * v.speedHz + (s.throttle ? v.throttleHz : 0) + (s.drifting ? v.driftHz : 0);
  // The voice already carries the jetski retune (deeper idle, wider load
  // sweep); boost digs deeper on water for the loaded marine thrust.
  const boostLoad = v.discipline === 'jetski' ? 0.78 : 0.84;
  return rpm * v.pitchRatio * (s.boosting ? boostLoad : 1);
}

function gainFor(s: HoverEngineState, v: ResolvedEngineProfile): number {
  const norm = Math.max(0, Math.min(1, Math.abs(s.speed) / TOP_SPEED));
  if (v.discipline === 'jetski') {
    // Slightly softer motor than hover: the water rush shares this voice's
    // headroom, so the pair stays under the hover peak and off the music.
    return 0.02 + norm * 0.11 + (s.boosting ? 0.04 : 0) + (s.throttle ? 0.1 : 0);
  }
  return 0.025 + norm * 0.14 + (s.boosting ? 0.055 : 0) + (s.throttle ? 0.12 : 0);
}

function filterFor(s: HoverEngineState, v: ResolvedEngineProfile): number {
  const norm = Math.max(0, Math.min(1, Math.abs(s.speed) / TOP_SPEED));
  return (
    (v.filterBase +
      norm * v.filterSpeed +
      (s.throttle ? v.filterThrottle : 0) +
      (s.boosting ? v.filterBoost : 0)) *
    v.filterScale
  );
}

function speedNormFor(s: HoverEngineState): number {
  return Math.max(0, Math.min(1, Math.abs(s.speed) / TOP_SPEED));
}

export class HoverEngine {
  private caps: HoverEngineCaps | null = null;
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private voiceHeld = false;
  private pitchHz = 0;
  private discipline: RacingDiscipline = 'hover';
  private voice: ResolvedEngineProfile = resolveEngineProfile();
  private burner = new Afterburner();
  private traversal: RacingTraversal | null = null;
  private rider: TraversalRider = 'seated';

  /**
   * Optional authored timbre; omit/null for the exact legacy mix. The
   * optional discipline selects the watercraft mix ('jetski'); omit/null
   * (or anything but 'jetski') for the exact legacy hover voice. The
   * optional traversal (identity.traversal, composable P1 contract)
   * selects the propulsion voice: absent/null keeps the exact legacy
   * motor path; motor reuses family/tone/pitch with the traversal
   * surface engine (ground → hover mix, water → jetski mix); human
   * replaces the hum with filtered movement noise; magic replaces it
   * with a restrained soft tone plus wind. Label is never consulted.
   */
  constructor(
    profile?: RacingEngineProfile | null,
    discipline?: RacingDiscipline | null,
    traversal?: RacingTraversal | null,
  ) {
    this.setProfile(profile, discipline, traversal);
  }

  /**
   * Select the engine timbre (identity.sound.engine) and optionally the
   * discipline (identity.discipline) and traversal (identity.traversal).
   * Stores parameters only: no nodes are created, no voice is claimed,
   * and a running motor voice keeps playing with its timbre switched
   * live. Null/undefined restores the exact legacy mix. A switch into
   * the human voice silences a running motor tone immediately (the
   * movement noise starts on the next update); other switches retune
   * live. Reads the current discipline back via voiceDiscipline().
   */
  setProfile(
    profile?: RacingEngineProfile | null,
    discipline?: RacingDiscipline | null,
    traversal?: RacingTraversal | null,
  ): void {
    // An explicit discipline (including null → hover) switches the mix;
    // an omitted one keeps the current mix, so live timbre switches
    // mid-race never splash a jetski back to hover by accident.
    if (discipline !== undefined) this.discipline = normalizeEngineDiscipline(discipline);
    if (traversal !== undefined) this.traversal = traversal ?? null;
    this.rider = traversalRider(this.traversal);
    // A present traversal drives the surface engine (mirroring
    // movementForTraversal); an absent one keeps the discipline mix
    // exactly, so legacy cups sound byte-identical.
    const effective: RacingDiscipline = isLegacyTraversal(this.traversal)
      ? this.discipline
      : traversalSurface(this.traversal, this.discipline) === 'water'
        ? 'jetski'
        : 'hover';
    this.voice = resolveEngineProfile(profile ?? null, effective);
    this.burner.setProfile(this.voice);
    const propulsion = traversalPropulsion(this.traversal);
    try {
      if (this.osc) {
        if (propulsion === 'magic') this.osc.type = 'sine';
        else if (propulsion === 'motor') this.osc.type = this.voice.oscType;
      }
    } catch {
      // A dead voice must never break a profile switch; next update retries.
    }
    if (propulsion === 'human') this.stopTone();
  }

  /** Current mix ('hover' unless 'jetski' was selected). */
  voiceDiscipline(): RacingDiscipline {
    return this.discipline;
  }

  /**
   * Whether this update wants the second (noise) voice: boost on any
   * mix, the jetski water rush while moving, human rolling/footfall
   * while moving, or the magic wind swell while moving. Lets the race
   * mixer free a rival slot first, exactly like boost priority, so the
   * player's own craft never starves behind distant rivals.
   */
  wantsNoise(s: HoverEngineState): boolean {
    if (s.boosting) return true;
    const propulsion = traversalPropulsion(this.traversal);
    if (propulsion === 'human' || propulsion === 'magic') {
      return speedNormFor(s) > TRAVERSAL_REST_NORM;
    }
    if (isLegacyTraversal(this.traversal)) {
      return this.discipline === 'jetski' && speedNormFor(s) > JETSKI_WATER_REST_NORM;
    }
    return (
      traversalOnWater(this.traversal, this.discipline) &&
      speedNormFor(s) > JETSKI_WATER_REST_NORM
    );
  }

  /**
   * Player voices this update will hold once it runs: motor always holds
   * its tone plus the noise voice while wantsNoise; human holds only the
   * movement-noise voice while wantsNoise (no tone ever); magic holds its
   * tone plus wind while audible (same condition as wantsNoise). Pure
   * parameters only — no nodes, no claims — so the race mixer can free
   * exactly the rival slots the player is about to need.
   */
  requestedSources(s: HoverEngineState): number {
    const propulsion = traversalPropulsion(this.traversal);
    if (propulsion === 'human') return this.wantsNoise(s) ? 1 : 0;
    if (propulsion === 'magic') return this.wantsNoise(s) ? 2 : 0;
    return this.wantsNoise(s) ? 2 : 1;
  }

  /** Remember the capability; creates no nodes and claims no voice. */
  attach(caps: HoverEngineCaps | null | undefined): void {
    this.caps = caps ?? null;
    this.burner.attach(this.caps);
  }

  get active(): boolean {
    return this.osc !== null;
  }

  /** Live source count lets the race mixer leave room for rivals and effects. */
  get sources(): number {
    return (this.voiceHeld ? 1 : 0) + this.burner.sources;
  }

  /** Read-only status for DEV snapshots. */
  status(): HoverEngineStatus {
    return { on: this.active, pitchHz: this.active ? this.pitchHz : 0 };
  }

  /**
   * Drive the voice from live craft state. Motor keeps the exact legacy
   * hum path; human drives filtered movement noise with step/roll
   * cadence (no hum, no burner); magic drives a restrained soft tone
   * plus wind. Lazily starts voices on the first call; a missing
   * capability or spent budget stays silent and retries later. Reuses
   * all nodes — no per-update allocation; cadence modulates from the
   * monotonic audio clock.
   */
  update(s: HoverEngineState): void {
    if (!this.caps) return;
    const propulsion = traversalPropulsion(this.traversal);
    if (propulsion === 'human') {
      this.updateHuman(s);
      return;
    }
    if (propulsion === 'magic') {
      this.updateMagic(s);
      return;
    }
    if (!this.start()) return;
    try {
      const ctx = this.caps.context();
      const t = ctx.currentTime;
      this.pitchHz = pitchFor(s, this.voice);
      const response = s.throttle ? 0.07 : 0.18;
      this.osc!.frequency.setTargetAtTime(this.pitchHz, t, response);
      this.gain!.gain.setTargetAtTime(gainFor(s, this.voice), t, response);
      this.filter!.frequency.setTargetAtTime(filterFor(s, this.voice), t, response);
      this.burner.update(s);
    } catch {
      // Dead context or parameters must never crash racing: drop the broken
      // voice quietly; a later update retries from a clean claim.
      this.stop();
    }
  }

  /**
   * Human movement voice: no engine hum and no combustion burner at all.
   * The motor tone stays stopped (its voice is released); a single
   * repurposed noise source plays filtered rolling/footfall texture with
   * cadence from the audio clock, plus the water wash on surface water.
   * Silent at rest; exertion rises with throttle/accel.
   */
  private updateHuman(s: HoverEngineState): void {
    this.stopTone();
    this.pitchHz = 0;
    try {
      const caps = this.caps;
      if (!caps) return;
      const ctx = caps.context();
      const norm = speedNormFor(s);
      const onWater = traversalOnWater(this.traversal, this.discipline);
      this.burner.updateHuman(s, norm, this.rider, onWater, ctx.currentTime);
    } catch {
      this.stop();
    }
  }

  /**
   * Magic voice: a restrained soft tonal swell (forced sine, quiet cap,
   * silent at rest) plus wind on the repurposed noise source, with the
   * water wash on surface water. No bells, no loud idle buzz.
   */
  private updateMagic(s: HoverEngineState): void {
    try {
      const caps = this.caps;
      if (!caps) return;
      const norm = speedNormFor(s);
      // Silent at rest: no tonal voice (no idle buzz); the wind tail
      // fades through the shared noise path.
      if (!s.boosting && norm <= TRAVERSAL_REST_NORM) {
        this.stopTone();
        this.burner.updateMagic(s, norm, traversalOnWater(this.traversal, this.discipline));
        return;
      }
      if (!this.startMagic()) return;
      const ctx = caps.context();
      const t = ctx.currentTime;
      const onWater = traversalOnWater(this.traversal, this.discipline);
      this.pitchHz = magicToneHz(norm, s.boosting);
      const response = s.throttle ? 0.09 : 0.2;
      this.osc!.frequency.setTargetAtTime(this.pitchHz, t, response);
      this.gain!.gain.setTargetAtTime(magicToneGain(norm, s.boosting), t, response);
      this.filter!.frequency.setTargetAtTime(magicWindCutoff(norm, s.boosting), t, response);
      this.burner.updateMagic(s, norm, onWater);
    } catch {
      this.stop();
    }
  }

  /** Start the single tonal voice forced to a soft sine for magic. */
  private startMagic(): boolean {
    if (this.osc !== null) {
      try {
        this.osc.type = 'sine';
      } catch {
        // A dead voice keeps its last timbre; the update still applies.
      }
      return true;
    }
    if (!this.caps || !this.caps.claimVoice()) return false;
    this.voiceHeld = true;
    try {
      const ctx = this.caps.context();
      this.osc = ctx.createOscillator();
      this.osc.type = 'sine';
      this.osc.frequency.value = magicToneHz(0, false);
      this.filter = ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 700;
      this.gain = ctx.createGain();
      this.gain.gain.value = 0;
      this.osc.connect(this.filter);
      this.filter.connect(this.gain);
      this.gain.connect(this.caps.sfxBus);
      this.osc.start();
      return true;
    } catch {
      const nodes = [this.osc, this.filter, this.gain];
      this.osc = null;
      this.gain = null;
      this.filter = null;
      this.voiceHeld = false;
      for (const node of nodes) {
        try {
          node?.disconnect();
        } catch {
          // Already disconnected.
        }
      }
      try {
        this.caps?.releaseVoice();
      } catch {
        // Accounting must never throw.
      }
      return false;
    }
  }

  /** Silence the motor tone only, keeping the repurposed noise source. */
  private stopTone(): void {
    if (!this.voiceHeld) {
      this.osc = null;
      this.gain = null;
      this.filter = null;
      this.pitchHz = 0;
      return;
    }
    this.voiceHeld = false;
    this.pitchHz = 0;
    try {
      this.osc?.stop();
    } catch {
      // Already stopped.
    }
    for (const node of [this.osc, this.filter, this.gain]) {
      try {
        node?.disconnect();
      } catch {
        // Already disconnected.
      }
    }
    this.osc = null;
    this.gain = null;
    this.filter = null;
    try {
      this.caps?.releaseVoice();
    } catch {
      // Accounting must never throw.
    }
  }

  /**
   * Silence and release everything. Idempotent: repeated calls (pause,
   * results, restart, dispose) release the voice at most once and never
   * throw, even against a torn-down context.
   */
  stop(): void {
    this.burner.stop();
    if (!this.voiceHeld) {
      this.osc = null;
      this.gain = null;
      this.filter = null;
      this.pitchHz = 0;
      return;
    }
    this.voiceHeld = false;
    this.pitchHz = 0;
    let t = 0;
    try {
      const ctx = this.caps?.context();
      t = ctx ? ctx.currentTime : 0;
    } catch {
      // A dead context must never break teardown; ramp instantly.
    }
    try {
      this.gain?.gain.setTargetAtTime(0, t, 0.02);
    } catch {
      // A dead parameter must not spare the oscillator stop below.
    }
    try {
      this.osc?.stop(t + 0.08);
    } catch {
      // Already stopped.
    }
    try {
      this.osc?.disconnect();
    } catch {
      // Already disconnected.
    }
    try {
      this.gain?.disconnect();
    } catch {
      // Already disconnected.
    }
    try {
      this.filter?.disconnect();
    } catch {
      // Already disconnected.
    }
    this.osc = null;
    this.gain = null;
    this.filter = null;
    try {
      this.caps?.releaseVoice();
    } catch {
      // Accounting must never throw.
    }
  }

  /** Start the single voice; false when there is nothing to start with. */
  private start(): boolean {
    if (this.osc !== null) return true;
    if (!this.caps || !this.caps.claimVoice()) return false;
    this.voiceHeld = true;
    try {
      const ctx = this.caps.context();
      this.osc = ctx.createOscillator();
      this.osc.type = this.voice.oscType;
      this.osc.frequency.value = this.voice.baseHz * this.voice.pitchRatio;
      this.filter = ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 420;
      this.gain = ctx.createGain();
      this.gain.gain.value = 0;
      this.osc.connect(this.filter);
      this.filter.connect(this.gain);
      this.gain.connect(this.caps.sfxBus);
      this.osc.start();
      return true;
    } catch {
      // Partial-start teardown: nodes may already be wired (e.g. start()
      // threw after connection). Disconnect each in its own guard so one
      // failure cannot strand the rest, then release the single claim once.
      const nodes = [this.osc, this.filter, this.gain];
      this.osc = null;
      this.gain = null;
      this.filter = null;
      this.voiceHeld = false;
      for (const node of nodes) {
        try {
          node?.disconnect();
        } catch {
          // Already disconnected.
        }
      }
      try {
        this.caps?.releaseVoice();
      } catch {
        // Accounting must never throw.
      }
      return false;
    }
  }
}

/**
 * Boost-only filtered noise on hover; water-rush noise on jetski. Either
 * way one cached buffer and at most one claimed source — the second player
 * voice is repurposed, never duplicated, so the player still holds <= 2.
 */
class Afterburner {
  private caps: HoverEngineCaps | null = null;
  private source: AudioBufferSourceNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private gain: GainNode | null = null;
  private buffer: AudioBuffer | null = null;
  private bufferContext: AudioContext | null = null;
  private voice: ResolvedEngineProfile = resolveEngineProfile();
  private held = false;
  private lastBurnAt = -Infinity;

  attach(caps: HoverEngineCaps | null): void {
    this.caps = caps;
  }

  /** Authored boost roar; stores parameters only, never touches nodes. */
  setProfile(voice: ResolvedEngineProfile): void {
    this.voice = voice;
  }
  get sources(): number {
    return this.held ? 1 : 0;
  }

  update(s: HoverEngineState): void {
    const caps = this.caps;
    if (!caps) return;
    if (this.voice.discipline === 'jetski') {
      this.updateWater(s, caps);
      return;
    }
    this.updateBoost(s.boosting, caps);
  }

  /** Exact legacy behavior: boost-only lowpassed roar with a short tail. */
  private updateBoost(burning: boolean, caps: HoverEngineCaps): void {
    try {
      const ctx = caps.context();
      const now = ctx.currentTime;
      if (burning) this.lastBurnAt = now;
      if (!burning && now - this.lastBurnAt > 0.16) {
        this.stop();
        return;
      }
      if (!this.source) {
        if (!burning || !caps.claimVoice()) return;
        this.startSource(caps, ctx, this.voice.burnerCutoff);
      }
      this.filter!.frequency.setTargetAtTime(this.voice.burnerCutoff, now, 0.05);
      this.gain!.gain.setTargetAtTime(
        burning ? this.voice.burnerGain : 0,
        now,
        burning ? 0.025 : 0.035,
      );
    } catch {
      this.stop();
    }
  }

  /**
   * Jetski water rush on the same single source: silent at rest, swelling
   * with speed, extra wake wash while carving, and a stronger rushing
   * waterjet under boost (deep thrust, never flame or bell). A spent
   * voice budget stays silent and retries on a later update.
   */
  private updateWater(s: HoverEngineState, caps: HoverEngineCaps): void {
    try {
      const ctx = caps.context();
      const now = ctx.currentTime;
      const norm = speedNormFor(s);
      const burning = s.boosting;
      if (burning) this.lastBurnAt = now;
      const running = burning || norm > JETSKI_WATER_REST_NORM;
      if (!running && now - this.lastBurnAt > 0.16) {
        this.stop();
        return;
      }
      if (!this.source) {
        if (!running || !caps.claimVoice()) return;
        this.startSource(caps, ctx, jetskiWaterCutoff(norm, burning, this.voice));
      }
      this.filter!.frequency.setTargetAtTime(
        jetskiWaterCutoff(norm, burning, this.voice),
        now,
        0.08,
      );
      this.gain!.gain.setTargetAtTime(
        running ? jetskiWaterGain(norm, s.drifting, burning, this.voice) : 0,
        now,
        burning ? 0.025 : 0.06,
      );
    } catch {
      this.stop();
    }
  }

  /**
   * Human movement noise on the same single source: filtered
   * rolling/footfall texture with step/roll cadence from the monotonic
   * audio clock, plus the water wash on surface water. Silent at rest;
   * exertion rises with throttle. Reuses the cached noise buffer and
   * claims at most one voice — never an engine hum or burner.
   */
  updateHuman(
    s: HoverEngineState,
    norm: number,
    rider: TraversalRider,
    onWater: boolean,
    now: number,
  ): void {
    const caps = this.caps;
    if (!caps) return;
    try {
      const ctx = caps.context();
      const t = ctx.currentTime;
      const drive = humanDriveGain(norm, s.throttle, s.boosting, rider);
      const wash = onWater ? traversalWaterGain(norm, s.drifting, s.boosting) * 0.6 : 0;
      const base = Math.min(0.44, drive + wash);
      const running = s.boosting || base > 0;
      if (running) this.lastBurnAt = t;
      if (!running && t - this.lastBurnAt > 0.16) {
        this.stop();
        return;
      }
      if (!this.source) {
        if (!running || !caps.claimVoice()) return;
        this.startSource(caps, ctx, humanDriveCutoff(norm, s.boosting, rider));
      }
      const cadence = applyCadence(base, now, humanCadenceHz(norm, rider));
      const cutoff = Math.max(
        humanDriveCutoff(norm, s.boosting, rider),
        onWater && base > 0 ? traversalWaterCutoff(norm, s.boosting) * 0.7 : 0,
      );
      this.filter!.frequency.setTargetAtTime(cutoff, t, 0.07);
      this.gain!.gain.setTargetAtTime(running ? cadence : 0, t, s.boosting ? 0.03 : 0.06);
    } catch {
      this.stop();
    }
  }

  /**
   * Magic wind swell on the same single source: soft rushing air under
   * motion with the water wash on surface water, surging into a boost
   * whoosh. No bells — looped noise only.
   */
  updateMagic(s: HoverEngineState, norm: number, onWater: boolean): void {
    const caps = this.caps;
    if (!caps) return;
    try {
      const ctx = caps.context();
      const t = ctx.currentTime;
      const wind = magicWindGain(norm, s.boosting, onWater);
      const running = s.boosting || wind > 0;
      if (running) this.lastBurnAt = t;
      if (!running && t - this.lastBurnAt > 0.16) {
        this.stop();
        return;
      }
      if (!this.source) {
        if (!running || !caps.claimVoice()) return;
        this.startSource(caps, ctx, magicWindCutoff(norm, s.boosting));
      }
      this.filter!.frequency.setTargetAtTime(magicWindCutoff(norm, s.boosting), t, 0.08);
      this.gain!.gain.setTargetAtTime(running ? wind : 0, t, s.boosting ? 0.03 : 0.07);
    } catch {
      this.stop();
    }
  }

  /** Claim one looped-noise voice through the SFX bus (throws → caller stops). */
  private startSource(caps: HoverEngineCaps, ctx: AudioContext, cutoffHz: number): void {
    this.held = true;
    if (!this.buffer || this.bufferContext !== ctx) {
      this.buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      this.bufferContext = ctx;
      renderEngineNoise(this.buffer.getChannelData(0));
    }
    this.source = ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.loop = true;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = cutoffHz;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.source.connect(this.filter);
    this.filter.connect(this.gain);
    this.gain.connect(caps.sfxBus);
    this.source.start();
  }

  stop(): void {
    this.lastBurnAt = -Infinity;
    try {
      this.source?.stop();
    } catch {
      /* Partial or stopped source. */
    }
    for (const node of [this.source, this.filter, this.gain]) {
      try {
        node?.disconnect();
      } catch {
        /* Continue cleaning siblings. */
      }
    }
    this.source = null;
    this.filter = null;
    this.gain = null;
    if (this.held) {
      this.held = false;
      try {
        this.caps?.releaseVoice();
      } catch {
        /* Audio is optional. */
      }
    }
  }
}
