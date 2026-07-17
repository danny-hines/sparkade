import { describe, expect, it } from 'vitest';
import { goldenExcerpt, loadGolden, loadTemplate, renderTemplate } from '@sparkade/generation';

describe('prompt templates', () => {
  it('all seven templates exist and render with their placeholders filled', () => {
    // Variable content (player request, design doc, diagnostics) lives in the
    // USER message so the system prompt stays byte-identical → prefix-cacheable.
    const vars: Record<string, Record<string, string>> = {
      design: { GOLDEN_EXCERPT: '{}', PALETTE_COOKBOOK: '- Ember Dusk — warm', SCHEMA: '{"type":"object"}' },
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

  it('golden excerpts are valid JSON slices of the goldens', () => {
    for (const archetype of ['platformer', 'shooter', 'adventure', 'hshooter', 'fighter'] as const) {
      const golden = loadGolden(archetype);
      expect(golden.meta.title.length).toBeGreaterThan(0);
      for (const stage of ['design', 'levels', 'entities', 'music'] as const) {
        const excerpt = goldenExcerpt(archetype, stage);
        expect(() => JSON.parse(excerpt), `${archetype}/${stage}`).not.toThrow();
      }
    }
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
});
