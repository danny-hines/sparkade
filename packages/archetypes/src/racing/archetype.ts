// Racing archetype (hover cup): schema-validated spec in, GameInstance out.
// Geometry always comes from the three proven templates; the spec only
// supplies bounded identity (names, pace, themes, songs, timeouts).
import { ARCHETYPE_SCHEMAS, type GameSpec, type RacingSpec } from '@sparkade/shared';
import type { Archetype } from '../types';
import { estimateRacingDurationS, lintRacing } from './lint';
import { createRacingGame, RACING_CONTROLS } from './game';

export const racing: Archetype = {
  id: 'racing',
  version: '1.0.0',
  schema: ARCHETYPE_SCHEMAS.racing,
  lint: (spec: GameSpec) => lintRacing(spec as RacingSpec),
  estimateDurationS: (spec: GameSpec) => estimateRacingDurationS(spec as RacingSpec),
  create: (engine, spec) => createRacingGame(engine, spec as RacingSpec),
  controlHelp: RACING_CONTROLS,
  contentFloors: {
    levels: 3,
    enemyTypes: 4,
    bossPhases: 0,
    extras: [
      'exactly 3 circuits, 3 laps each, 4 AI rivals per race',
      'a named finale rival (pace only — zero combat phases)',
      'one music song per circuit plus victory/gameover/levelIntro jingles',
    ],
  },
};
