// Warm palette moods. Every entry passes paletteProblems() (unit-tested).
import type { PaletteMood } from './palette';

export const WARM: PaletteMood[] = [
  {
    id: 'molten-core',
    name: 'Molten Core',
    hint: 'volcanic magma reds and oranges over charred black rock, a lava-glow hero and cool obsidian foes',
    colors: [
      '#000000', '#140806', '#1a0e0a', '#3a2018', '#5e3626', '#ff7a1e', '#ffb038', '#ffe08a',
      '#6e5a8c', '#9a86b4', '#3d3352', '#e0201c', '#ff4d12', '#ffd21e', '#ffcf9a', '#fff3e6',
    ],
  },
  {
    id: 'desert-mirage',
    name: 'Desert Mirage',
    hint: 'sun-bleached sand and ochre dunes under haze, cooled by a single teal oasis hero',
    colors: [
      '#000000', '#1a120a', '#2c1e12', '#7a5a30', '#c9a468', '#23a89a', '#57d1c0', '#bff2e8',
      '#a83e5c', '#d67088', '#5e2436', '#e8391f', '#f0a83c', '#ffd84a', '#f2d9a0', '#fdf6e3',
    ],
  },
  {
    id: 'autumn-harvest',
    name: 'Autumn Harvest',
    hint: 'russet, amber and pumpkin forest in golden-hour light, mossy-green foragers among the leaves',
    colors: [
      '#000000', '#170f08', '#241408', '#593313', '#9a6b2f', '#e35a1c', '#ff8a3d', '#ffb968',
      '#6a7d34', '#9bb056', '#3a4418', '#d21f24', '#f0912a', '#ffcf3a', '#f5d99e', '#fbf3df',
    ],
  },
  {
    id: 'sunset-coast',
    name: 'Sunset Coast',
    hint: 'hot pink-and-orange sunset sky burning over a deep teal sea, violet urchin foes below',
    colors: [
      '#000000', '#0a1418', '#0a2630', '#12586a', '#2e93a6', '#ff4d8d', '#ff7a4d', '#ffd0a8',
      '#7a4fc0', '#a884e0', '#34215e', '#e63950', '#ffb03a', '#ffe14a', '#ffcfa6', '#fff2ea',
    ],
  },
  {
    id: 'rust-wastes',
    name: 'Rust Wastes',
    hint: 'oxidized iron, brown and bone across a dusty post-apocalyptic waste, cold gunmetal raiders',
    colors: [
      '#000000', '#140f0a', '#241c14', '#4d3f30', '#8a7860', '#c85a2a', '#e8894a', '#f0c9a0',
      '#4f7a94', '#7ba0b4', '#263c4a', '#cf3324', '#d98a2e', '#e8c24a', '#d8c2a4', '#f2ece0',
    ],
  },
];
