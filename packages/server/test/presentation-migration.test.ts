import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { mechanicalFingerprint, type PlatformerSpec } from '@sparkade/shared';
import { GameFiles } from '../src/storage/files';
import { migratePlatformerPresentations } from '../src/storage/presentation-migration';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
it('upgrades missing presentation once, backs up original bytes, and keeps mechanics and explicit styles', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sparkade-presentation-'));
  dirs.push(dir);
  const files = new GameFiles(dir);
  const legacy = JSON.parse(
    readFileSync(join(__dirname, '../../generation/golden/golden-platformer.json'), 'utf8'),
  ) as PlatformerSpec;
  delete legacy.presentationFamily;
  files.writeSpec('old', legacy);
  const original = readFileSync(join(files.gameDir('old'), 'game.json'), 'utf8');
  files.writeSpec('chosen', { ...legacy, presentationFamily: 'tech' });
  const chosen = readFileSync(join(files.gameDir('chosen'), 'game.json'), 'utf8');
  const list = [
    { id: 'old', status: 'ready' },
    { id: 'chosen', status: 'ready' },
  ];
  expect(migratePlatformerPresentations(files, list)).toEqual({ migrated: 1, failed: [] });
  const upgraded = files.readSpec('old') as PlatformerSpec;
  const { presentationFamily, ...rest } = upgraded;
  expect(presentationFamily).toBeTruthy();
  expect(rest).toEqual(legacy);
  expect(readFileSync(join(files.gameDir('old'), 'presentation-before-v1.json'), 'utf8')).toBe(
    original,
  );
  expect(readFileSync(join(files.gameDir('chosen'), 'game.json'), 'utf8')).toBe(chosen);
  writeFileSync(join(files.gameDir('old'), 'mechanics.json'), '{}');
  expect(migratePlatformerPresentations(files, list)).toEqual({ migrated: 0, failed: [] });
  expect(JSON.parse(readFileSync(join(files.gameDir('old'), 'mechanics.json'), 'utf8'))).toEqual(
    mechanicalFingerprint(upgraded),
  );
});
