import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { LogicalButton } from '@sparkade/shared';
import { shellInput } from './shell-input';
import './kiosk-viewport.css';

/** Opt in so the existing Pi cabinet and development labs keep their layout. */
export function adaptiveKioskEnabled(): boolean {
  return new URLSearchParams(location.search).get('kiosk') === 'adaptive';
}

export function kioskTouchEnabled(): boolean {
  return adaptiveKioskEnabled() && new URLSearchParams(location.search).get('touch') !== '0';
}

export function KioskViewport(props: { children: ComponentChildren }): ComponentChildren {
  const display = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const adaptive = adaptiveKioskEnabled();
  const touch = kioskTouchEnabled();
  useEffect(() => {
    if (!adaptive || !display.current) return;
    document.documentElement.classList.add('adaptive-kiosk');
    const element = display.current;
    const fit = () => setScale(Math.min(element.clientWidth / 1024, element.clientHeight / 600));
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    fit();
    return () => {
      observer.disconnect();
      document.documentElement.classList.remove('adaptive-kiosk');
    };
  }, [adaptive]);
  if (!adaptive) return props.children;
  return (
    <div class={`kiosk-frame${touch ? '' : ' kiosk-gamepad'}`}>
      <div class="kiosk-display" ref={display}>
        <div class="kiosk-stage" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
          {props.children}
        </div>
      </div>
      {touch && <KioskControls />}
    </div>
  );
}

/** Shared logical input works for the library, wizard, pause menus, and every game. */
function KioskControls(): ComponentChildren {
  const pointers = useRef(new Map<number, LogicalButton>());
  const releasePointer = (event: PointerEvent) => {
    const key = pointers.current.get(event.pointerId);
    if (!key) return;
    shellInput.broker.setVirtualButton(`kiosk-${event.pointerId}`, key, false);
    pointers.current.delete(event.pointerId);
  };
  useEffect(() => {
    const release = () => {
      for (const [id, key] of pointers.current) {
        shellInput.broker.setVirtualButton(`kiosk-${id}`, key, false);
      }
      pointers.current.clear();
    };
    window.addEventListener('pointerup', releasePointer);
    window.addEventListener('pointercancel', releasePointer);
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', release);
    return () => {
      release();
      window.removeEventListener('pointerup', releasePointer);
      window.removeEventListener('pointercancel', releasePointer);
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', release);
    };
  }, []);
  const button = (key: LogicalButton, label: string = key) => (
    <button
      type="button"
      class={`kiosk-key kiosk-key-${key}`}
      data-control={key}
      aria-label={['UP', 'DOWN', 'LEFT', 'RIGHT'].includes(key) ? key.toLowerCase() : label}
      onPointerDown={(event) => {
        event.preventDefault();
        shellInput.pokeActivity();
        shellInput.audio.resume();
        pointers.current.set(event.pointerId, key);
        shellInput.broker.setVirtualButton(`kiosk-${event.pointerId}`, key, true);
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Window listeners cover WebViews without working pointer capture.
        }
      }}
      onPointerUp={releasePointer}
      onPointerCancel={releasePointer}
      onLostPointerCapture={releasePointer}
      onClick={(event) => {
        if (event.detail !== 0) return;
        shellInput.pokeActivity();
        shellInput.audio.resume();
        shellInput.broker.setVirtualButton(`kiosk-activate-${key}`, key, true);
        shellInput.broker.setVirtualButton(`kiosk-activate-${key}`, key, false);
      }}
    >
      {label}
    </button>
  );
  return (
    <div class="kiosk-controls" aria-label="Arcade touch controls">
      <div class="kiosk-dpad">
        {button('UP', '↑')}
        {button('LEFT', '←')}
        {button('DOWN', '↓')}
        {button('RIGHT', '→')}
      </div>
      <div class="kiosk-system-controls">
        {button('SELECT', 'Select')}
        {button('START', 'Start / Pause')}
      </div>
      <div class="kiosk-action-controls">
        {button('L')}
        {button('X')}
        {button('Y')}
        {button('R')}
        {button('B')}
        {button('A')}
      </div>
    </div>
  );
}
