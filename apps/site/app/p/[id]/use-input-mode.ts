'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_KEYBOARD_MAP } from '@sparkade/shared';

/** How the player is driving the game; decides which button names we show. */
export type InputMode = 'keyboard' | 'touch' | 'gamepad';

/**
 * Starts from a device guess (fine pointer + hover ⇒ desktop keyboard), then
 * follows what the player actually uses. The on-screen buttons dispatch
 * synthetic key events, so only trusted keydowns count as a real keyboard.
 */
export function useInputMode(): InputMode {
  const [mode, setMode] = useState<InputMode>('touch');

  useEffect(() => {
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) setMode('keyboard');

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isTrusted && event.code in DEFAULT_KEYBOARD_MAP) setMode('keyboard');
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || event.pointerType === 'pen') setMode('touch');
    };
    // Browsers only announce a gamepad after one of its buttons is pressed.
    const onGamepad = () => setMode('gamepad');

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('gamepadconnected', onGamepad);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('gamepadconnected', onGamepad);
    };
  }, []);

  return mode;
}
