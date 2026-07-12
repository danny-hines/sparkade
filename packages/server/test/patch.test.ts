import { describe, expect, it } from 'vitest';
import { applyPatch, PatchError, type JsonPatchOp } from '../src/pipeline/patch';

const doc = () => ({
  archetype: 'platformer',
  seed: 42,
  meta: { title: 'Keep Me', tagline: 'old' },
  levels: [{ name: 'one' }, { name: 'two' }],
  music: { bpm: 120 },
});

describe('RFC 6902 patch application', () => {
  it('applies add/replace/remove/move/copy/test', () => {
    const out = applyPatch(doc(), [
      { op: 'replace', path: '/music/bpm', value: 140 },
      { op: 'add', path: '/levels/-', value: { name: 'three' } },
      { op: 'remove', path: '/levels/0' },
      { op: 'copy', from: '/levels/0', path: '/levels/-' },
      { op: 'move', from: '/meta/tagline', path: '/meta/subtitle' },
      { op: 'test', path: '/music/bpm', value: 140 },
    ] as JsonPatchOp[]);
    expect(out.music.bpm).toBe(140);
    expect(out.levels.map((l: { name: string }) => l.name)).toEqual(['two', 'three', 'two']);
    expect((out.meta as Record<string, unknown>).subtitle).toBe('old');
    expect((out.meta as Record<string, unknown>).tagline).toBeUndefined();
  });

  it('never mutates the input document', () => {
    const original = doc();
    const snapshot = JSON.stringify(original);
    applyPatch(original, [{ op: 'replace', path: '/music/bpm', value: 99 }]);
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it('enforces the repair guards: archetype/seed/meta.title/specVersion are untouchable', () => {
    for (const path of ['/archetype', '/seed', '/meta/title', '/specVersion']) {
      expect(() => applyPatch(doc(), [{ op: 'replace', path, value: 'hax' }]), path).toThrow(PatchError);
    }
    // nested under a forbidden prefix too
    expect(() => applyPatch(doc(), [{ op: 'remove', path: '/meta/title' }])).toThrow(PatchError);
    // moving FROM a guarded path is also blocked
    expect(() =>
      applyPatch(doc(), [{ op: 'move', from: '/meta/title', path: '/meta/tagline' }]),
    ).toThrow(PatchError);
    // but /meta/tagline is fine
    expect(() => applyPatch(doc(), [{ op: 'replace', path: '/meta/tagline', value: 'new' }])).not.toThrow();
  });

  it('rejects malformed patches with clear errors', () => {
    expect(() => applyPatch(doc(), [{ op: 'replace', path: '/nope/x', value: 1 }])).toThrow(PatchError);
    expect(() => applyPatch(doc(), [{ op: 'test', path: '/music/bpm', value: 999 }])).toThrow(/test failed/);
    expect(() => applyPatch(doc(), [{ op: 'add', path: '/levels/99', value: {} }])).toThrow(PatchError);
    expect(() => applyPatch(doc(), 'not-an-array' as unknown as JsonPatchOp[])).toThrow(PatchError);
    expect(() => applyPatch(doc(), [{ op: 'weird', path: '/x' } as unknown as JsonPatchOp])).toThrow(PatchError);
  });

  it('unescapes ~0 and ~1 in pointers', () => {
    const out = applyPatch({ 'a/b': { 'c~d': 1 } }, [{ op: 'replace', path: '/a~1b/c~0d', value: 2 }]);
    expect(out['a/b']['c~d']).toBe(2);
  });
});
