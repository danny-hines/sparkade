import { expect, it } from 'vitest';
import { InputBroker } from '@sparkade/engine';
import { installPortalGamepad } from '../src/portal-gamepad';

it('announces native controller attachment and releases input on blur, malformed reports, and cleanup', () => {
  const target = new EventTarget();
  const input = new InputBroker();
  const cleanup = installPortalGamepad(input, target);
  let connections = 0;
  target.addEventListener('sparkade:gamepadconnected', () => {
    connections++;
  });
  const send = (detail: unknown) =>
    target.dispatchEvent(new CustomEvent('sparkade:usb-gamepad', { detail }));
  const state = {
    buttons: [true, false, false, false, false, false, false, false, false, false],
    axes: [0, 0],
  };
  send(state);
  send(state);
  expect(connections).toBe(1);
  expect(input.poll().B.held).toBe(true);
  target.dispatchEvent(new Event('blur'));
  expect(input.poll().B.released).toBe(true);
  send(state);
  expect(connections).toBe(2);
  expect(input.poll().B.pressed).toBe(true);
  send({ ...state, axes: [NaN, 0] });
  expect(input.poll().B.released).toBe(true);
  send({ ...state, buttons: ['true'] });
  expect(input.hasGamepad()).toBe(false);
  send(state);
  cleanup();
  send(state);
  expect(input.hasGamepad()).toBe(false);
});

it('accepts all twelve encoder buttons and rejects unrecognized report sizes', () => {
  const target = new EventTarget();
  const input = new InputBroker();
  const cleanup = installPortalGamepad(input, target);
  const send = (detail: unknown) =>
    target.dispatchEvent(new CustomEvent('sparkade:usb-gamepad', { detail }));
  send({ buttons: Array.from({ length: 12 }, (_, i) => i === 11), axes: [-1, 0] });
  expect(input.hasGamepad()).toBe(true);
  expect(input.activeRaw()).toEqual(['b11', 'a0-']);
  send({ buttons: Array(12).fill(false), axes: [0, 0] });
  expect(input.activeRaw()).toEqual([]);
  for (const count of [0, 9, 11, 13, 100]) {
    send({ buttons: Array(count).fill(true), axes: [0, 0] });
    expect(input.hasGamepad()).toBe(false);
  }
  cleanup();
});
