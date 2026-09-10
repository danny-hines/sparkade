import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ADVENTURE_PLAY_STYLES,
  ADVENTURE_PUZZLE_PATTERNS,
  adventurePuzzleGeometry,
  mechanicalFingerprint,
  type AdventureSpec,
} from '@sparkade/shared';
import { adventureStyleExample } from '../src/adventure/examples';
import {
  adventureGateChoicesSafe,
  lintAdventure,
  pressurePlatePuzzleSolvable,
} from '../src/adventure/lint';
import { adventure } from '../src/adventure';

const base = JSON.parse(
  readFileSync(join(__dirname, '../../generation/golden/golden-adventure.json'), 'utf8'),
) as AdventureSpec;

describe('Adventure objective packages', () => {
  it('rejects a dungeon where spending the first key on an optional branch strands the main route', () => {
    const spec = adventureStyleExample(base, 'dungeonExpedition');
    const rooms = spec.levels[0]!.rooms;
    const room = (id: string) => rooms.find((r) => r.id === id)!;
    room('crossroads').doors.e = 'locked';
    room('garden').doors.w = 'locked';
    for (const id of ['lesson', 'garden'])
      room(id).entities = room(id).entities.filter((e) => e.type !== 'key');
    room('vault').entities.push({ type: 'key', x: 5, y: 5 }, { type: 'key', x: 25, y: 5 });
    room('archive').entities.push({ type: 'key', x: 25, y: 12 });
    expect(adventureGateChoicesSafe(spec)).toBe(false);
    room('garden').entities.push({ type: 'key', x: 5, y: 12 });
    expect(adventureGateChoicesSafe(spec)).toBe(true);
  });
  it.each(ADVENTURE_PLAY_STYLES)(
    '%s has a valid complete authored reference and distinct fingerprint',
    (style) => {
      const spec = adventureStyleExample(base, style);
      expect(lintAdventure(spec)).toEqual([]);
      expect(mechanicalFingerprint(spec).playStyle).toBe(style);
      expect(base.adventureStyle).toBeUndefined();
    },
  );
  it.each(ADVENTURE_PUZZLE_PATTERNS)(
    '%s is solvable from a room doorway in every variant',
    (pattern) => {
      for (const variant of [0, 1, 2] as const) {
        const room = adventureStyleExample(base, 'puzzleQuest').levels[0]!.rooms[1]!;
        Object.assign(room, adventurePuzzleGeometry({ pattern, variant }));
        expect(pressurePlatePuzzleSolvable(room), `${pattern}/${variant}`).toBe(true);
      }
    },
  );
  it('rejects a rescue quota that requires going through the guardian gate', () => {
    const spec = adventureStyleExample(base, 'rescueRaid');
    const dungeon = spec.levels[0]!;
    for (const room of dungeon.rooms)
      for (const entity of room.entities) delete entity.props?.rescue;
    dungeon.rooms.at(-1)!.entities.push(
      ...Array.from({ length: 4 }, (_, i) => ({
        type: 'npc' as const,
        x: 5 + i * 4,
        y: 5,
        props: { rescue: true, dialog: 'Help!' },
      })),
    );
    expect(lintAdventure(spec).map((e) => e.code)).toContain('ADV_RESCUE_FLOOR');
  });
  it('requires a final puzzle and rejects combat pressure in puzzle rooms', () => {
    const spec = adventureStyleExample(base, 'puzzleQuest');
    delete spec.levels[0]!.rooms.at(-1)!.puzzle;
    spec.levels[0]!.rooms[1]!.entities.push({ type: 'walker', x: 25, y: 12 });
    expect(lintAdventure(spec).map((e) => e.code)).toEqual(
      expect.arrayContaining(['ADV_PUZZLE_FLOOR', 'ADV_PUZZLE_PRESSURE']),
    );
  });
  it('describes the actual equipment, reset, rescue and map controls', () => {
    const puzzle = adventureStyleExample(base, 'puzzleQuest');
    expect(adventure.controlHelpFor!(puzzle)).toContainEqual({
      button: 'X',
      label: 'Reset current puzzle',
    });
    expect(adventure.controlHelpFor!(adventureStyleExample(base, 'rescueRaid'))).toContainEqual({
      button: 'A',
      label: 'Rescue / extract / talk',
    });
  });
});
