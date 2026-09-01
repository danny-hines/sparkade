import { describe, expect, it } from 'vitest';
import { goldenExcerpt, loadGolden, loadTemplate, renderTemplate } from '@sparkade/generation';

describe('prompt templates', () => {
  it('all seven templates exist and render with their placeholders filled', () => {
    // Variable content (player request, design doc, diagnostics) lives in the
    // USER message so the system prompt stays byte-identical → prefix-cacheable.
    const vars: Record<string, Record<string, string>> = {
      design: {
        GOLDEN_EXCERPT: '{}',
        PALETTE_COOKBOOK: '- Ember Dusk — warm',
        SCHEMA: '{"type":"object"}',
      },
      'levels-platformer': { GOLDEN_EXCERPT: '{}', SCHEMA: '{}' },
      'levels-shooter': { GOLDEN_EXCERPT: '{}', SCHEMA: '{}' },
      'levels-adventure': { GOLDEN_EXCERPT: '{}', SCHEMA: '{}' },
      'levels-hshooter': { GOLDEN_EXCERPT: '{}', SCHEMA: '{}' },
      'levels-fighter': { GOLDEN_EXCERPT: '{}', SCHEMA: '{}' },
      entities: {
        ARCHETYPE: 'platformer',
        LIB_SPRITES: 'hero_squire',
        RESKIN_NOTES: 'notes',
        BOSS_NOTES: 'notes',
        GOLDEN_EXCERPT: '{}',
        SCHEMA: '{}',
      },
      music: { GOLDEN_EXCERPT: '{}', SCHEMA: '{}' },
      repair: { SCHEMA: '{}' },
    };
    for (const [name, v] of Object.entries(vars)) {
      const template = loadTemplate(name as Parameters<typeof loadTemplate>[0]);
      const rendered = renderTemplate(template, v);
      expect(rendered.length, name).toBeGreaterThan(200);
      expect(rendered, name).not.toMatch(/\{\{[A-Z0-9_]+\}\}/); // nothing unfilled
    }
  });

  it('rendering with a missing placeholder value throws (templates and code must agree)', () => {
    expect(() => renderTemplate('hello {{NOPE}}', {})).toThrow(/NOPE/);
  });

  it('design template carries the standing safety rules verbatim', () => {
    const t = loadTemplate('design');
    expect(t).toMatch(/UNTRUSTED CREATIVE INPUT/);
    expect(t).toMatch(/family-friendly/);
    expect(t).toMatch(/Never trademarked/i);
    expect(t).toMatch(/closest supported archetype/);
  });

  it('keeps platformer plans within the runtime and display strings complete', () => {
    const t = loadTemplate('design');
    expect(t).toContain('Plan ONLY what this runtime can deliver');
    expect(t).toContain('walker/flyer/shooter/chaser');
    expect(t).toContain('springs; moving platforms');
    expect(t).toContain("player's run/jump/spin/throw verbs");
    expect(t).toContain('Do NOT promise glide, collapsing tiles, pendulums');
    expect(t).toContain('invented cast roles such as `bruiser`');
    expect(t).toContain('NEVER truncate a string or cut off its final word');
    expect(t).toContain('target at most 28 characters for `title`');
    expect(t).toContain('Choose camera framing and source-art detail independently');
    expect(t).toContain('New games MUST use `platformerArtDensity: detailed`');
    expect(t).toContain('Always choose one `movementProfile`');
    expect(t).toContain('`precision` for crisp exact control');
    expect(t).toContain('`momentum` for speed with retained inertia');
    expect(t).toContain('do not emit the legacy numeric `feel` object');
    expect(t).toContain('`heroConcept` is the canonical visual contract');
    expect(t).toContain('immutable identity truth from the neck up');
    expect(t).toContain("source photo's shirt or other clothing below the neck is NOT identity");
  });

  it('golden excerpts are valid JSON slices of the goldens', () => {
    for (const archetype of [
      'platformer',
      'shooter',
      'adventure',
      'hshooter',
      'fighter',
    ] as const) {
      const golden = loadGolden(archetype);
      expect(golden.meta.title.length).toBeGreaterThan(0);
      for (const stage of ['design', 'levels', 'entities', 'music'] as const) {
        const excerpt = goldenExcerpt(archetype, stage);
        expect(() => JSON.parse(excerpt), `${archetype}/${stage}`).not.toThrow();
      }
    }
  });

  it('shows the platformer movement profile in the design example', () => {
    const excerpt = JSON.parse(goldenExcerpt('platformer', 'design')) as {
      movementProfile?: string;
    };
    expect(excerpt.movementProfile).toBe('balanced');
  });

  it('teaches the fighter levels stage to author the player and outfit', () => {
    const excerpt = JSON.parse(goldenExcerpt('fighter', 'levels')) as {
      player?: { outfit?: string };
    };
    expect(excerpt.player?.outfit).toBe('gi');
    const prompt = loadTemplate('levels-fighter');
    expect(prompt).toContain('one `player`');
    expect(prompt).toContain('`wrestler`');
    expect(prompt).toContain('REQUIRED `outfit`');
  });

  it('teaches Adventure generation the full-width room and safe functional puzzle contract', () => {
    const prompt = loadTemplate('levels-adventure');

    expect(prompt).toContain('EXACTLY 16 rows of EXACTLY 32 chars');
    expect(prompt).toContain('continuous hazard-free walking path');
    expect(prompt).toContain('Switches are functional, never decorative');
    expect(prompt).toContain('at least one pushable block for every switch');
  });

  it('teaches platformer generation the two-tile body and omits engine-owned grid art', () => {
    const excerpt = JSON.parse(goldenExcerpt('platformer', 'levels')) as {
      levels: Array<{ tiles: string[]; legend: Record<string, string> }>;
    };
    const example = excerpt.levels[0]!;
    expect(Object.values(example.legend)).not.toContain('decoration');
    expect(Object.values(example.legend)).not.toContain('exit');

    const prompt = loadTemplate('levels-platformer');
    expect(prompt).toContain('1 tile wide and 2 tiles tall');
    expect(prompt).toContain('LOWER/FOOT cell');
    expect(prompt).toContain('Do NOT author `decoration` or `exit` cells');
    expect(prompt).toContain('one-tile-high tunnels');
    expect(prompt).toContain('one semantic value per cell');
    expect(prompt).toContain('never add separate cap/inner characters');
    expect(prompt).toContain('engine selects exposed cap art versus buried inner art');
    expect(prompt).toContain('`"heroic"` uses a close 2x camera');
    expect(prompt).toContain('≤ 8 near any heroic screen');
    expect(prompt).toContain('Choose neither, one, or both');
    expect(prompt).toContain('never add them merely to satisfy a quota');
    expect(prompt).toContain('coherent runs of 4–10 cells');
    expect(prompt).toContain('never ice or conveyors');
  });

  it('teaches platformer entity generation to pair themed cap and inner art', () => {
    const excerpt = JSON.parse(goldenExcerpt('platformer', 'entities')) as {
      sprites: { assign: Record<string, string> };
    };

    expect(excerpt.sprites.assign.tile_solid).toBe('lib:clockwork_solid');
    expect(excerpt.sprites.assign.tile_solid_inner).toBe('lib:clockwork_solid_inner');
  });

  it('teaches Adventure generation that the item is required before the boss gate', () => {
    const designPrompt = loadTemplate('design');
    expect(designPrompt).toContain('equipped from the start');
    expect(designPrompt).toContain('REQUIRED `combatKit`');
    expect(designPrompt).toContain('`close` for fists/knife');
    expect(designPrompt).toContain('`shot` for bow/gun/blaster');
    expect(designPrompt).toContain('do not default every premise to fantasy gear');
    const prompt = loadTemplate('levels-adventure');
    expect(prompt).toContain('combatKit.secondary.behavior');
    expect(prompt).toContain('required boss preparation');
    expect(prompt).toContain('Every connection into `bossRoom` must be a `boss` door');
    expect(prompt).toContain(
      'refuses to open that gate until the secondary item has been collected',
    );
  });
});
