// Regal & Gothic palette moods. Every entry passes paletteProblems() (unit-tested).
import type { PaletteMood } from './palette';

export const REGAL: PaletteMood[] = [
  {
    id: 'royal-sanctum',
    name: 'Royal Sanctum',
    hint: 'deep royal purple-and-violet cathedral lit by gold, with a cold azure hero — reverent, majestic',
    colors: [
      '#000000', '#0a0713', '#1a1035', '#33206b', '#5a3fa0', '#4aa5e8', '#8fd0f5', '#f0c088',
      '#6fae3f', '#a0d060', '#38571f', '#e0392f', '#ff8a3c', '#ffd23e', '#c9c0e8', '#f6f2ff',
    ],
  },
  {
    id: 'blood-moon',
    name: 'Blood Moon',
    hint: 'crimson and black gothic night under a red moon, a cold steel-blue hero cutting the gloom — ominous',
    colors: [
      '#000000', '#0c0506', '#1a0a0c', '#3a1418', '#612028', '#6f8fc0', '#a8c4e0', '#e8b892',
      '#c23a52', '#e8687a', '#57141f', '#ff6a2a', '#ff9d4a', '#f5c542', '#d9a0a0', '#fff0ee',
    ],
  },
  {
    id: 'obsidian-gold',
    name: 'Obsidian Gold',
    hint: 'black volcanic obsidian veined with molten gold, jade hero and amethyst foes — dark, opulent',
    colors: [
      '#000000', '#050505', '#0e0e12', '#24242c', '#3e3e48', '#2fc0a8', '#78e0cc', '#e8c090',
      '#8a4bd0', '#b07de8', '#3a1f5a', '#e23a24', '#ff8a1e', '#ffc21c', '#cfcad0', '#f8f6f0',
    ],
  },
  {
    id: 'crimson-noir',
    name: 'Crimson Noir',
    hint: 'stark charcoal and bone-white near-monochrome sliced by one blood-red accent — film-noir menace',
    colors: [
      '#000000', '#060606', '#141416', '#2c2c30', '#4a4a50', '#b8bcc4', '#e0e2e6', '#d0a888',
      '#5a6470', '#8a94a0', '#2a3038', '#e01f2a', '#a01822', '#c89838', '#b0b0b4', '#f4f2ee',
    ],
  },
];
