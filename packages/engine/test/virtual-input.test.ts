import { expect, it } from 'vitest';
import { InputBroker } from '../src/input';
it('merges fingers, latches quick taps and releases each source independently', () => {
  const input = new InputBroker();
  input.setVirtualButton('finger1', 'B', true);
  input.setVirtualButton('finger2', 'LEFT', true);
  expect(input.poll().B.held).toBe(true);
  expect(input.state().LEFT.held).toBe(true);
  input.setVirtualButton('finger1', 'B', false);
  expect(input.poll().B.released).toBe(true);
  expect(input.state().LEFT.held).toBe(true);
  input.setVirtualButton('finger3', 'A', true);
  input.setVirtualButton('finger3', 'A', false);
  expect(input.poll().A.pressed).toBe(true);
  expect(input.poll().A.released).toBe(true);
  input.releaseVirtualInputs();
  expect(input.poll().LEFT.released).toBe(true);
});
it('swallows held touch input through transitions until released', () => {
  const input = new InputBroker();
  input.setVirtualButton('p', 'A', true);
  input.poll();
  input.swallow();
  expect(input.poll().A.held).toBe(false);
  input.setVirtualButton('p', 'A', false);
  input.poll();
  input.setVirtualButton('p', 'A', true);
  expect(input.poll().A.pressed).toBe(true);
});
