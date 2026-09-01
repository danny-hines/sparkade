import { describe, expect, it, vi } from 'vitest';
import { newOskState, oskHandle } from '../src/components';

describe('on-screen keyboard escape and editing', () => {
  it('lets X cancel immediately even after text has been entered', () => {
    const cancel = vi.fn();
    const state = newOskState({ value: 'mistyped password' });

    oskHandle(state, 'X', vi.fn(), cancel);

    expect(cancel).toHaveBeenCalledOnce();
  });

  it('offers a d-pad-accessible Cancel action', () => {
    const cancel = vi.fn();
    const state = { ...newOskState({ value: 'abc' }), row: 4, col: 3 };

    oskHandle(state, 'A', vi.fn(), cancel);

    expect(cancel).toHaveBeenCalledOnce();
  });

  it('keeps B as backspace and cancels once the field is empty', () => {
    const cancel = vi.fn();
    const edited = oskHandle(newOskState({ value: 'ab' }), 'B', vi.fn(), cancel);
    expect(edited.value).toBe('a');
    expect(cancel).not.toHaveBeenCalled();

    oskHandle(newOskState(), 'B', vi.fn(), cancel);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('supports a 64-character raw WPA key without overflowing further', () => {
    const full = newOskState({ value: 'a'.repeat(64) });
    expect(oskHandle(full, 'A', vi.fn(), vi.fn()).value).toHaveLength(64);

    const space = { ...full, row: 4, col: 1 };
    expect(oskHandle(space, 'A', vi.fn(), vi.fn()).value).toHaveLength(64);
  });
});
