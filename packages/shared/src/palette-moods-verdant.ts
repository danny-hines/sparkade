// Verdant palette moods. Every entry passes paletteProblems() (unit-tested).
import type { PaletteMood } from './palette';

export const VERDANT: PaletteMood[] = [
  {
    id: 'verdant-canopy',
    name: 'Verdant Canopy',
    hint: 'lush layered jungle greens pierced by a warm sunbeam hero; violet foes lurk in the shade',
    colors: [
      '#000000', '#0a1410', '#10241a', '#1d4a30', '#3a7d4f', '#ffb43c', '#e07a2a', '#ffd98a',
      '#6a55c9', '#9d86e0', '#3d2f6b', '#e83c2a', '#ff9a3c', '#ffe14a', '#bfe6c4', '#f2fbef',
    ],
  },
  {
    id: 'toxic-bog',
    name: 'Toxic Bog',
    hint: 'sickly acid-green swamp over bruise-purple muck; a lone aqua hero against caustic warning-red',
    colors: [
      '#000000', '#0d0a14', '#1a0f22', '#38402a', '#6b8a2e', '#2fe0d0', '#1fb0a8', '#b0f5ee',
      '#8a5fa8', '#b088c8', '#3d2a4d', '#f5401f', '#9be03a', '#ffd21e', '#d8e8a0', '#f0f6e6',
    ],
  },
  {
    id: 'emerald-ruins',
    name: 'Emerald Ruins',
    hint: 'mossy overgrown gray stone lit by emerald growth and treasure-gold; steel-blue guardians',
    colors: [
      '#000000', '#0c0e0d', '#171a1c', '#333a38', '#5a655e', '#2ee08a', '#1f9d63', '#a8f5cf',
      '#4a6db5', '#7a97d8', '#263256', '#d43a2a', '#ff9e3a', '#ffcf3e', '#c4ccc0', '#eef2ea',
    ],
  },
  {
    id: 'meadow-dawn',
    name: 'Meadow Dawn',
    hint: 'soft fresh grass in morning light with a wildflower-pink hero and buttery yellow bloom',
    colors: [
      '#000000', '#0f1410', '#14261c', '#3a6b3e', '#6fa85a', '#ff6fae', '#e04f8e', '#ffd0a8',
      '#6f8fe0', '#a8c0f0', '#2f3d6b', '#e8452e', '#ffb84a', '#ffe24a', '#d8ecc8', '#f6fbee',
    ],
  },
];
