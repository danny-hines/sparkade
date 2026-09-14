// The race soundscape owns at most three continuous sources: the player,
// boost roar, and up to two nearby rivals. Four music voices and one transient
// still fit the shared eight-voice budget. No physics or player assists here.
import type { RacingEngineProfile } from '@sparkade/shared';
import { HoverEngine, type HoverEngineCaps, type HoverEngineState } from './audio';
import { LEGACY_RIVAL, resolveEngineProfile, type ResolvedEngineProfile } from './sound-profile';

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
 * omit it for the exact legacy pitch.
 */
export function rivalSound(
  player: AudibleRacer,
  rival: AudibleRacer,
  index: number,
  length: number,
  profile?: RacingEngineProfile | null,
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
  return {
    index,
    distance,
    pan: Math.max(-0.9, Math.min(0.9, dx / (5 + Math.abs(ds) * 0.16))),
    gain: envelope * (0.025 + motion * 0.11),
    pitchHz:
      (LEGACY_RIVAL.baseHz +
        Math.min(LEGACY_RIVAL.speedCap, Math.abs(rival.speed)) * LEGACY_RIVAL.speedCoef +
        index * LEGACY_RIVAL.indexStep) *
      doppler *
      ratio,
  };
}

class RivalVoice {
  info: RivalSound | null = null;
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private pan: StereoPannerNode | null = null;
  private voice: ResolvedEngineProfile = resolveEngineProfile();
  private rawFamily: RacingEngineProfile['family'] | undefined = undefined;
  private rawTone: number | undefined = undefined;
  private rawPitch: number | undefined = undefined;
  private held = false;
  constructor(private caps: HoverEngineCaps) {}

  /**
   * Voice this rival's timbre. Stores parameters only (no nodes, no
   * claim); a running voice switches timbre live. Steady-state repeats
   * with the same input return after three field compares, so per-update
   * calls allocate no nodes and no parameter objects.
   */
  setProfile(profile?: RacingEngineProfile | null): void {
    if (
      profile?.family === this.rawFamily &&
      profile?.tone === this.rawTone &&
      profile?.pitch === this.rawPitch
    ) {
      return;
    }
    this.rawFamily = profile?.family;
    this.rawTone = profile?.tone;
    this.rawPitch = profile?.pitch;
    this.voice = resolveEngineProfile(profile ?? null);
    try {
      if (this.osc) this.osc.type = this.voice.oscType;
    } catch {
      // A dead voice must never break a profile switch.
    }
  }

  update(info: RivalSound): void {
    try {
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

  stop(): void {
    try {
      this.osc?.stop();
    } catch {
      /* Partial/stopped oscillator. */
    }
    for (const node of [this.osc, this.filter, this.gain, this.pan]) {
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

  /**
   * Optional authored timbres: the player voice plus per-rival voices in
   * stable cast order (entry 0 voices the first non-player racer).
   * Omit/null anywhere for the exact legacy mix on that voice; a missing
   * rival entry falls back to the player profile.
   */
  constructor(
    player?: RacingEngineProfile | null,
    rivals?: (RacingEngineProfile | null | undefined)[],
  ) {
    this.setProfile(player, rivals);
  }

  /**
   * Select timbres (identity.sound.engine for the player, themed voices
   * per rival). Stores parameters only: no nodes, no claims. Safe to call
   * before attach and while voices are playing.
   */
  setProfile(
    player?: RacingEngineProfile | null,
    rivals?: (RacingEngineProfile | null | undefined)[],
  ): void {
    this.playerProfile = player ?? null;
    this.rivalProfiles = rivals ? [...rivals] : [];
    this.player.setProfile(this.playerProfile);
    for (let i = 0; i < this.voices.length; i++) {
      const sounding = this.voices[i]!.info;
      this.voices[i]!.setProfile(
        this.rivalProfileFor(sounding ? sounding.index : i),
      );
    }
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
    for (const voice of this.voices) voice.setProfile(this.playerProfile);
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
    // Free the quieter rival before igniting a second player source.
    if (state.boosting) {
      const sounding = this.voices.filter((v) => v.info);
      if (sounding.length > 1) sounding.sort((a, b) => a.info!.gain - b.info!.gain)[0]!.stop();
    }
    this.player.update(state);
    const count = Math.min(state.boosting ? 1 : 2, Math.max(0, 3 - this.player.sources));
    const candidates = racers.flatMap((r, i) => {
      if (i === playerIndex) return [];
      const s = rivalSound(racers[playerIndex]!, r, i, length, this.rivalProfileFor(i));
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
      // Voice the slot for this rival (steady-state: three field compares,
      // no allocation); the pitch already carries the same profile.
      voice?.setProfile(this.rivalProfileFor(candidate.index));
      voice?.update(candidate);
    }
  }

  stop(): void {
    this.player.stop();
    for (const v of this.voices) v.stop();
  }
}
