// Classic palette moods — the three shipped golden palettes, proven in real
// games. One family file among several (see palette-moods.ts aggregator); every
// entry must pass paletteProblems() (enforced by a unit test).
import type { PaletteMood } from './palette';

export const CLASSIC: PaletteMood[] = [
  {
    id: 'ember-dusk',
    name: 'Ember Dusk',
    hint: 'warm ember-and-fire hero against a cool blue night — heroic, volcanic',
    colors: [
      '#000000', '#14101f', '#1b2140', '#2c3a66', '#46648f', '#c2491d', '#ef7d24', '#ffb54a',
      '#2f6f5f', '#55a284', '#a87c3e', '#e04a3a', '#ff8f5a', '#ffd23e', '#ffe8ad', '#fff8ea',
    ],
  },
  {
    id: 'void-bloom',
    name: 'Void Bloom',
    hint: 'deep cosmic purple with a spring-green hero and hot-pink foes — dreamlike space',
    colors: [
      '#000000', '#120b1d', '#1d1033', '#2f1d52', '#493473', '#3cb96b', '#8fe6a3', '#f491c6',
      '#7a4a21', '#a86f32', '#d69a45', '#ff4f6d', '#ff9d5c', '#ffd35e', '#b9e8ff', '#f2fff5',
    ],
  },
  {
    id: 'gloaming-amber',
    name: 'Gloaming Amber',
    hint: 'gothic slate-blue dusk lit by warm amber and olive — solemn, storybook',
    colors: [
      '#000000', '#0d0b14', '#1a2030', '#2e3a52', '#4a5d7a', '#e8a33d', '#a86428', '#ffd98a',
      '#5d7a4a', '#8aa06a', '#d8d0b8', '#9d4edd', '#d97b4a', '#f5c542', '#c9d4e8', '#f4f1e8',
    ],
  },
];
