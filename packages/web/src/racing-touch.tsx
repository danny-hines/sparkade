import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { GameHost, InputBroker } from '@sparkade/engine';
import type { LogicalButton, RacingTraversal } from '@sparkade/shared';

/** Pointer capture keeps held controls independent across multiple fingers. */
export function RacingTouch(props: {
  input: InputBroker;
  host: GameHost;
  traversal?: RacingTraversal;
}): ComponentChildren {
  const [visible, setVisible] = useState(false);
  const [menu, setMenu] = useState(props.host.menuInputActive);
  const pointers = useRef(new Map<string, LogicalButton>());
  const releasePointer = (event: PointerEvent) => {
    const source = `touch-${event.pointerType}-${event.pointerId}`;
    const key = pointers.current.get(source);
    if (key) props.input.setVirtualButton(source, key, false);
    pointers.current.delete(source);
  };
  useEffect(() => {
    if (!visible) return;
    let previous = props.host.menuInputActive;
    setMenu(previous);
    let frame: number;
    const update = () => {
      const next = props.host.menuInputActive;
      if (next !== previous) {
        previous = next;
        setMenu(next);
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [props.host, visible]);
  useEffect(() => {
    const media = matchMedia('(pointer: coarse)');
    const update = () =>
      setVisible(
        media.matches ||
          navigator.maxTouchPoints > 0 ||
          (import.meta.env.DEV && new URLSearchParams(location.search).get('touch') === '1'),
      );
    update();
    media.addEventListener('change', update);
    const release = () => {
      pointers.current.clear();
      props.input.releaseVirtualInputs();
    };
    // A window release also covers browsers that refuse pointer capture.
    window.addEventListener('pointerup', releasePointer);
    window.addEventListener('pointercancel', releasePointer);
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', release);
    return () => {
      release();
      media.removeEventListener('change', update);
      window.removeEventListener('blur', release);
      window.removeEventListener('pointerup', releasePointer);
      window.removeEventListener('pointercancel', releasePointer);
      document.removeEventListener('visibilitychange', release);
    };
  }, [props.input]);
  if (!visible) return null;
  const t = props.traversal;
  const accel =
    t?.propulsion === 'human'
      ? t.rider === 'onFoot'
        ? 'Run'
        : t.rider === 'standing'
          ? 'Push'
          : 'Pedal'
      : 'Accelerate';
  const carve = t?.handling === 'carve' || t?.handling === 'flow' ? 'Carve' : 'Drift';
  const button = (key: LogicalButton, label: string) => (
    <button
      type="button"
      class={`racing-touch-key racing-touch-${key}`}
      data-control={key}
      aria-label={label}
      onClick={(event) => {
        // Assistive activation has no pointer sequence; latch one logical tap.
        if (event.detail === 0) {
          props.input.setVirtualButton(`activate-${key}`, key, true);
          props.input.setVirtualButton(`activate-${key}`, key, false);
        }
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        const source = `touch-${event.pointerType}-${event.pointerId}`;
        pointers.current.set(source, key);
        props.input.setVirtualButton(source, key, true);
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // The window pointerup/cancel listeners still release this source.
        }
      }}
      onPointerUp={releasePointer}
      onPointerCancel={releasePointer}
      onLostPointerCapture={releasePointer}
    >
      {label}
    </button>
  );
  return (
    <div class="racing-touch" aria-label="Touch racing controls">
      <div class="racing-touch-steering">
        {button('LEFT', 'Left')}
        {button('RIGHT', 'Right')}
        {menu ? (
          <>
            {button('UP', 'Up')}
            {button('DOWN', 'Down')}
          </>
        ) : (
          button('L', carve)
        )}
      </div>
      <div class="racing-touch-actions">
        {button('START', 'Pause')}
        {button('A', menu ? 'Select / Next' : 'Boost / Next')}
        {!menu && button('Y', 'Brake')}
        {button('B', menu ? 'Back / Resume' : accel)}
      </div>
    </div>
  );
}
