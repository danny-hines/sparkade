import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GameSpec } from '@sparkade/shared';
import {
  applySpriteFallbacks,
  securityScan,
  spriteProblem,
  titleSimilarity,
  tooSimilar,
  validateGameSchema,
} from '../src/pipeline/validate';
import { repoRoot } from '../src/util';

function golden(archetype: string): GameSpec {
  return JSON.parse(
    readFileSync(join(repoRoot(), 'packages/generation/golden', `golden-${archetype}.json`), 'utf8'),
  );
}

describe('security scan', () => {
  it('injection strings in display fields are rejected and stay inert', () => {
    const attacks = [
      '<script>alert(1)</script>',
      'visit https://evil.example now',
      'see www.evil.example',
      'run eval(document.cookie)',
      'x => fetch(secrets)',
      'read /etc/passwd please',
      'open ..\\..\\secrets.txt',
      'hello {{template}} world',
      'money ${process.env.KEY}',
      '<img src=x onerror=alert(1)>',
    ];
    for (const attack of attacks) {
      const spec = golden('shooter');
      spec.story.bossIntro = attack;
      const findings = securityScan(spec); // must not throw — inert handling
      expect(findings.length, attack).toBeGreaterThan(0);
      expect(findings[0]!.code).toBe('SCAN_REJECTED');
      expect(findings[0]!.path).toContain('/story/bossIntro');
    }
  });

  it('unknown sprite ids are flagged', () => {
    const spec = golden('platformer');
    spec.sprites.assign['walker'] = 'lib:totally_fake_sprite';
    const findings = securityScan(spec);
    expect(findings.some((f) => f.code === 'SCAN_UNKNOWN_ID')).toBe(true);
  });

  it('clean golden games scan clean', () => {
    for (const a of ['platformer', 'shooter', 'adventure']) {
      expect(securityScan(golden(a))).toEqual([]);
    }
  });
});

describe('custom sprite checks + silent fallback', () => {
  it('flags dimension, charset and coverage problems', () => {
    expect(spriteProblem({ w: 8, h: 8, rows: new Array(7).fill('11111111') })).toMatch(/rows.length/);
    expect(spriteProblem({ w: 8, h: 2, rows: ['1111111', '11111111'] })).toMatch(/row 0 length/);
    expect(spriteProblem({ w: 8, h: 2, rows: ['1111111Z', '11111111'] })).toMatch(/invalid characters/);
    expect(spriteProblem({ w: 8, h: 8, rows: new Array(8).fill('........') })).toMatch(/opaque/);
    expect(spriteProblem({ w: 8, h: 8, rows: new Array(8).fill('ffffffff') })).toMatch(/opaque/);
    expect(
      spriteProblem({ w: 4, h: 4, rows: ['.ff.', 'f11f', 'f11f', '.ff.'] }),
    ).toBeNull();
  });

  it('falls back silently to the assigned library sprite (a downgrade, not an error)', () => {
    const spec = golden('platformer');
    spec.sprites.custom['broken'] = { w: 8, h: 8, rows: ['........'] }; // wrong row count
    spec.sprites.assign['hero'] = 'custom:broken';
    const { spec: fixed, downgraded } = applySpriteFallbacks(spec);
    expect(downgraded.length).toBeGreaterThan(0);
    expect(fixed.sprites.custom['broken']).toBeUndefined();
    expect(fixed.sprites.assign['hero']).toBe('lib:hero_squire');
    // the sanitized spec still passes schema
    expect(validateGameSchema('platformer', fixed)).toEqual([]);
  });

  it('keeps well-formed animation frames and drops malformed ones', () => {
    const spec = golden('platformer');
    const good = ['.ff.', 'f11f', 'f11f', '.ff.'];
    const alt = ['.ff.', '1ff1', '1ff1', '.ff.'];
    spec.sprites.custom['anim'] = { w: 4, h: 4, rows: good, frames: [alt, ['too', 'short']] };
    spec.sprites.assign['walker'] = 'custom:anim';
    const { spec: fixed } = applySpriteFallbacks(spec);
    // the sprite survives; only the valid extra frame is kept
    expect(fixed.sprites.custom['anim']).toBeDefined();
    expect(fixed.sprites.custom['anim']!.frames).toEqual([alt]);
    expect(fixed.sprites.assign['walker']).toBe('custom:anim');
  });
});

describe('title similarity (anti-duplicate)', () => {
  it('scores identical/contained/near titles high, distinct ones low', () => {
    expect(titleSimilarity('Emberwick Ascent', 'Emberwick Ascent')).toBe(1);
    expect(titleSimilarity('Emberwick Ascent', 'emberwick ascent!')).toBeGreaterThan(0.9);
    expect(titleSimilarity('Emberwick Ascent', 'Emberwick Ascent II')).toBeGreaterThanOrEqual(0.9);
    expect(titleSimilarity('Emberwick Ascent', 'Void Petal')).toBeLessThan(0.5);
    expect(tooSimilar('The Hollow Bell', ['Void Petal', 'The Hollow Bell'])).toBe('The Hollow Bell');
    expect(tooSimilar('Garden Defense Orbit', ['Void Petal'])).toBeNull();
  });
});

describe('tile-grid normalization (LLMs miscount fixed-width rows)', () => {
  it('pads short rows with empty sky and trims all-empty overhang', async () => {
    const { normalizeTileGrids } = await import('../src/pipeline/validate');
    const spec = golden('platformer');
    const level = (spec as { levels: { tiles: string[] }[] }).levels[0]!;
    const w = level.tiles[0]!.length;
    level.tiles[3] = level.tiles[3]!.slice(0, w - 4); // 4 chars short
    level.tiles[5] = level.tiles[5]! + '...'; // trailing-empty overhang
    const fixed = normalizeTileGrids(spec) as typeof spec & { levels: { tiles: string[] }[] };
    for (const row of fixed.levels[0]!.tiles) expect(row.length).toBe(w);
    // padded with '.' (empty), never with terrain
    expect(fixed.levels[0]!.tiles[3]!.slice(w - 4)).toBe('....');
  });

  it('leaves non-empty overhang alone for the lint to catch honestly', async () => {
    const { normalizeTileGrids } = await import('../src/pipeline/validate');
    const spec = golden('platformer');
    const level = (spec as { levels: { tiles: string[] }[] }).levels[0]!;
    level.tiles[3] = level.tiles[3]! + '##'; // real terrain overhang — ambiguous, do not guess
    const fixed = normalizeTileGrids(spec) as typeof spec & { levels: { tiles: string[] }[] };
    expect(fixed.levels[0]!.tiles[3]!.endsWith('##')).toBe(true);
  });
});
