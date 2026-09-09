import { describe, expect, it } from 'vitest';
import { InputBroker, isTextEntryTarget } from '../src/input';

describe('isTextEntryTarget', () => {
  it.each(['input', 'SELECT', 'textarea'])('recognizes %s controls', (tagName) => {
    expect(isTextEntryTarget({ tagName } as unknown as EventTarget)).toBe(true);
  });

  it('recognizes contenteditable descendants', () => {
    expect(
      isTextEntryTarget({ tagName: 'span', isContentEditable: true } as unknown as EventTarget),
    ).toBe(true);
  });

  it('leaves ordinary page elements under game input control', () => {
    expect(
      isTextEntryTarget({ tagName: 'div', isContentEditable: false } as unknown as EventTarget),
    ).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
  });
});

describe('physical escape hold across transitions', () => {
  it.each(['Enter', 'KeyP'])(
    'retains a held %s through swallow without leaking menu input',
    (code) => {
      const target = new EventTarget();
      const input = new InputBroker({ keyboardMap: { [code]: 'START' } });
      input.attach(target as unknown as Window);
      target.dispatchEvent(Object.assign(new Event('keydown'), { code }));
      expect(input.poll().START.pressed).toBe(true);
      expect(input.physicallyHeld('START')).toBe(true);
      input.swallow();
      for (let frame = 0; frame < 130; frame++) {
        expect(input.poll().START.held).toBe(false);
        expect(input.physicallyHeld('START')).toBe(true);
      }
      target.dispatchEvent(Object.assign(new Event('keyup'), { code }));
      input.poll();
      expect(input.physicallyHeld('START')).toBe(false);
      target.dispatchEvent(Object.assign(new Event('keydown'), { code }));
      expect(input.poll().START.pressed).toBe(true);
      input.detach(target as unknown as Window);
    },
  );
});
