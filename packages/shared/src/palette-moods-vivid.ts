// Vivid palette moods. Every entry passes paletteProblems() (unit-tested).
import type { PaletteMood } from './palette';

export const VIVID: PaletteMood[] = [
  {
    id: 'neon-arcade',
    name: 'Neon Arcade',
    hint: 'pure black night blazing with electric cyan hero and hot-magenta foes — coin-op glow',
    colors: [
      '#000000', '#050510', '#0a0a1a', '#151538', '#242452', '#18e0ff', '#7af0ff', '#d4fbff',
      '#ff2fd0', '#ff7ae4', '#8a1f6a', '#ff3b30', '#ff9d2f', '#ffd21f', '#b8e8ff', '#f2fbff',
    ],
  },
  {
    id: 'bubblegum-pop',
    name: 'Bubblegum Pop',
    hint: 'candy pink hero over dark berry, with mint foes and lemon treasure — sweet and bright',
    colors: [
      '#000000', '#140610', '#28101e', '#4e1c3a', '#7c3560', '#ff79c0', '#ffb0d8', '#ffe0f0',
      '#46e0a0', '#8af0c8', '#1f7a58', '#ff4d3d', '#ff9a3d', '#ffe93f', '#ffd6ec', '#fff2fa',
    ],
  },
  {
    id: 'synthwave-grid',
    name: 'Synthwave Grid',
    hint: 'magenta hero to cyan foe over a dark purple grid, lit by a sunset-orange horizon — retro',
    colors: [
      '#000000', '#0d0518', '#1a0a2e', '#2e134f', '#4a2078', '#ff3caa', '#ff86cf', '#ffd0ec',
      '#26d6ff', '#86ecff', '#175f8a', '#ff5a2f', '#ff9a3c', '#ffcf3a', '#c9a8ff', '#f6ecff',
    ],
  },
  {
    id: 'circuit-dream',
    name: 'Circuit Dream',
    hint: 'dark teal board threaded with glowing green traces, cyan foes and warm gold pads — hi-tech',
    colors: [
      '#000000', '#04120f', '#06201c', '#0c352e', '#145048', '#3cff8a', '#9dffc4', '#e0ffe8',
      '#2fd0ff', '#9de8ff', '#16607f', '#ff4536', '#ff8f2a', '#ffcb2e', '#bfe8d8', '#eefff4',
    ],
  },
];
