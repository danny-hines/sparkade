import { describe, expect, it } from 'vitest';
import { isTextEntryTarget } from '../src/input';

describe('isTextEntryTarget', () => {
  it.each(['input', 'SELECT', 'textarea'])('recognizes %s controls', (tagName) => {
    expect(isTextEntryTarget({ tagName } as unknown as EventTarget)).toBe(true);
  });

  it('recognizes contenteditable descendants', () => {
    expect(isTextEntryTarget({ tagName: 'span', isContentEditable: true } as unknown as EventTarget)).toBe(
      true,
    );
  });

  it('leaves ordinary page elements under game input control', () => {
    expect(isTextEntryTarget({ tagName: 'div', isContentEditable: false } as unknown as EventTarget)).toBe(
      false,
    );
    expect(isTextEntryTarget(null)).toBe(false);
  });
});
