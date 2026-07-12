// Candy theme: confectionery shape language. Palette-slot semantics:
// 0='.' transparent · 1 outline/darkest · 2 bg-dark · 3 bg-mid · 4 bg-light
// b hazard · c accent-warm · d gold · e light · f near-white.
// Structural tiles use 2/3/4 (+1, e for icing seams); no outer outline on
// full-square tiles. All tiles designed to repeat seamlessly side-by-side.
import type { LibraryEntry } from '../types';

export const TILES_CANDY: Record<string, LibraryEntry> = {
  // Nougat/wafer ground: light icing cap over layered strata with nut flecks.
  candy_solid: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '4444444444444444',
          '4444444444444444',
          '2222222222222222',
          '3333f33333333f33',
          '33333333f3333333',
          '3333333333333333',
          '2222222222222222',
          '4444444444444444',
          '4444444444444444',
          '2222222222222222',
          '333f33333333f333',
          '3333333f33333333',
          '3333333333333333',
          '2222222222222222',
          '3333333333333333',
          '2222222222222222',
        ],
      },
    ],
    anims: { idle: [0] },
  },

  // One-way biscuit ledge: sugar-flecked shortbread slab, icing drips below.
  candy_platform: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '4444444444444444',
          '333f333333f33333',
          '3333333333333333',
          '1111111111111111',
          '.1ee1....1ee1...',
          '..11......11....',
          '................',
          '................',
          '................',
          '................',
          '................',
          '................',
          '................',
          '................',
          '................',
          '................',
        ],
      },
    ],
    anims: { idle: [0] },
  },

  // Hazard: jagged rock-candy shards, stepped angular facets; glint alternates.
  candy_hazard: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '................',
          '................',
          '...11...........',
          '..1eb1..........',
          '..1eb1..........',
          '.1eebb1....11...',
          '.1ebbb1...1bb1..',
          '.1bbbb1...1bb1..',
          '1ebbbbb1..1bb1..',
          '1bbbbbb1.1bbbb1.',
          '1bbbbbb1.1bbbb1.',
          '1bbbbbb1.1bbbb1.',
          '1bbbbbb1.1bbbb1.',
          '1bbbbbb1.1bbbb1.',
          '2222222222222222',
          '1111111111111111',
        ],
      },
      {
        w: 16,
        h: 16,
        rows: [
          '................',
          '................',
          '...11...........',
          '..1bb1..........',
          '..1bb1..........',
          '.1bbbb1....11...',
          '.1bbbb1...1eb1..',
          '.1bbbb1...1eb1..',
          '1bbbbbb1..1bb1..',
          '1bbbbbb1.1ebbb1.',
          '1bbbbbb1.1ebbb1.',
          '1bbbbbb1.1bbbb1.',
          '1bbbbbb1.1bbbb1.',
          '1bbbbbb1.1bbbb1.',
          '2222222222222222',
          '1111111111111111',
        ],
      },
    ],
    anims: { idle: [0], glint: [0, 1] },
  },

  // Checkpoint: candy-cane pole with striped bands, planted in an icing mound;
  // gold sparkles twinkle up the pole on the glow frame.
  candy_checkpoint: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '....111111111...',
          '....1fffffff1...',
          '....1bb1..1b1...',
          '....1bb1..1b1...',
          '....1ff1..1f1...',
          '....1ff1..111...',
          '....1bb1........',
          '....1bb1........',
          '....1ff1........',
          '....1ff1........',
          '....1bb1........',
          '....1bb1........',
          '....1ff1........',
          '....1ff1........',
          '...1eeeeeeee1...',
          '...1111111111...',
        ],
      },
      {
        w: 16,
        h: 16,
        rows: [
          '....111111111...',
          '....1fffffff1...',
          '....1bb1..1b1...',
          '...d1bb1..1b1...',
          '....1ff1..1f1...',
          '....1ff1..111...',
          '....1bb1........',
          '....1bb1........',
          '...d1ff1d.......',
          '...d1ff1d.......',
          '....1bb1........',
          '....1bb1........',
          '....1ff1d.......',
          '....1ff1........',
          '...1eeeeeeee1...',
          '...1111111111...',
        ],
      },
    ],
    anims: { idle: [0], glow: [0, 1] },
  },

  // Exit: wrapped-sweet archway — ribbon bow at the keystone, side twists,
  // diagonal wrapper stripes marching through the portal between frames.
  candy_exit: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '....11111111....',
          '..113dd44dd311..',
          '.123311dd113321.',
          '.123effeeffe321.',
          '.123ffeeffee321.',
          '.123feeffeef321.',
          '.123eeffeeff321.',
          '.123effeeffe321.',
          '.12dffeeffeed21.',
          '.123feeffeef321.',
          '.123eeffeeff321.',
          '.123effeeffe321.',
          '.123ffeeffee321.',
          '.123feeffeef321.',
          '.123eeffeeff321.',
          '.12333333333321.',
        ],
      },
      {
        w: 16,
        h: 16,
        rows: [
          '....11111111....',
          '..113dd44dd311..',
          '.123311dd113321.',
          '.123feeffeef321.',
          '.123eeffeeff321.',
          '.123effeeffe321.',
          '.123ffeeffee321.',
          '.123feeffeef321.',
          '.12deeffeeffd21.',
          '.123effeeffe321.',
          '.123ffeeffee321.',
          '.123feeffeef321.',
          '.123eeffeeff321.',
          '.123effeeffe321.',
          '.123ffeeffee321.',
          '.12333333333321.',
        ],
      },
    ],
    anims: { idle: [0], swirl: [0, 1] },
  },

  // Deco: peppermint lollipop — concentric candy rings on a stick.
  candy_deco: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '......1111......',
          '....11bbbb11....',
          '...1bbffffbb1...',
          '...1bfbbbbfb1...',
          '..1bfbfbbfbfb1..',
          '..1bfbfbbfbfb1..',
          '...1bfbbbbfb1...',
          '...1bbffffbb1...',
          '....11bbbb11....',
          '......1111......',
          '......1ee1......',
          '......1ee1......',
          '......1ee1......',
          '......1ee1......',
          '......1ee1......',
          '......1111......',
        ],
      },
    ],
    anims: { idle: [0] },
  },

  // Frosting-brick wall: pillowy rounded bricks set in bright icing mortar.
  candy_wall: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          'e44444eee44444ee',
          '3333333e3333333e',
          'e22222eee22222ee',
          'eeeeeeeeeeeeeeee',
          '44eee44444eee444',
          '333e3333333e3333',
          '22eee22222eee222',
          'eeeeeeeeeeeeeeee',
          'e44444eee44444ee',
          '3333333e3333333e',
          'e22222eee22222ee',
          'eeeeeeeeeeeeeeee',
          '44eee44444eee444',
          '333e3333333e3333',
          '22eee22222eee222',
          'eeeeeeeeeeeeeeee',
        ],
      },
    ],
    anims: { idle: [0] },
  },

  // Floor: dark fudge slab studded with scattered two-pixel sprinkles.
  candy_floor: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '2222222222222222',
          '22cc222222222222',
          '2222222222e22222',
          '2222222222e22222',
          '22222dd222222222',
          '2222222222223322',
          '2222222222222222',
          '2c22222222222222',
          '2c22222222222222',
          '2222222ee2222222',
          '2222222222222d22',
          '2222222222222d22',
          '2223322222222222',
          '222222222cc22222',
          '22222e2222222222',
          '22222e2222222222',
        ],
      },
    ],
    anims: { idle: [0] },
  },

  // Pushable bonbon gift box: candy box wrapped in a gold ribbon cross.
  candy_block: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '4444444dd4444444',
          '4333333dd3333332',
          '43f3333dd3333332',
          '4333333dd3333332',
          '4333333dd3333332',
          '4333333dd3333332',
          '4333333dd3333332',
          'dddddddccddddddd',
          'dddddddccddddddd',
          '4333333dd3333332',
          '4333333dd3333332',
          '4333333dd333f332',
          '4333333dd3333332',
          '4333333dd3333332',
          '4333333dd3333332',
          '2222222dd2222222',
        ],
      },
    ],
    anims: { idle: [0] },
  },

  // Pit: glossy dark syrup pool; strands drip from the lip into the black.
  candy_pit: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '2222222222222222',
          '2233222222332222',
          '2222222222222222',
          '1221112111221121',
          '1221111111211111',
          '1121111111111111',
          '1111111111111111',
          '1111111111111111',
          '1111111111111111',
          '1111111111111111',
          '1111111111111111',
          '1111111111111111',
          '1111111111111111',
          '1111111111111111',
          '1111111111111111',
          '1111111111111111',
        ],
      },
    ],
    anims: { idle: [0] },
  },

  // Gumdrop button: sugared dome, frame 0 raised with a shine, frame 1 squashed.
  candy_switch: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '2222222222222222',
          '2222222222222222',
          '2222222222222222',
          '2222222222222222',
          '2222222222222222',
          '2222221111222222',
          '222221ffcc122222',
          '22221ffcccc12222',
          '2221cccccccc1222',
          '2221cccccccc1222',
          '2221cccccccc1222',
          '2211111111111122',
          '2222222222222222',
          '2222222222222222',
          '2222222222222222',
          '2222222222222222',
        ],
      },
      {
        w: 16,
        h: 16,
        rows: [
          '2222222222222222',
          '2222222222222222',
          '2222222222222222',
          '2222222222222222',
          '2222222222222222',
          '2222222222222222',
          '2222222222222222',
          '2222222222222222',
          '2222211111122222',
          '22221cccccc12222',
          '2221cccccccc1222',
          '2211111111111122',
          '2222222222222222',
          '2222222222222222',
          '2222222222222222',
          '2222222222222222',
        ],
      },
    ],
    anims: { idle: [0], pressed: [1] },
  },

  // Locked door: chocolate-bar slab of raised segments, gold lock plate.
  candy_door_locked: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '2222222222222222',
          '2211111111111122',
          '2214444244442122',
          '2214333243332122',
          '2214333243332122',
          '2212222222222122',
          '2214444244442122',
          '221433dddd332122',
          '221433d11d332122',
          '221222d11d222122',
          '221444dddd442122',
          '2214333243332122',
          '2214333243332122',
          '2212222222222122',
          '2211111111111122',
          '2222222222222222',
        ],
      },
    ],
    anims: { idle: [0] },
  },

  // Boss door: dark chocolate slab piped with an icing crown crest that drips.
  candy_door_boss: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '2222222222222222',
          '2211111111111122',
          '2212222222222122',
          '221a22222222a122',
          '2212822882282122',
          '2212822882282122',
          '2212888888882122',
          '2212881881882122',
          '2212999999992122',
          '2212292222922122',
          '2212292222922122',
          '2212222222222122',
          '221a22222222a122',
          '2212222222222122',
          '2211111111111122',
          '2222222222222222',
        ],
      },
    ],
    anims: { idle: [0] },
  },

  // Open doorway: dark walkable gap between candy-cane posts; melted chocolate
  // sags from the lintel where the slab used to sit.
  candy_door_open: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '4444444444444444',
          '3333333333333333',
          '3311111111111133',
          '33bb12111221bb33',
          '33bb12111221bb33',
          '33ff11111121ff33',
          '33ff11111111ff33',
          '33bb11111111bb33',
          '33bb11111111bb33',
          '33ff11111111ff33',
          '33ff11111111ff33',
          '33bb11111111bb33',
          '33bb11111111bb33',
          '33ff11111111ff33',
          '33ff11111111ff33',
          '33bb22222222bb33',
        ],
      },
    ],
    anims: { idle: [0] },
  },
};
