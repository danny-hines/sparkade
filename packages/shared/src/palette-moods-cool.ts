// Cool palette moods. Every entry passes paletteProblems() (unit-tested).
import type { PaletteMood } from './palette';

export const COOL: PaletteMood[] = [
  {
    id: 'frostbyte',
    name: 'Frostbyte',
    hint: 'icy cyan and white over deep navy — crisp, cold, digital-glacial',
    colors: [
      '#000000', '#0a0f1c', '#0e1a33', '#1c3357', '#35577f', '#4fd8f0', '#9df0ff', '#cdeeff',
      '#6b6fd6', '#3d3f9e', '#23244f', '#ff5140', '#ffb066', '#ffd23e', '#bfe4f5', '#f2fbff',
    ],
  },
  {
    id: 'abyssal-deep',
    name: 'Abyssal Deep',
    hint: 'bioluminescent teal glow in a near-black ocean trench — violet predators lurking',
    colors: [
      '#000000', '#04080a', '#061014', '#0c2028', '#143842', '#35f0c8', '#9dffe6', '#d6fff2',
      '#9b6bff', '#5b3aa8', '#2a1a52', '#ff495a', '#ff9d4a', '#ffce3a', '#7fe6d8', '#eafff9',
    ],
  },
  {
    id: 'twilight-veil',
    name: 'Twilight Veil',
    hint: 'dusky blue-violet evening with soft lavender and a teal foe — quiet, dreaming',
    colors: [
      '#000000', '#0f0a18', '#191430', '#302754', '#4c4080', '#c2a3f0', '#e0c8ff', '#f5e6ff',
      '#4bb8c9', '#2d7f8f', '#184049', '#ff5c72', '#ff9e6b', '#ffd45e', '#cdb8ec', '#f6f0ff',
    ],
  },
  {
    id: 'stormfront',
    name: 'Stormfront',
    hint: 'steel-gray thunderstorm cut by electric cyan and lightning-yellow — charged, ominous',
    colors: [
      '#000000', '#0b0e12', '#141a22', '#29323e', '#47525f', '#38d0ff', '#96ecff', '#d4f6ff',
      '#a85fd6', '#5e3a8a', '#2e1f47', '#ff4838', '#ffb43a', '#ffe23a', '#c4d0dc', '#f2f6fa',
    ],
  },
  {
    id: 'glacier',
    name: 'Glacier',
    hint: 'pale blue-white glacial ice over slate shadows — high-key, still, wind-scoured',
    colors: [
      '#000000', '#0c1017', '#17222e', '#33475a', '#6d8299', '#a8e0f5', '#d6f2ff', '#eefaff',
      '#3f6fd6', '#2846a0', '#17244f', '#ff5a48', '#ffab5e', '#ffd84a', '#cfe4f0', '#f4fbff',
    ],
  },
];
