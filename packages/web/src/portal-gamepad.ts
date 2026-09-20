import type { InputBroker, ExternalGamepadState } from '@sparkade/engine';

/** One-way, bounded controller state from the Android USB fallback. */
export function installPortalGamepad(input: InputBroker, target: EventTarget = window): () => void {
  let connected = false;
  const release = () => {
    input.setExternalGamepad('portal-usb', null);
    connected = false;
  };
  const receive = (event: Event) => {
    const state: unknown = (event as CustomEvent).detail;
    if (!validState(state)) {
      release();
      return;
    }
    input.setExternalGamepad('portal-usb', state);
    if (!connected) {
      connected = true;
      target.dispatchEvent(new Event('sparkade:gamepadconnected'));
    }
  };
  target.addEventListener('sparkade:usb-gamepad', receive);
  target.addEventListener('blur', release);
  target.addEventListener('pagehide', release);
  return () => {
    release();
    target.removeEventListener('sparkade:usb-gamepad', receive);
    target.removeEventListener('blur', release);
    target.removeEventListener('pagehide', release);
  };
}

function validState(value: unknown): value is ExternalGamepadState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<ExternalGamepadState>;
  return (
    Array.isArray(state.buttons) &&
    state.buttons.length === 10 &&
    state.buttons.every((button) => typeof button === 'boolean') &&
    Array.isArray(state.axes) &&
    state.axes.length === 2 &&
    state.axes.every(
      (axis) => typeof axis === 'number' && Number.isFinite(axis) && Math.abs(axis) <= 1,
    )
  );
}
