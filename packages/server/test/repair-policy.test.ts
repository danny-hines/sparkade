import { describe, expect, it } from 'vitest';
import { PatchError, type JsonPatchOp } from '../src/pipeline/patch';
import {
  assertPatchTargetsOwner,
  diagnosticOwner,
  failingLevelIndexes,
  repairMadeProgress,
} from '../src/pipeline/repair-policy';

describe('owner-scoped repair policy', () => {
  it('classifies diagnostics and extracts only explicitly failing levels', () => {
    expect(diagnosticOwner({ code: 'X', path: '/music/bpm', message: 'bad' })).toBe('music');
    expect(diagnosticOwner({ code: 'X', path: '/boss/hp', message: 'bad' })).toBe('entities');
    expect(diagnosticOwner({ code: 'X', path: '/levels/2/tiles', message: 'bad' })).toBe('levels');
    expect(diagnosticOwner({ code: 'X', path: '/difficulty/enemyHp', message: 'bad' })).toBe(
      'document',
    );
    expect(
      failingLevelIndexes([
        { code: 'A', path: '/levels/2/tiles', message: 'bad' },
        { code: 'B', path: '/levels/0/entities/1', message: 'bad' },
        { code: 'C', path: '/music/bpm', message: 'bad' },
      ]),
    ).toEqual([0, 2]);
  });

  it('rejects cross-owner and non-surgical patch operations', () => {
    const diagnostics = [{ code: 'X', path: '/levels/1/tiles', message: 'bad' }];
    expect(() =>
      assertPatchTargetsOwner(
        [{ op: 'replace', path: '/music/bpm', value: 120 }],
        'levels',
        diagnostics,
      ),
    ).toThrow(PatchError);
    expect(() =>
      assertPatchTargetsOwner(
        [{ op: 'replace', path: '/levels', value: [] }],
        'levels',
        diagnostics,
      ),
    ).toThrow(PatchError);
    expect(() =>
      assertPatchTargetsOwner(
        [{ op: 'replace', path: '/levels/0/name', value: 'healthy sibling' }],
        'levels',
        diagnostics,
      ),
    ).toThrow(PatchError);
    expect(() =>
      assertPatchTargetsOwner(
        [{ op: 'replace', path: '/levels/1/name', value: 'fixed' }],
        'levels',
        diagnostics,
      ),
    ).not.toThrow();
    expect(() =>
      assertPatchTargetsOwner(
        [{ op: 'copy', from: '/levels/0', path: '/levels/1' } as JsonPatchOp],
        'levels',
        diagnostics,
      ),
    ).toThrow(PatchError);
    expect(() =>
      assertPatchTargetsOwner({ op: 'replace' } as unknown as JsonPatchOp[], 'levels', diagnostics),
    ).toThrow(PatchError);
    expect(() =>
      assertPatchTargetsOwner([null] as unknown as JsonPatchOp[], 'levels', diagnostics),
    ).toThrow(PatchError);
    expect(() =>
      assertPatchTargetsOwner(
        new Array(61).fill({ op: 'remove', path: '/levels/0' }) as JsonPatchOp[],
        'levels',
        diagnostics,
      ),
    ).toThrow(PatchError);
  });

  it('only retries a changed or strictly improved diagnostic set', () => {
    const before = [{ code: 'A', path: '/levels/0', message: 'first' }];
    expect(repairMadeProgress(before, before)).toBe(false);
    expect(repairMadeProgress(before, [])).toBe(true);
    expect(
      repairMadeProgress(before, [{ code: 'B', path: '/levels/0', message: 'revealed next' }]),
    ).toBe(true);
  });
});
