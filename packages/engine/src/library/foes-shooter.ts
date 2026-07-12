// Hand-authored shooter-foe sprites (SNES-style, palette-indexed).
// Top-down shooter foes: nose pointing DOWN toward the player.
// Palette slots: 1 outline, 8 enemy-primary, 9 enemy-secondary, a enemy-accent,
// b hazard red, c warm glow, e light (rotor blades / ring metal), f glint.
import type { LibraryEntry } from '../types';

export const FOES_SHOOTER: Record<string, LibraryEntry> = {
  // Quad-rotor drone: diamond core with X-arms out to four dark rotor discs;
  // the light (e) blade streak flips diagonal between frames so the rotors
  // read as spinning. Single center eye in hazard red (b) with glint.
  foe_drone: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '.111........111.',
          '1eaa1......1aae1',
          '1aea1......1aea1',
          '1aae1......1eaa1',
          '.1111..11..1111.',
          '.....119911.....',
          '.....199881.....',
          '....199fb881....',
          '....198bb8a1....',
          '.....188aa1.....',
          '.....118a11.....',
          '.1111..11..1111.',
          '1aae1......1eaa1',
          '1aea1......1aea1',
          '1eaa1......1aae1',
          '.111........111.',
        ],
      },
      {
        w: 16,
        h: 16,
        rows: [
          '.111........111.',
          '1aae1......1eaa1',
          '1aea1......1aea1',
          '1eaa1......1aae1',
          '.1111..11..1111.',
          '.....119911.....',
          '.....199881.....',
          '....199fb881....',
          '....198bb8a1....',
          '.....188aa1.....',
          '.....118a11.....',
          '.1111..11..1111.',
          '1eaa1......1aae1',
          '1aea1......1aea1',
          '1aae1......1eaa1',
          '.111........111.',
        ],
      },
    ],
    anims: { idle: [0], fly: [0, 1] },
  },
  // Swept manta-style attack craft, nose down: full-span crescent wing with
  // lit wingtips (c), cockpit glass (e), narrow tail on top. Frame 1 bobs the
  // whole craft down a pixel and flares the tail exhaust.
  foe_ray: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '................',
          '.......99.......',
          '.......11.......',
          '......1981......',
          '.11...1981...11.',
          '1cc1..1981..1cc1',
          '1c98119988118ac1',
          '.198888ee888aa1.',
          '..19888ee88aa1..',
          '...19888888a1...',
          '....19888aa1....',
          '.....1888a1.....',
          '......18a1......',
          '.......11.......',
          '................',
          '................',
        ],
      },
      {
        w: 16,
        h: 16,
        rows: [
          '................',
          '.......99.......',
          '......9cc9......',
          '.......11.......',
          '......1981......',
          '.11...1981...11.',
          '1cc1..1981..1cc1',
          '1c98119988118ac1',
          '.198888ee888aa1.',
          '..19888ee88aa1..',
          '...19888888a1...',
          '....19888aa1....',
          '.....1888a1.....',
          '......18a1......',
          '.......11.......',
          '................',
        ],
      },
    ],
    anims: { idle: [0], fly: [0, 1] },
  },
  // Ringed orb mine: big spherical core wrapped by a metal orbital ring (e)
  // whose tilt flips between the frames; blinking warning beacon (b) on top.
  foe_orbiter: {
    frames: [
      {
        w: 16,
        h: 16,
        rows: [
          '................',
          '.......11.......',
          '......1bb1......',
          '......1111......',
          '....11998811....',
          '...1999988881...',
          '...1999888881...',
          '..1998888888a111',
          '..198888888111e1',
          '11198888111eeee1',
          '1e111111eee11111',
          '1eeeeeee111a1...',
          '11111111aaaa1...',
          '....11aaaa11....',
          '......1111......',
          '................',
        ],
      },
      {
        w: 16,
        h: 16,
        rows: [
          '................',
          '.......11.......',
          '......1ff1......',
          '......1111......',
          '....11998811....',
          '...1999988881...',
          '...1999888881...',
          '111998888888a1..',
          '1e1118888888a1..',
          '1eeee111888aa111',
          '11111eee111111e1',
          '...18111eeeeeee1',
          '...188aa11111111',
          '....11aaaa11....',
          '......1111......',
          '................',
        ],
      },
    ],
    anims: { idle: [0], fly: [0, 1] },
  },
};
