// Racing semantic lints: exactly the 3 proven template circuits, bounded
// fair rival pace, a finale rival that is only a name plus pace (no combat),
// resolvable music, and the five-minute duration floor.
import type { LintError, RacingSpec } from '@sparkade/shared';
import { err, lintDuration, lintMusic, lintSongRef } from '../common';
import { RACE_CIRCUITS, compileTrackVariant } from './track';

const TEMPLATE_IDS = new Set(RACE_CIRCUITS.map((c) => c.id));

/** Expected cup pace (units/s) used for the duration estimate. */
export const RACING_ESTIMATE_SPEED = 60;

export function lintRacing(spec: RacingSpec): LintError[] {
  const out: LintError[] = [];
  out.push(...lintMusic(spec));

  if (spec.levels.length !== RACE_CIRCUITS.length) {
    out.push(
      err(
        'RACING_CIRCUIT_COUNT',
        '/levels',
        `cup has ${spec.levels.length} circuits; exactly ${RACE_CIRCUITS.length} are required`,
      ),
    );
  }
  spec.levels.forEach((circuit, ci) => {
    const path = `/levels/${ci}`;
    // One race's four rivals must be distinct; the same cast recurs across
    // the cup, so names intentionally repeat between circuits.
    const rivalNames = new Set<string>();
    if (!TEMPLATE_IDS.has(circuit.template)) {
      out.push(
        err(
          'RACING_UNKNOWN_TEMPLATE',
          `${path}/template`,
          `unknown circuit template "${circuit.template}"; geometry must come from a proven template`,
        ),
      );
    }
    if (circuit.forks === 'split' && TEMPLATE_IDS.has(circuit.template)) {
      try {
        const compiled = compileTrackVariant(circuit.template, {
          length: circuit.length,
          mirror: circuit.mirror,
          elevation: circuit.elevation,
          jumps: circuit.jumps,
          forks: 'split',
        });
        if (compiled.fork === undefined) out.push(err(
          'RACING_FORK_LAYOUT', `${path}/forks`,
          'No safe fork interval exists with these options. Use length 3600 without ramps on this course, or omit forks.',
        ));
      } catch {
        out.push(err('RACING_FORK_LAYOUT', `${path}/forks`, 'Invalid course options for a fork layout.'));
      }
    }
    if (circuit.laps !== 3) {
      out.push(err('RACING_LAPS', `${path}/laps`, `cup races are always 3 laps, got ${circuit.laps}`));
    }
    out.push(...lintSongRef(circuit.musicSong, `${path}/musicSong`, spec));
    if (circuit.rivals.length !== 4) {
      out.push(
        err(
          'RACING_RIVAL_COUNT',
          `${path}/rivals`,
          `race has ${circuit.rivals.length} AI rivals; exactly 4 are required`,
        ),
      );
    }
    circuit.rivals.forEach((rival, ri) => {
      const rpath = `${path}/rivals/${ri}`;
      if (!(rival.topScale >= 0.7 && rival.topScale <= 1.0)) {
        out.push(
          err(
            'RACING_UNFAIR_PACE',
            `${rpath}/topScale`,
            `topScale ${rival.topScale} is outside the fair band 0.7-1.0 (rivals may never outrun player top speed)`,
          ),
        );
      }
      if (rivalNames.has(rival.name)) {
        out.push(err('RACING_DUP_NAME', `${rpath}/name`, `rival name "${rival.name}" is used twice in the cup`));
      }
      rivalNames.add(rival.name);
    });
    if (circuit.length !== undefined && (circuit.length < 2800 || circuit.length > 3600)) {
      out.push(
        err(
          'RACING_LENGTH',
          `${path}/length`,
          `length ${circuit.length} is outside 2800-3600 units (templates only rescale within the tested band)`,
        ),
      );
    }
    if (circuit.timeoutS !== undefined && (circuit.timeoutS < 220 || circuit.timeoutS > 400)) {
      out.push(
        err(
          'RACING_TIMEOUT',
          `${path}/timeoutS`,
          `timeoutS ${circuit.timeoutS} is outside 220-400s (a 3-lap race must stay winnable with margin)`,
        ),
      );
    }
  });

  // Cup integrity: the same driver occupies the same slot in every race
  // (cup points key by index), and the cup runs exactly one of each tested
  // template — never a renamed mid-cup rival or a repeated circuit.
  if (spec.levels.length === RACE_CIRCUITS.length) {
    spec.levels.forEach((circuit, ci) => {
      circuit.rivals.forEach((rival, ri) => {
        const first = spec.levels[0]!.rivals[ri]?.name;
        if (rival.name !== first) {
          out.push(
            err(
              'RACING_RIVAL_SLOTS',
              `/levels/${ci}/rivals/${ri}/name`,
              `rival "${rival.name}" sits in slot ${ri + 1} but "${first}" holds it elsewhere; keep one cast all cup`,
            ),
          );
        }
      });
    });
    const templates = new Set(spec.levels.map((l) => l.template));
    if (templates.size !== RACE_CIRCUITS.length) {
      out.push(
        err(
          'RACING_TEMPLATE_SET',
          '/levels',
          `cup runs templates [${[...templates].join(', ')}]; run exactly one of each proven template per cup`,
        ),
      );
    }
  }

  // Identity consistency: rival vehicle concepts name the same cup cast in
  // the same slots (schema enforces the shape; this enforces the join).
  // Legacy specs omit identity and skip this entirely.
  if (spec.identity) {
    spec.identity.rivalCrafts.forEach((craft, ri) => {
      for (let ci = 0; ci < spec.levels.length; ci++) {
        const seated = spec.levels[ci]?.rivals[ri]?.name;
        if (seated !== undefined && seated !== craft.name) {
          out.push(
            err(
              'RACING_IDENTITY_CAST',
              `/identity/rivalCrafts/${ri}/name`,
              `rival craft "${craft.name}" does not match the cup cast in slot ${ri + 1} ("${seated}")`,
            ),
          );
        }
      }
    });
  }

  // Finale rival: name + pace only. Anything combat-shaped is rejected.
  const boss = spec.boss;
  const finale = spec.levels[spec.levels.length - 1];
  if (boss.rivalIndex < 1 || boss.rivalIndex > 4) {
    out.push(
      err('RACING_BOSS_INDEX', '/boss/rivalIndex', `rivalIndex ${boss.rivalIndex} must pick a finale rival (1-4, never the player)`),
    );
  } else if (finale) {
    const rival = finale.rivals[boss.rivalIndex - 1];
    if (rival && rival.name !== boss.name) {
      out.push(
        err(
          'RACING_BOSS_NAME',
          '/boss/name',
          `boss name "${boss.name}" does not match finale rival ${boss.rivalIndex} ("${rival.name}")`,
        ),
      );
    }
    if (rival && rival.topScale !== boss.topScale) {
      out.push(
        err(
          'RACING_BOSS_PACE',
          '/boss/topScale',
          `boss topScale ${boss.topScale} does not match finale rival ${boss.rivalIndex} (${rival.topScale})`,
        ),
      );
    }
  }
  if (!(boss.topScale >= 0.9 && boss.topScale <= 1.0)) {
    out.push(
      err('RACING_BOSS_FAIR', '/boss/topScale', `boss topScale ${boss.topScale} is outside the finale band 0.9-1.0`),
    );
  }
  for (const key of Object.keys(boss)) {
    if (!['name', 'title', 'rivalIndex', 'topScale', 'titleQuote'].includes(key)) {
      out.push(
        err('RACING_BOSS_SHAPE', `/boss/${key}`, `racing bosses carry name + pace only; "${key}" looks combat-shaped`),
      );
    }
  }

  out.push(...lintDuration(estimateRacingDurationS(spec)));
  return out;
}

export function estimateRacingDurationS(spec: RacingSpec): number {
  let total = 0;
  for (const circuit of spec.levels) {
    const template = RACE_CIRCUITS.find((c) => c.id === circuit.template);
    // Authored length overrides change real lap distance, so they price in.
    const length = circuit.length ?? template?.track.length ?? 3200;
    total += 3 + (circuit.laps * length) / RACING_ESTIMATE_SPEED;
  }
  return total;
}
