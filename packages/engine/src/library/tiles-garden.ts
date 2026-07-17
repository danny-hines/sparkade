// Garden theme: overgrown, leafy shape language. Palette-slot semantics:
// 0='.' transparent · 1 outline/darkest · 2 bg-dark · 3 bg-mid · 4 bg-light
// b hazard · c accent-warm · d gold · e light · f near-white.
// Structural tiles use 2/3/4 (+1 for crevice/root lines); no outer outline on
// full-square tiles. All tiles designed to repeat seamlessly side-by-side.
import type { LibraryEntry } from '../types';

export const TILES_GARDEN: Record<string, LibraryEntry> = {
  // Mossy earth block: lit moss cap dripping over packed soil threaded with
  // wiggling roots (2) and a few buried pebbles. Edge columns stay plain 3.
  garden_solid: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '4444444444444444',
          '4443444444434444',
          '3334333333343333',
          '3333333333333333',
          '3332333333323333',
          '3332333333323333',
          '3323333333233333',
          '3323333233233333',
          '3332333333323333',
          '3333233333332333',
          '3333233223332333',
          '3332333333323333',
          '3332333333323333',
          '3323333333233333',
          '3323332333233333',
          '3332333333323333',
        ],
      },
    ],
    anims: { idle: [0] },
  },

  // Buried packed earth: continues the cap's root-threaded soil without
  // repeating its moss surface or switching to the separate leafy hedge wall.
  // Quiet boundary rows let stacked tiles read as one connected earth mass.
  garden_solid_inner: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '3333333333333333',
          '3332333333323333',
          '3332333333323333',
          '3323333333233333',
          '3323333233233333',
          '3332333333323333',
          '3333233333332333',
          '3333233223332333',
          '3332333333323333',
          '3332333333323333',
          '3323333333233333',
          '3323332333233333',
          '3332333333323333',
          '3333333333333333',
          '3333233332333333',
          '3333333333333333',
        ],
      },
    ],
    anims: { idle: [0] },
  },

  // One-way branch ledge: leafy lit top over a barked bough, small leaf
  // clusters hanging beneath; a warm bud dots the branch line.
  garden_platform: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '4444444444444444',
          '3343333c33334333',
          '3233323332333233',
          '1111111111111111',
          '..1331...1331...',
          '...11.....11....',
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

  // Thorn bramble: tangled dark vine knot bristling with red thorn spikes;
  // a pale glint hops across the tips between frames.
  garden_hazard: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '................',
          '................',
          '................',
          '...b............',
          '..1b1.....b.....',
          '..1b1....1b1..b.',
          '..1b1.b..1b1.1b1',
          '.1bbb1b11bbb11b1',
          '1221122112211221',
          '2112b1122b122112',
          '1221122112211221',
          '211221b221122b12',
          '1221122112211221',
          '1111111111111111',
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
          '................',
          '...e............',
          '..1e1.....b.....',
          '..1e1....1b1..e.',
          '..1b1.b..1b1.1b1',
          '.1bbb1b11bbb11b1',
          '1221122112211221',
          '2112b1122b122112',
          '1221122112211221',
          '211221b221122b12',
          '1221122112211221',
          '1111111111111111',
          '2222222222222222',
          '1111111111111111',
        ],
      },
    ],
    anims: { idle: [0], glint: [0, 1] },
  },

  // Checkpoint: young sapling planted in a soil mound, a gold ribbon tied
  // around its trunk; the ribbon tail flutters between frames.
  garden_checkpoint: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '.......11.......',
          '.....144441.....',
          '....14444341....',
          '....14443341....',
          '.....144341.....',
          '......1441......',
          '......1331......',
          '.....1dddd1.....',
          '......1dd1dd....',
          '......1331..d...',
          '......1331......',
          '......1331......',
          '......1331......',
          '.....132231.....',
          '....13322331....',
          '....11111111....',
        ],
      },
      {
        w: 16,
        h: 16,
        rows: [
          '.......11.......',
          '.....144441.....',
          '....14434441....',
          '....14444331....',
          '.....143441.....',
          '......1441......',
          '......1331......',
          '.....1dddd1.d...',
          '......1dd1.dd...',
          '......1331......',
          '......1331......',
          '......1331......',
          '......1331......',
          '.....132231.....',
          '....13322331....',
          '....11111111....',
        ],
      },
    ],
    anims: { idle: [0], glow: [0, 1] },
  },

  // Exit: vine-wrapped trellis archway around a glowing gap in the hedge;
  // two hanging vine strands sway across the light between frames.
  garden_exit: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '....11111111....',
          '..113434434311..',
          '.13441111114431.',
          '.13411111111431.',
          '.134e3eeee3e431.',
          '.134e3eeee3e431.',
          '.134e3feee3e431.',
          '.134e3eeee3e431.',
          '.134e3eeeeee431.',
          '.134e3eeefee431.',
          '.134eeeeeeee431.',
          '.134eeefeeee431.',
          '.134eeeeeeee431.',
          '.134efeeeeee431.',
          '.134eeeeeeee431.',
          '.13444444444431.',
        ],
      },
      {
        w: 16,
        h: 16,
        rows: [
          '....11111111....',
          '..113434434311..',
          '.13441111114431.',
          '.13411111111431.',
          '.134ee3ee3ee431.',
          '.134ee3ee3ee431.',
          '.134ee3fe3ee431.',
          '.134ee3ee3ee431.',
          '.134ee3eeeee431.',
          '.134eeeefeee431.',
          '.134efeeeeee431.',
          '.134eeeeefee431.',
          '.134eeeeeeee431.',
          '.134eeeeeefe431.',
          '.134eefeeeee431.',
          '.13444444444431.',
        ],
      },
    ],
    anims: { idle: [0], swirl: [0, 1] },
  },

  // Deco: flower cluster — a tall warm bloom flanked by a white daisy and a
  // gold bud, stems and leaves rising from a little grass mound.
  garden_deco: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '................',
          '................',
          '.....1cc1.......',
          '....1cddc1......',
          '....1cddc1......',
          '.....1cc1.......',
          '.1f1...3........',
          '1fcf1..3...1d1..',
          '.1f1...3..1dcd1.',
          '..3....3...1d1..',
          '..3....3....3...',
          '.43...43....34..',
          '..3....3....3...',
          '..3....3....3...',
          '..343434343434..',
          '..111111111111..',
        ],
      },
    ],
    anims: { idle: [0] },
  },

  // Hedge wall: two staggered courses of clipped leaf lumps — lit crowns,
  // speckled leaf bodies, dark shadow seams underneath. Wraps both axes.
  garden_wall: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '3344443333444433',
          '3444444334444443',
          '3443344334433443',
          '3433344334333443',
          '3343343333433433',
          '2333333223333332',
          '2233223322332233',
          '1222222112222221',
          '4433334444333344',
          '4443344444433444',
          '3443344334433443',
          '3443343334433433',
          '3433334334333343',
          '3332233333322333',
          '2233223322332233',
          '2221122222211222',
        ],
      },
    ],
    anims: { idle: [0] },
  },

  // Meadow floor: flat dark earth with sparse grass dashes and two fallen
  // warm petals — quiet enough to read as walkable ground.
  garden_floor: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '2222222222222222',
          '2223322222222222',
          '2222222222232222',
          '2222222222233222',
          '22c2222222222222',
          '2222222222222222',
          '2222222332222222',
          '2222222222222222',
          '2222222222222c22',
          '2232222222222222',
          '2232222222222222',
          '2222222222332222',
          '2222222222222222',
          '2222223222222222',
          '2222223222222222',
          '2222222222222222',
        ],
      },
    ],
    anims: { idle: [0] },
  },

  // Pushable wicker cube: basket-weave of alternating strand patches —
  // lit horizontal slats crossing under rounded vertical withies.
  garden_block: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '1111111111111111',
          '1444444444444421',
          '1433433233334321',
          '1433433233334321',
          '1422433222224321',
          '1432444443324421',
          '1432333343323321',
          '1432333343323321',
          '1422222243322221',
          '1444433244444321',
          '1433433233334321',
          '1433433233334321',
          '1422433222224321',
          '1432444443324421',
          '1222222222222221',
          '1111111111111111',
        ],
      },
    ],
    anims: { idle: [0] },
  },

  // Pit: dark burrow mouth under the turf — ragged soil rim with root
  // tendrils (2) dangling into the blackness.
  garden_pit: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '3333333333333333',
          '3344333333443333',
          '2112211221122112',
          '1121111211112111',
          '1121111111112111',
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

  // Switch: flat mushroom button — frame 0 a domed spotted cap on a stubby
  // stalk, frame 1 squashed flush into the earth.
  garden_switch: {
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
          '2222111111112222',
          '2221cfcccfc12222',
          '221ccfccccfcc122',
          '221cccccccccc122',
          '2211111111111122',
          '2222213333122222',
          '2222133333312222',
          '2222111111112222',
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
          '2211111111111122',
          '221ccfccccfcc122',
          '2211111111111122',
          '2222222222222222',
          '2222222222222222',
          '2222222222222222',
          '2222222222222222',
          '2222222222222222',
        ],
      },
    ],
    anims: { idle: [0], pressed: [1] },
  },

  // Locked door: woven-vine gate — vertical withies with two horizontal
  // binder rows, sealed by a gold lock plate with a dark keyhole.
  garden_door_locked: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '2222222222222222',
          '2211111111111122',
          '2214324324324122',
          '2214324324324122',
          '2214444434444122',
          '2214324324324122',
          '2214324324324122',
          '221432dddd324122',
          '221432d11d324122',
          '221432d11d324122',
          '221432dddd324122',
          '2214344444434122',
          '2214324324324122',
          '2214324324324122',
          '2211111111111122',
          '2222222222222222',
        ],
      },
    ],
    anims: { idle: [0] },
  },

  // Boss door: vine gate crested by a huge carnivorous blossom — layered
  // petals around a dark fanged maw, thorn studs in the corners.
  garden_door_boss: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '2222222222222222',
          '2211111111111122',
          '221a22222222a122',
          '2212a222222a2122',
          '2212288888822122',
          '2212888888882122',
          '2218889999888122',
          '2218891ff1988122',
          '2218891111988122',
          '2218889999888122',
          '2212888888882122',
          '2212288888822122',
          '221a22222222a122',
          '2212a222222a2122',
          '2211111111111122',
          '2222222222222222',
        ],
      },
    ],
    anims: { idle: [0] },
  },

  // Open doorway: parted vine curtain — leafy hedge arch around a dark
  // passage, drawn-back strands hugging both sides of the opening.
  garden_door_open: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '4444444444444444',
          '3333333333333333',
          '3344222222224433',
          '3342222222222433',
          '3342111111112433',
          '3341331111331433',
          '3341331111331433',
          '3341311111131433',
          '3341311111131433',
          '3341111111111433',
          '3341111111111433',
          '2241111111111422',
          '3341111111111433',
          '3341111111111433',
          '3342111111112433',
          '3342222222222433',
        ],
      },
    ],
    anims: { idle: [0] },
  },
};
