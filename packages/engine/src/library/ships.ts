// Hand-authored ship sprites (SNES-style, palette-indexed) — expansion wave.
// Palette slots: 1 outline · 5 hero-primary · 6 hero-secondary · 7 hero-accent
// · d gold · e light · f near-white · c warm engine glow.
// Ships point UP; frame 1 is the whole sprite banked 1px right.
// headSlots mark the bubble-canopy area where a baked 12x12 likeness is pasted.
import type { LibraryEntry } from '../types';

export const SHIPS: Record<string, LibraryEntry> = {
  // Round flying saucer: centered glass dome, rim running-lights, tri-point underside thrusters.
  ship_saucer: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '................',
          '................',
          '......1111......',
          '.....1eeee1.....',
          '....1effffe1....',
          '....1effffe1....',
          '....1eeeeee1....',
          '..165555555561..',
          '.16555555555561.',
          '165e555e555e561.',
          '.15555555555551.',
          '..155555555551..',
          '...1f1.1f1.1f1..',
          '...cfc.cfc.cfc..',
          '....c...c...c...',
          '................',
        ],
      },
      {
        w: 16,
        h: 16,
        rows: [
          '................',
          '................',
          '.......1111.....',
          '......1eeee1....',
          '.....1effffe1...',
          '.....1effffe1...',
          '.....1eeeeee1...',
          '...165555555561.',
          '..16555555555561',
          '.165e555e555e561',
          '..15555555555551',
          '...155555555551.',
          '....1f1.1f1.1f1.',
          '....cfc.cfc.cfc.',
          '.....c...c...c..',
          '................',
        ],
      },
    ],
    anims: { idle: [0], bank: [1] },
    headSlots: [
      { x: 2, y: 3, size: 12 },
      { x: 2, y: 3, size: 12 },
    ],
  },

  // Wide swept manta-ray wing: slot intakes on the leading edge, splayed twin tail fins aft.
  ship_manta: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '................',
          '................',
          '.......11.......',
          '......1651......',
          '.....165561.....',
          '...165eeee561...',
          '..1655effe5561..',
          '.16555effe55561.',
          '.15115eeee51151.',
          '.15555555555551.',
          '.11..155551..11.',
          '.....155551.....',
          '....151ff151....',
          '....151cc151....',
          '....111..111....',
          '................',
        ],
      },
      {
        w: 16,
        h: 16,
        rows: [
          '................',
          '................',
          '........11......',
          '.......1651.....',
          '......165561....',
          '....165eeee561..',
          '...1655effe5561.',
          '..16555effe55561',
          '..15115eeee51151',
          '..15555555555551',
          '..11..155551..11',
          '......155551....',
          '.....151ff151...',
          '.....151cc151...',
          '.....111..111...',
          '................',
        ],
      },
    ],
    anims: { idle: [0], bank: [1] },
    headSlots: [
      { x: 2, y: 3, size: 12 },
      { x: 2, y: 3, size: 12 },
    ],
  },

  // Hammerhead gunship: two broad forward prongs flanking the canopy, boxy hull, twin engines.
  ship_hammer: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '.1111......1111.',
          '.1651......1561.',
          '.1651......1561.',
          '.16511eeee11561.',
          '.1651effffe1561.',
          '.1651effffe1561.',
          '.16511eeee11561.',
          '.16555555555561.',
          '..151555555151..',
          '..15155dd55151..',
          '..15155dd55151..',
          '..155511115551..',
          '...1551..1551...',
          '...1ff1..1ff1...',
          '....cc....cc....',
          '................',
        ],
      },
      {
        w: 16,
        h: 16,
        rows: [
          '..1111......1111',
          '..1651......1561',
          '..1651......1561',
          '..16511eeee11561',
          '..1651effffe1561',
          '..1651effffe1561',
          '..16511eeee11561',
          '..16555555555561',
          '...151555555151.',
          '...15155dd55151.',
          '...15155dd55151.',
          '...155511115551.',
          '....1551..1551..',
          '....1ff1..1ff1..',
          '.....cc....cc...',
          '................',
        ],
      },
    ],
    anims: { idle: [0], bank: [1] },
    headSlots: [
      { x: 2, y: 3, size: 12 },
      { x: 2, y: 3, size: 12 },
    ],
  },
};
