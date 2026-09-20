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
