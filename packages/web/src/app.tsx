// Shell state machine (no router). Global concerns live here: settings load,
// idle → attract, server version poll (hard reload after `sparkade update`),
// the 5s hold-to-remap trigger, and first-boot mapping.
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { ATTRACT_IDLE_MS, REMAP_HOLD_MS } from '@sparkade/shared';
import { api, type SettingsPayload } from './api';
import { shellInput } from './shell-input';
import { AttractScreen } from './screens/attract';
import { HomeScreen } from './screens/home';
import { WizardScreen } from './screens/wizard';
import { GenerationScreen } from './screens/generation';
import { PlayScreen } from './screens/play';
import { SettingsScreen } from './screens/settings';
import { RemapScreen } from './screens/remap';
import { AssetsGalleryScreen } from './screens/assets-gallery';
import { LikenessLabScreen } from './screens/likeness-lab';
import { SpriteEditorScreen } from './screens/sprite-editor';
import { FighterEditorScreen } from './screens/fighter-editor';
import { PlaytestScreen } from './screens/playtest';

export type Screen =
  | { name: 'attract' }
  | { name: 'home'; id?: string }
  | { name: 'wizard' }
  | { name: 'generation'; jobId: string; gameId: string }
  | { name: 'play'; id: string }
  | { name: 'settings'; tab?: string }
  | { name: 'remap'; firstBoot: boolean; returnTo: Screen };

/** Screens where idle-to-attract and hold-to-remap apply (shell menus only). */
const MENU_SCREENS = new Set(['home', 'wizard', 'settings']);

export function App(): ComponentChildren {
  // Dev-only asset gallery (http://localhost:5173/?dev=assets) — a normal
  // mouse-and-scroll page outside the kiosk state machine; the DEV gate makes
  // Vite strip it from production builds entirely.
  if (import.meta.env.DEV) {
    const dev = new URLSearchParams(location.search).get('dev');
    if (dev === 'assets') return <AssetsGalleryScreen />;
    if (dev === 'likeness') return <LikenessLabScreen />;
    if (dev === 'sprite-editor') return <SpriteEditorScreen />;
    if (dev === 'fighter-editor') return <FighterEditorScreen />;
    if (dev === 'playtest') return <PlaytestScreen />;
  }
  return <KioskApp />;
}

function KioskApp(): ComponentChildren {
  const [screen, setScreenRaw] = useState<Screen>({ name: 'attract' });
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [holdMs, setHoldMs] = useState<number | null>(null);
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const lastInput = useRef(Date.now());
  const firstBootChecked = useRef(false);

  const go = useCallback((next: Screen) => {
    shellInput.swallow();
    setScreenRaw(next);
  }, []);

  // Settings load + input maps + first-boot remap check.
  useEffect(() => {
    void api
      .settings()
      .then((s) => {
        setSettings(s);
        shellInput.setMaps(s.input.keyboard, s.input.gamepad);
        shellInput.setVolumes(s.audio);
        if (!firstBootChecked.current) {
          firstBootChecked.current = true;
          const needsMapping =
            Object.keys(s.input.gamepad).length === 0 && shellInput.broker.hasGamepad();
          if (needsMapping) {
            go({ name: 'remap', firstBoot: true, returnTo: { name: 'attract' } });
          }
        }
      })
      .catch(() => {
        /* server briefly unavailable at boot; defaults keep the shell usable */
      });
  }, [go]);

  // A gamepad plugged in later with no saved profile also triggers first-boot mapping.
  useEffect(() => {
    const onConnect = () => {
      const s = settings;
      if (
        s &&
        Object.keys(s.input.gamepad).length === 0 &&
        screenRef.current.name !== 'remap' &&
        screenRef.current.name !== 'play'
      ) {
        go({ name: 'remap', firstBoot: true, returnTo: screenRef.current });
      }
    };
    window.addEventListener('gamepadconnected', onConnect);
    return () => window.removeEventListener('gamepadconnected', onConnect);
  }, [settings, go]);

  // Idle → attract (menus only; never during generation or gameplay).
  useEffect(() => {
    shellInput.onAnyInput = () => {
      lastInput.current = Date.now();
    };
    const t = setInterval(() => {
      if (
        Date.now() - lastInput.current > ATTRACT_IDLE_MS &&
        MENU_SCREENS.has(screenRef.current.name)
      ) {
        setScreenRaw({ name: 'attract' });
      }
    }, 10_000);
    return () => clearInterval(t);
  }, []);

  // Instance poll: hard reload when the server restarts underneath us (e.g.
  // after `sparkade update`). Keyed on the per-boot instanceId, since the
  // version string is static across builds and never triggered a reload.
  useEffect(() => {
    let baseline: string | null = null;
    const t = setInterval(() => {
      void api
        .systemInfo()
        .then((info) => {
          if (baseline === null) baseline = info.instanceId;
          else if (info.instanceId !== baseline && screenRef.current.name !== 'play') {
            location.reload();
          }
        })
        .catch(() => {});
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  // 5s single-input hold in shell menus → remap wizard.
  useEffect(() => {
    shellInput.onRemapHoldProgress = (ms) => {
      setHoldMs(ms !== null && MENU_SCREENS.has(screenRef.current.name) ? ms : null);
    };
    shellInput.onRemapHoldFire = () => {
      if (MENU_SCREENS.has(screenRef.current.name)) {
        setHoldMs(null);
        go({ name: 'remap', firstBoot: false, returnTo: screenRef.current });
      }
    };
  }, [go]);

  // Gameplay + the wizard own raw input; suspend the hold trigger there.
  useEffect(() => {
    shellInput.setRemapHoldEnabled(MENU_SCREENS.has(screen.name) || screen.name === 'attract');
  }, [screen.name]);

  const reloadSettings = useCallback(() => {
    void api.settings().then((s) => {
      setSettings(s);
      shellInput.setMaps(s.input.keyboard, s.input.gamepad);
      shellInput.setVolumes(s.audio);
    });
  }, []);

  let body: ComponentChildren;
  switch (screen.name) {
    case 'attract':
      body = <AttractScreen go={go} />;
      break;
    case 'home':
      body = <HomeScreen go={go} initialId={screen.id} />;
      break;
    case 'wizard':
      body = <WizardScreen go={go} settings={settings} />;
      break;
    case 'generation':
      body = <GenerationScreen go={go} jobId={screen.jobId} gameId={screen.gameId} />;
      break;
    case 'play':
      body = <PlayScreen go={go} id={screen.id} settings={settings} onSettingsChanged={reloadSettings} />;
      break;
    case 'settings':
      body = (
        <SettingsScreen go={go} tab={screen.tab} settings={settings} onSettingsChanged={reloadSettings} />
      );
      break;
    case 'remap':
      body = (
        <RemapScreen
          go={go}
          firstBoot={screen.firstBoot}
          returnTo={screen.returnTo}
          onSaved={reloadSettings}
        />
      );
      break;
  }

  return (
    <>
      {body}
      {holdMs !== null && (
        <div class="hold-hint">
          <div>Keep holding to remap controls</div>
          <div class="bar">
            <div
              style={{
                width: `${Math.min(100, ((holdMs - 2000) / (REMAP_HOLD_MS - 2000)) * 100)}%`,
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
