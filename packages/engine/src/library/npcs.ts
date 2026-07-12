// Friendly NPC sprites for adventure games — hand-authored, top-down 3/4 framing
// like npc_keeper (objects.ts). 16x16, 2 frames each: idle + subtle sway/gesture.
// Palette slots: 1 outline · 5 primary cloth · 6 secondary cloth · 7 skin/wood ·
// c warm glow · d gold · e light/silver · f near-white.
import type { LibraryEntry } from '../types';

export const NPCS: Record<string, LibraryEntry> = {
  // Hunched old sage: bare head (hood down as 6 collar), long silver beard,
  // wooden cane at the right. Sway: whole body dips 1px, hand slides down cane.
  npc_elder: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '................',
          '.....1111.......',
          '....177771......',
          '...17.77.71.11..',
          '...17777771.71..',
          '..156fff651.71..',
          '..15efffe51.71..',
          '..155efe551.71..',
          '..1555e5555771..',
          '..1556e6551.71..',
          '..155555551.71..',
          '..156666651.71..',
          '..155555551.71..',
          '...11111111.71..',
          '............1...',
          '................',
        ],
      },
      {
        w: 16,
        h: 16,
        rows: [
          '................',
          '................',
          '.....1111.......',
          '....177771..11..',
          '...17.77.71.71..',
          '...17777771.71..',
          '..156fff651.71..',
          '..15efffe51.71..',
          '..155efe551.71..',
          '..1555e5555771..',
          '..1556e6551.71..',
          '..155555551.71..',
          '..156666651.71..',
          '..155555551.71..',
          '...11111111.1...',
          '................',
        ],
      },
    ],
    anims: { idle: [0], sway: [0, 1] },
  },

  // Stout trader buried under a huge bulging backpack that towers over the
  // head (6 canvas, 5 straps). Sway: right arm swings out offering a gold coin.
  npc_merchant: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '...111111111....',
          '..1eeeeeeeee1...',
          '..16666666661...',
          '..16566665661d..',
          '..16566665661d..',
          '..11111111111...',
          '...17777771.....',
          '...17.77.71.....',
          '...17777771.....',
          '..1565555651....',
          '..1756666571....',
          '..1556666551....',
          '..1556666551....',
          '..1555555551....',
          '...11111111.....',
          '................',
        ],
      },
      {
        w: 16,
        h: 16,
        rows: [
          '...111111111....',
          '..1eeeeeeeee1...',
          '..16666666661...',
          '..16566665661d..',
          '..16566665661d..',
          '..11111111111...',
          '...17777771.....',
          '...17.77.71.....',
          '...17777771.....',
          '..1565555651....',
          '..175666655111..',
          '..1556666551dd1.',
          '..155666655111..',
          '..1555555551....',
          '...11111111.....',
          '................',
        ],
      },
    ],
    anims: { idle: [0], sway: [0, 1] },
  },

  // Hovering spirit: no legs, body tapers into a curling wisp tail, hollow
  // dark eyes, little gold lantern (c glow) held out front. Sway drifts 1px up.
  npc_ghost: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '................',
          '................',
          '.....1111.......',
          '....1efff1......',
          '...1efffff1.....',
          '...1e1ff1f1.....',
          '...1e1ff1f1.....',
          '...1efffff1.....',
          '...1efffff1..1..',
          '..1efffffffc1d1.',
          '..1effffe1..1c1.',
          '...1effe1...111.',
          '.....1efe1......',
          '......1ee1......',
          '.......11.......',
          '................',
        ],
      },
      {
        w: 16,
        h: 16,
        rows: [
          '................',
          '.....1111.......',
          '....1efff1......',
          '...1efffff1.....',
          '...1e1ff1f1.....',
          '...1e1ff1f1.....',
          '...1efffff1.....',
          '...1efffff1..1..',
          '..1efffffffc1d1.',
          '..1effffe1..1c1.',
          '...1effe1...111.',
          '.....1efe1......',
          '......1ee1......',
          '.......11.......',
          '................',
          '................',
        ],
      },
    ],
    anims: { idle: [0], sway: [0, 1] },
  },

  // Round little robot vendor: steel dome head, antenna with gold tip, wide
  // tray of parts (d/c/e wares) held in front, stubby treads. Sway: antenna
  // wobbles, dome glint and tray parts glimmer.
  npc_tinker: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '................',
          '................',
          '.......d........',
          '.......1........',
          '.....11111......',
          '....1feeee1.....',
          '...1ee1ee1ee1...',
          '...1eeeeeeee1...',
          '...1555555551...',
          '...1565555651...',
          '.1dd1cc1ee1dd1..',
          '.1666666666661..',
          '.1111111111111..',
          '..1e1e1e1e1e1...',
          '...111111111....',
          '................',
        ],
      },
      {
        w: 16,
        h: 16,
        rows: [
          '................',
          '................',
          '........d.......',
          '.......1........',
          '.....11111......',
          '....1eeeef1.....',
          '...1ee1ee1ee1...',
          '...1eeeeeeee1...',
          '...1555555551...',
          '...1565555651...',
          '.1dd1cc1ff1dd1..',
          '.1666666666661..',
          '.1111111111111..',
          '..1e1e1e1e1e1...',
          '...111111111....',
          '................',
        ],
      },
    ],
    anims: { idle: [0], sway: [0, 1] },
  },
};
