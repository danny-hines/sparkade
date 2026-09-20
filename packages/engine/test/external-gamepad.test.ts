import { expect, it } from 'vitest';
import { InputBroker } from '../src/input';

const pad = (buttons: number[] = [], axes = [0, 0]) => ({
  buttons: Array.from({ length: 10 }, (_, i) => buttons.includes(i)),
  axes,
});

it('maps native USB buttons and axes through normal remapping and transition suppression', () => {
  const input = new InputBroker({ gamepadMap: { b9: 'START', 'a0-': 'LEFT' } });
  input.setExternalGamepad('usb', pad([9], [-1, 0]));
  expect(input.hasGamepad()).toBe(true);
  expect(input.activeRaw()).toEqual(['b9', 'a0-']);
  expect(input.poll().START.pressed).toBe(true);
  expect(input.state().LEFT.held).toBe(true);
  input.swallow();
  expect(input.poll().START.held).toBe(false);
  expect(input.activeRaw()).toEqual([]);
  input.setExternalGamepad('usb', pad());
  input.poll();
  input.setExternalGamepad('usb', pad([9]));
  expect(input.poll().START.pressed).toBe(true);
  expect(input.physicallyHeld('START')).toBe(true);
  input.setExternalGamepad('usb', null);
  expect(input.poll().START.released).toBe(true);
  expect(input.hasGamepad()).toBe(false);
});

it('retains quick taps between frames and clears a disconnected source without releasing another', () => {
  const input = new InputBroker();
  input.setExternalGamepad('usb', pad([9]));
  input.setExternalGamepad('usb', pad());
  expect(input.poll().START.pressed).toBe(true);
  expect(input.poll().START.released).toBe(true);
  input.setExternalGamepad('second', pad([0]));
  input.setExternalGamepad('usb', pad([9]));
  input.poll();
  input.setExternalGamepad('usb', null);
  expect(input.poll().B.held).toBe(true);
  expect(input.state().START.released).toBe(true);
});
