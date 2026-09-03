import { describe, expect, it } from 'vitest';
import { Hud } from '../src/hud';
import type { Renderer } from '../src/renderer';
import type { HudState } from '../src/types';

describe('Hud', () => {
  it('renders platformer abilities as compact icon-only slots', () => {
    const text: string[] = [];
    const scaledDraws: unknown[][] = [];
    const ctx = {
      globalAlpha: 1,
      save() {},
      restore() {},
    };
    const renderer = {
      ctx,
      theme: {
        accent: '#accent',
        dim: '#dim',
        heading: '#heading',
        panelBg: '#panel',
        text: '#text',
      },
      rect() {},
      draw() {},
      drawScaled: (...args: unknown[]) => scaledDraws.push(args),
      text: (value: string) => text.push(value),
    } as unknown as Renderer;
    const hud = Object.assign(Object.create(Hud.prototype), {
      icons: { heart: {}, heartEmpty: {}, life: {}, collectible: {} },
    }) as Hud;
    const state: HudState = {
      score: 0,
      lives: 3,
      health: 3,
      maxHealth: 3,
      keys: 0,
      bombs: 0,
      collectibles: 0,
      abilities: [
        { kind: 'doubleJump', name: 'Second Snooze', active: true },
        { kind: 'projectile', name: 'Eyeball Toss', active: false },
      ],
    };
    const doubleJump = {} as CanvasImageSource;
    const projectile = {} as CanvasImageSource;

    hud.render(renderer, state, {
      showCollectibles: true,
      showAbilities: true,
      abilityIcons: { doubleJump, projectile },
    });

    expect(scaledDraws).toEqual([
      [doubleJump, 116, 5, 10, 10],
      [projectile, 130, 5, 10, 10],
    ]);
    expect(text).not.toContain('SECOND SN');
    expect(text).not.toContain('EYEBALL T');
  });
});
