// Settings: Controls (view + remap), Audio (volume sliders), WiFi (Pi only,
// with on-screen keyboard), System info (incl. lifetime API spend), Model info.
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import {
  LOGICAL_BUTTONS,
  type KioskRegistrationStatus,
  type SoftwareUpdateStatus,
  type SystemInfo,
  type WifiNetwork,
} from '@sparkade/shared';
import { api, type SettingsPayload } from '../api';
import { isStandalonePortal } from '../portal-runtime';
import {
  FooterLegend,
  newOskState,
  OnScreenKeyboard,
  oskHandle,
  usd,
  type OskState,
} from '../components';
import {
  enumerateInputs,
  getUserMediaForDevice,
  probeMedia,
  type DeviceInfo,
  type MediaProbe,
} from '../media';
import { shellInput } from '../shell-input';
import { Icon, Btn, SignalBars } from '../icons';
import type { Screen } from '../app';

type Tab = 'controls' | 'audio' | 'devices' | 'wifi' | 'registration' | 'system' | 'model';
type DeviceSel = { cameraId?: string; cameraLabel?: string; micId?: string; micLabel?: string };
type WifiNotice = { tone: 'info' | 'error'; message: string };

/** Human-readable dump of what Chromium sees, shown when no inputs enumerate. */
function describeProbe(p: MediaProbe): string {
  return [
    `secure context : ${p.secureContext ? 'yes' : 'NO'}`,
    `mediaDevices   : ${p.hasMediaDevices ? 'yes' : 'NO'}`,
    `devices seen   : ${p.deviceCount}`,
    ...p.devices.map((d) => `  • ${d}`),
    `getUserMedia video : ${p.videoResult}`,
    `getUserMedia audio : ${p.audioResult}`,
  ].join('\n');
}

export function SettingsScreen(props: {
  go: (s: Screen) => void;
  tab?: string;
  settings: SettingsPayload | null;
  onSettingsChanged: () => void;
}): ComponentChildren {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const tabs: { id: Tab; label: string }[] = [
    { id: 'controls', label: 'Controls' },
    { id: 'audio', label: 'Audio' },
    { id: 'devices', label: 'Camera & Mic' },
    ...(info?.isPi ? [{ id: 'wifi' as Tab, label: 'WiFi' }] : []),
    { id: 'registration', label: 'Cloud' },
    { id: 'system', label: 'System info' },
    { id: 'model', label: 'Model info' },
  ];
  const [tab, setTab] = useState<Tab>((props.tab as Tab) ?? 'controls');
  const [zone, setZone] = useState<'tabs' | 'panel'>('tabs');
  const [panelCursor, setPanelCursor] = useState(0);
  const [audio, setAudio] = useState(
    props.settings?.audio ?? { musicVol: 0.7, sfxVol: 0.8, uiVol: 0.4 },
  );
  const [networks, setNetworks] = useState<WifiNetwork[] | null>(null);
  const [wifiNotice, setWifiNotice] = useState<WifiNotice | null>(null);
  const [osk, setOsk] = useState<OskState | null>(null);
  const [connectingTo, setConnectingTo] = useState<string | null>(null);
  const [inputs, setInputs] = useState<{ cameras: DeviceInfo[]; mics: DeviceInfo[] } | null>(null);
  const [probe, setProbe] = useState<MediaProbe | null>(null);
  const [devSel, setDevSel] = useState<DeviceSel>(props.settings?.devices ?? {});
  const [upState, setUpState] = useState<
    'idle' | 'checking' | 'available' | 'uptodate' | 'installing' | 'error'
  >('idle');
  const [upLatest, setUpLatest] = useState<string | null>(null);
  const [upMsg, setUpMsg] = useState('');
  const [registration, setRegistration] = useState<KioskRegistrationStatus | null>(null);
  const oskTarget = useRef<string>('');
  const registrationStartInFlight = useRef(false);
  const wifiConnectSeq = useRef(0);
  const wifiListRef = useRef<HTMLDivElement>(null);
  const deviceListRef = useRef<HTMLDivElement>(null);
  const settingsTabsRef = useRef<HTMLDivElement>(null);
  const systemRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({
    tab,
    zone,
    panelCursor,
    tabs,
    osk,
    networks,
    connectingTo,
    inputs,
    info,
    upState,
    registration,
  });
  stateRef.current = {
    tab,
    zone,
    panelCursor,
    tabs,
    osk,
    networks,
    connectingTo,
    inputs,
    info,
    upState,
    registration,
  };

  const beginPairing = useCallback((force = false) => {
    if (registrationStartInFlight.current) return;
    registrationStartInFlight.current = true;
    setRegistration((current) => ({
      state: 'pairing',
      origin: current?.origin ?? 'https://sparkade.dev',
      message: 'Requesting a pairing code…',
    }));
    void api
      .startCloudPairing(force)
      .then(setRegistration)
      .catch((error: Error) => {
        setRegistration({
          state: 'error',
          origin: 'https://sparkade.dev',
          message: error.message,
        });
      })
      .finally(() => {
        registrationStartInFlight.current = false;
      });
  }, []);

  useEffect(() => {
    void api
      .systemInfo()
      .then(setInfo)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (tab !== 'registration' || registration !== null) return;
    let canceled = false;
    void api
      .cloudRegistration()
      .then((next) => {
        if (canceled) return;
        setRegistration(next);
        if (next.state === 'unregistered' || next.state === 'expired') beginPairing(false);
        else if (next.state === 'revoked') beginPairing(true);
      })
      .catch((error: Error) => {
        if (!canceled) {
          setRegistration({
            state: 'error',
            origin: 'https://sparkade.dev',
            message: error.message,
          });
        }
      });
    return () => {
      canceled = true;
    };
  }, [beginPairing, registration, tab]);

  useEffect(() => {
    if (tab !== 'registration' || registration?.state !== 'pairing') return;
    const poll = () => {
      void api
        .cloudRegistration()
        .then((next) => {
          if (next.state === 'expired') beginPairing(false);
          else setRegistration(next);
        })
        .catch(() => {
          // Keep the current pairing code during a brief network interruption.
        });
    };
    const interval = window.setInterval(poll, 3_000);
    return () => window.clearInterval(interval);
  }, [beginPairing, registration?.state, tab]);
  useEffect(() => {
    if (props.settings) setAudio(props.settings.audio);
    if (props.settings) setDevSel(props.settings.devices ?? {});
  }, [props.settings]);
  useEffect(() => {
    if (tab !== 'wifi' || networks !== null) return;
    let canceled = false;
    void api
      .wifiNetworks()
      .then((next) => {
        if (!canceled) setNetworks(next);
      })
      .catch((e: Error) => {
        if (canceled) return;
        // An empty list keeps the Rescan action reachable instead of leaving
        // the cabinet on a permanent loading spinner.
        setNetworks([]);
        setWifiNotice({ tone: 'error', message: `Scan failed: ${e.message}` });
      });
    return () => {
      canceled = true;
    };
  }, [tab, networks]);

  useEffect(() => {
    if (tab === 'devices' && inputs === null) {
      void enumerateInputs()
        .then((r) => {
          setInputs(r);
          // Nothing enumerated → probe the media stack so we can see WHY on-device.
          if (r.cameras.length === 0 && r.mics.length === 0)
            void probeMedia()
              .then(setProbe)
              .catch(() => {});
        })
        .catch(() => setInputs({ cameras: [], mics: [] }));
    }
  }, [tab, inputs]);

  useEffect(
    () => () => {
      // Ignore a late network response after leaving Settings.
      wifiConnectSeq.current += 1;
    },
    [],
  );

  // The Camera & Mic list can outgrow its column (no-device messages,
  // diagnostics and privacy disclosure); keep the focused row scrolled into view.
  useEffect(() => {
    if (tab !== 'devices' || zone !== 'panel') return;
    deviceListRef.current
      ?.querySelector('.focusable.focused')
      ?.scrollIntoView({ block: 'nearest' });
  }, [tab, zone, panelCursor, inputs]);

  useEffect(() => {
    if (tab !== 'wifi' || zone !== 'panel') return;
    wifiListRef.current?.querySelector('.focusable.focused')?.scrollIntoView({ block: 'nearest' });
  }, [tab, zone, panelCursor, networks]);

  useEffect(() => {
    if (tab !== 'wifi' || networks === null || panelCursor <= networks.length) return;
    setPanelCursor(networks.length);
  }, [tab, networks, panelCursor]);

  // The Pi has one more tab than desktop. Keep controller navigation usable at
  // the fixed 600px cabinet height by revealing the selected tab as it moves.
  useEffect(() => {
    if (zone !== 'tabs') return;
    settingsTabsRef.current
      ?.querySelector('.settings-tab.focused')
      ?.scrollIntoView({ block: 'nearest' });
  }, [tab, zone, info?.isPi]);

  // The System-info tab can overflow (long data dir + update section); keep the
  // update button in view once it's focused.
  useEffect(() => {
    if (tab !== 'system' || zone !== 'panel') return;
    systemRef.current?.querySelector('.menu-item')?.scrollIntoView({ block: 'nearest' });
  }, [tab, zone, upState]);

  const saveAudio = (next: typeof audio) => {
    setAudio(next);
    shellInput.setVolumes(next);
    void api.saveSettings({ audio: next }).then(props.onSettingsChanged);
  };

  const chooseDevice = (kind: 'camera' | 'mic', d: DeviceInfo) => {
    setDevSel((cur) => {
      const next: DeviceSel =
        kind === 'camera'
          ? { ...cur, cameraId: d.id, cameraLabel: d.label }
          : { ...cur, micId: d.id, micLabel: d.label };
      void api.saveSettings({ devices: next }).then(props.onSettingsChanged);
      return next;
    });
    shellInput.blip('select');
  };

  const runUpdateCheck = () => {
    setUpState('checking');
    setUpMsg('');
    void api
      .updateCheck()
      .then((r) => {
        if (r.error) {
          setUpState('error');
          setUpLatest(null);
          setUpMsg(`Couldn't check for updates: ${r.error}`);
        } else if (r.available) {
          setUpState('available');
          setUpLatest(r.latest);
          setUpMsg('');
        } else {
          setUpState('uptodate');
          setUpLatest(null);
          setUpMsg('');
        }
      })
      .catch((e: Error) => {
        setUpState('error');
        setUpMsg(e.message);
      });
  };
  const runUpdateInstall = () => {
    setUpState('installing');
    setUpMsg('');
    void api
      .updateInstall()
      .then(() =>
        setUpMsg(
          'Updating — the cabinet will restart and reload itself when done. This can take a few minutes; leave it be.',
        ),
      )
      .catch((e: Error) => {
        setUpState('error');
        setUpMsg(e.message);
      });
  };

  const applyUpdateStatus = useCallback((status: SoftwareUpdateStatus) => {
    if (status.state === 'running') {
      setUpState('installing');
    } else if (status.state === 'failed') {
      setUpState('error');
      setUpMsg(status.message);
    } else if (status.state === 'succeeded') {
      setUpState('uptodate');
      setUpMsg('Update finished. Waiting for the cabinet to reload…');
    }
  }, []);

  useEffect(() => {
    if (tab !== 'system' || !info?.isPi) return;
    void api
      .updateStatus()
      .then(applyUpdateStatus)
      .catch(() => {});
  }, [applyUpdateStatus, info?.isPi, tab]);

  useEffect(() => {
    if (upState !== 'installing') return;
    const interval = window.setInterval(() => {
      void api
        .updateStatus()
        .then(applyUpdateStatus)
        .catch(() => {});
    }, 2_000);
    return () => window.clearInterval(interval);
  }, [applyUpdateStatus, upState]);

  // A on the System-info update button: check first, install once one is found.
  const updateAction = (state: typeof upState) => {
    if (state === 'checking' || state === 'installing') return;
    shellInput.blip('select');
    if (state === 'available') runUpdateInstall();
    else runUpdateCheck();
  };

  useEffect(() => {
    const beginWifiConnection = (ssid: string, psk: string, retryPassword: boolean) => {
      const seq = ++wifiConnectSeq.current;
      setOsk(null);
      setConnectingTo(ssid);
      setWifiNotice({ tone: 'info', message: `Connecting to ${ssid}…` });
      void api
        .wifiConnect(ssid, psk)
        .then((res) => {
          if (seq !== wifiConnectSeq.current) return;
          if (res.ok) {
            setWifiNotice({ tone: 'info', message: `Connected to ${ssid}` });
            shellInput.blip('success');
            setPanelCursor(0);
            setNetworks(null); // refresh current-network marker and signal levels
            return;
          }

          const message =
            res.reason === 'bad-password'
              ? 'Wrong password — edit it or cancel.'
              : res.reason === 'timeout'
                ? 'The network did not respond in time. Your previous network is still saved.'
                : (res.error ?? 'Connection failed.');
          setWifiNotice({ tone: 'error', message });
          shellInput.blip('error');
          const current = stateRef.current;
          if (retryPassword && current.tab === 'wifi' && current.zone === 'panel') {
            oskTarget.current = ssid;
            setOsk(newOskState({ value: psk }));
          }
        })
        .catch((e: Error) => {
          if (seq !== wifiConnectSeq.current) return;
          setWifiNotice({ tone: 'error', message: `Connection failed: ${e.message}` });
          shellInput.blip('error');
          const current = stateRef.current;
          if (retryPassword && current.tab === 'wifi' && current.zone === 'panel') {
            oskTarget.current = ssid;
            setOsk(newOskState({ value: psk }));
          }
        })
        .finally(() => {
          if (seq === wifiConnectSeq.current) setConnectingTo(null);
        });
    };

    return shellInput.pushHandler((btn) => {
      const s = stateRef.current;

      // On-screen keyboard modal owns input while open.
      if (s.osk) {
        const outcome: { submitted?: string; canceled: boolean } = { canceled: false };
        const next = oskHandle(
          s.osk,
          btn,
          (value) => {
            outcome.submitted = value;
          },
          () => {
            outcome.canceled = true;
          },
        );
        if (outcome.canceled) {
          setOsk(null);
          setWifiNotice({ tone: 'info', message: 'Connection canceled.' });
        } else if (outcome.submitted !== undefined) {
          if (outcome.submitted.length === 0) {
            setOsk(next);
            setWifiNotice({
              tone: 'error',
              message: 'Enter the WiFi password, or press X to cancel.',
            });
            shellInput.blip('error');
          } else {
            beginWifiConnection(oskTarget.current, outcome.submitted, true);
          }
        } else {
          setOsk(next);
        }
        return;
      }

      if (s.zone === 'tabs') {
        const ix = s.tabs.findIndex((t) => t.id === s.tab);
        if (btn === 'UP' || btn === 'DOWN') {
          const next = s.tabs[(ix + (btn === 'DOWN' ? 1 : s.tabs.length - 1)) % s.tabs.length]!;
          setTab(next.id);
          setPanelCursor(0);
          shellInput.blip('move');
        } else if (btn === 'A' || btn === 'RIGHT') {
          setZone('panel');
          setPanelCursor(0);
          shellInput.blip('select');
        } else if (btn === 'B') {
          shellInput.blip('back');
          props.go({ name: 'home' });
        }
        return;
      }

      // panel zone
      if (btn === 'B') {
        setZone('tabs');
        shellInput.blip('back');
        return;
      }
      if (s.tab === 'audio') {
        const keys = ['musicVol', 'sfxVol', 'uiVol'] as const;
        if (btn === 'UP' || btn === 'DOWN') {
          setPanelCursor((c) => (c + (btn === 'DOWN' ? 1 : 2)) % 3);
          shellInput.blip('move');
        } else if (btn === 'LEFT' || btn === 'RIGHT') {
          const key = keys[s.panelCursor]!;
          const next = { ...audio };
          next[key] = Math.max(
            0,
            Math.min(1, Math.round((next[key] + (btn === 'RIGHT' ? 0.1 : -0.1)) * 10) / 10),
          );
          saveAudio(next);
          shellInput.blip('move');
        }
      } else if (s.tab === 'controls') {
        if (btn === 'A') {
          shellInput.blip('select');
          props.go({
            name: 'remap',
            firstBoot: false,
            returnTo: { name: 'settings', tab: 'controls' },
          });
        }
      } else if (s.tab === 'devices') {
        const cams = s.inputs?.cameras ?? [];
        const mics = s.inputs?.mics ?? [];
        const rows = cams.length + mics.length + 1; // + rescan
        if (btn === 'UP' || btn === 'DOWN') {
          setPanelCursor((c) => (c + (btn === 'DOWN' ? 1 : rows - 1)) % rows);
          shellInput.blip('move');
        } else if (btn === 'A' || btn === 'LEFT' || btn === 'RIGHT') {
          if (btn === 'A' && s.panelCursor < cams.length)
            chooseDevice('camera', cams[s.panelCursor]!);
          else if (btn === 'A' && s.panelCursor < cams.length + mics.length)
            chooseDevice('mic', mics[s.panelCursor - cams.length]!);
          else if (btn === 'A' && s.panelCursor === cams.length + mics.length) {
            setInputs(null); // rescan
            setProbe(null);
            setPanelCursor(0);
            shellInput.blip('select');
          }
        }
      } else if (s.tab === 'wifi') {
        const list = s.networks ?? [];
        if (btn === 'UP' || btn === 'DOWN') {
          if (s.networks === null) return;
          setPanelCursor((c) => {
            const n = list.length + 1; // + rescan row
            return (c + (btn === 'DOWN' ? 1 : n - 1)) % Math.max(1, n);
          });
          shellInput.blip('move');
        } else if (btn === 'A') {
          if (s.connectingTo) {
            setWifiNotice({
              tone: 'info',
              message: `Still connecting to ${s.connectingTo}. You can leave Settings while it finishes.`,
            });
            shellInput.blip('error');
            return;
          }
          if (s.networks === null) {
            shellInput.blip('error');
            return;
          }
          shellInput.blip('select');
          if (s.panelCursor >= list.length) {
            setNetworks(null); // rescan
            setWifiNotice(null);
          } else {
            const net = list[s.panelCursor]!;
            if (net.current) {
              setWifiNotice({ tone: 'info', message: `Already connected to ${net.ssid}` });
            } else if (!net.supported) {
              setWifiNotice({
                tone: 'error',
                message:
                  'Enterprise WiFi needs a username or certificate and cannot be configured here. Use a personal/hotspot network.',
              });
              shellInput.blip('error');
            } else if (net.requiresPassword) {
              oskTarget.current = net.ssid;
              setWifiNotice(null);
              setOsk(newOskState());
            } else {
              beginWifiConnection(net.ssid, '', false);
            }
          }
        }
      } else if (s.tab === 'registration') {
        const canPair =
          !s.registration ||
          s.registration.state === 'error' ||
          s.registration.state === 'unregistered' ||
          s.registration.state === 'expired' ||
          s.registration.state === 'revoked' ||
          s.registration.legacy;
        if (btn === 'A' && canPair) {
          shellInput.blip('select');
          beginPairing(s.registration?.state === 'revoked' || s.registration?.legacy === true);
        }
      } else if (s.tab === 'system') {
        // Only the update button is focusable, and only on the cabinet.
        if (btn === 'A' && s.info?.isPi) updateAction(s.upState);
      }
    });
  }, [audio, beginPairing, props.go]);

  return (
    <div class="screen">
      <div class="screen-title">
        <h2 class="pixel">SETTINGS</h2>
      </div>
      <div class="screen-body settings-layout">
        <div class="settings-tabs" ref={settingsTabsRef}>
          {tabs.map((t) => (
            <div
              key={t.id}
              class={`focusable settings-tab ${tab === t.id && zone === 'tabs' ? 'focused' : ''}`}
              style={tab === t.id && zone !== 'tabs' ? 'border-color:var(--cyan)' : ''}
            >
              {t.label}
            </div>
          ))}
        </div>
        <div class="settings-panel">
          {tab === 'audio' && (
            <div>
              {(
                [
                  ['Music', 'musicVol'],
                  ['Sound FX', 'sfxVol'],
                  ['UI blips', 'uiVol'],
                ] as const
              ).map(([label, key], i) => (
                <div
                  key={key}
                  class={`slider-row focusable ${zone === 'panel' && panelCursor === i ? 'focused' : ''}`}
                >
                  <span style="width:130px">{label}</span>
                  <div class="bar">
                    <div style={{ width: `${audio[key] * 100}%` }} />
                  </div>
                  <span style="width:56px;text-align:right">{Math.round(audio[key] * 100)}%</span>
                </div>
              ))}
              <p style="color:var(--text-dim);font-size:16px;margin-top:14px">
                <Icon name="arrowLeft" /> <Icon name="arrowRight" /> adjust · <Btn>B</Btn> back to
                tabs
              </p>
            </div>
          )}
          {tab === 'controls' && (
            <div>
              <div
                class="control-grid"
                style="display:grid;grid-template-columns:1fr 1fr;gap:2px 24px"
              >
                {LOGICAL_BUTTONS.map((b) => {
                  const gp = Object.entries(props.settings?.input.gamepad ?? {}).find(
                    ([, v]) => v === b,
                  )?.[0];
                  const kb = Object.entries(props.settings?.input.keyboard ?? {}).find(
                    ([, v]) => v === b,
                  )?.[0];
                  return (
                    <div key={b} class="kv">
                      <span class="k">{b}</span>
                      <span>
                        {gp ?? '—'} · {kb ?? '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div
                class={`focusable menu-item ${zone === 'panel' ? 'focused' : ''}`}
                style="margin-top:12px;max-width:320px;font-size:16px"
              >
                <span class="icon">
                  <Icon name="joystick" />
                </span>{' '}
                Remap controls
              </div>
              <p style="color:var(--text-dim);font-size:16px;margin-top:10px">
                Tip: hold any single button for 5 seconds on any menu to remap.
              </p>
            </div>
          )}
          {tab === 'devices' && (
            <div class="devices-layout">
              <div class="device-lists" ref={deviceListRef}>
                {inputs === null ? (
                  <div style="color:var(--text-dim)">
                    <Icon name="sparkle" class="spin" /> Detecting cameras &amp; mics…
                  </div>
                ) : (
                  <>
                    <div class="device-group">Camera</div>
                    {inputs.cameras.length === 0 && (
                      <div class="device-none">No camera found — check the USB connection</div>
                    )}
                    {inputs.cameras.map((d, i) => (
                      <div
                        key={d.id}
                        class={`focusable device-row ${zone === 'panel' && panelCursor === i ? 'focused' : ''}`}
                      >
                        <span class="device-check">
                          {devSel.cameraId === d.id ? <Icon name="dot" /> : <Icon name="ring" />}
                        </span>
                        <span class="device-label">{d.label}</span>
                      </div>
                    ))}
                    <div class="device-group">Microphone</div>
                    {inputs.mics.length === 0 && (
                      <div class="device-none">No microphone found — check the USB connection</div>
                    )}
                    {inputs.mics.map((d, i) => {
                      const row = inputs.cameras.length + i;
                      return (
                        <div
                          key={d.id}
                          class={`focusable device-row ${zone === 'panel' && panelCursor === row ? 'focused' : ''}`}
                        >
                          <span class="device-check">
                            {devSel.micId === d.id ? <Icon name="dot" /> : <Icon name="ring" />}
                          </span>
                          <span class="device-label">{d.label}</span>
                        </div>
                      );
                    })}
                    <div
                      class={`focusable device-row device-rescan ${zone === 'panel' && panelCursor === inputs.cameras.length + inputs.mics.length ? 'focused' : ''}`}
                    >
                      <span class="device-check">
                        <Icon name="refresh" />
                      </span>
                      <span class="device-label">Rescan devices</span>
                    </div>
                    <div
                      class="device-group"
                      style="margin-top:14px;padding-top:10px;border-top:1px solid var(--line,#333)"
                    >
                      Generated hero art
                    </div>
                    <div style="font-size:13px;color:var(--text-dim);margin:0 0 6px 4px;max-width:440px;line-height:1.5">
                      Photos accepted in the game wizard are sent to Meta's Model API to create
                      personalized hero art and, for detailed platformers, to select the best
                      identity and run animation. The source photo is removed after the game is
                      successfully published.
                    </div>
                    {inputs.cameras.length === 0 && inputs.mics.length === 0 && (
                      <div style="margin-top:14px;padding-top:10px;border-top:1px solid var(--line,#333)">
                        <div class="device-group">Diagnostics</div>
                        {probe === null ? (
                          <div style="color:var(--text-dim)">
                            <Icon name="sparkle" class="spin" /> Probing media stack…
                          </div>
                        ) : (
                          <pre style="font-size:13px;line-height:1.5;color:var(--text-dim);white-space:pre-wrap;word-break:break-word;margin:0">
                            {describeProbe(probe)}
                          </pre>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
              {/* Rendered only after enumeration: keeps the preview's getUserMedia
                  from racing the label-unlock throwaway, and makes Rescan (which
                  nulls `inputs`) remount the monitor so a replugged device's
                  preview re-acquires without leaving the tab. */}
              {inputs !== null && <DeviceMonitor cameraId={devSel.cameraId} micId={devSel.micId} />}
            </div>
          )}
          {tab === 'wifi' && (
            <div>
              {wifiNotice && (
                <div
                  class={`wifi-notice ${wifiNotice.tone === 'error' ? 'error' : ''}`}
                  role={wifiNotice.tone === 'error' ? 'alert' : 'status'}
                >
                  {wifiNotice.message}
                </div>
              )}
              {connectingTo && (
                <div style="color:var(--gold);font-size:18px;margin-bottom:10px">
                  <Icon name="sparkle" class="spin" /> Connecting to {connectingTo}… This can take
                  up to 50 seconds.
                </div>
              )}
              {networks === null ? (
                <div style="color:var(--text-dim)">
                  <Icon name="sparkle" class="spin" /> Scanning networks…
                </div>
              ) : (
                <div class="wifi-list" ref={wifiListRef}>
                  {networks.map((n, i) => (
                    <div
                      key={n.ssid}
                      class={`focusable wifi-row ${zone === 'panel' && panelCursor === i ? 'focused' : ''}`}
                    >
                      <span>
                        {n.current ? <Icon name="check" /> : n.secured ? <Icon name="lock" /> : '·'}
                      </span>
                      <span>{n.ssid}</span>
                      <span class={`wifi-security ${n.supported ? '' : 'unsupported'}`}>
                        {n.supported ? (n.security ?? 'OPEN') : 'ENTERPRISE'}
                      </span>
                      <span class="signal">
                        <SignalBars level={barsFor(n.signal)} />
                      </span>
                    </div>
                  ))}
                  <div
                    class={`focusable wifi-row ${zone === 'panel' && panelCursor === networks.length ? 'focused' : ''}`}
                  >
                    <span>
                      <Icon name="refresh" />
                    </span>
                    <span>Rescan</span>
                  </div>
                </div>
              )}
              {info?.forcedPi && (
                <p style="color:var(--gold);font-size:15px;margin-top:10px">
                  MOCK WiFi (SPARKADE_FORCE_PI)
                </p>
              )}
            </div>
          )}
          {tab === 'registration' && (
            <div class="registration-panel">
              {registration === null ? (
                <div class="registration-loading">
                  <Icon name="sparkle" class="spin" /> Checking registration…
                </div>
              ) : registration.state === 'registered' ? (
                <>
                  <div class="registration-status registered">
                    <span class="registration-status-icon">
                      <Icon name="cloudFilled" />
                    </span>
                    <div>
                      <span class="registration-label">Registered as</span>
                      <strong>{registration.name}</strong>
                    </div>
                  </div>
                  <div class="registration-detail">
                    <span>New games</span>
                    <strong>
                      {registration.defaultFeedVisibility === 'listed'
                        ? 'Listed in public feed'
                        : 'Unlisted by default'}
                    </strong>
                  </div>
                  <p class="registration-help">
                    Manage this cabinet, rename it, or change game visibility at sparkade.dev/admin.
                  </p>
                  {registration.legacy ? (
                    <div
                      class={`focusable menu-item registration-action ${zone === 'panel' ? 'focused' : ''}`}
                    >
                      <span class="icon">
                        <Icon name="refresh" />
                      </span>
                      Switch to secure pairing
                    </div>
                  ) : null}
                </>
              ) : registration.state === 'pairing' ? (
                <>
                  <div class="registration-label">Pair this cabinet</div>
                  {registration.pairingCode ? (
                    <div
                      class="pairing-code"
                      aria-label={`Pairing code ${registration.pairingCode}`}
                    >
                      {registration.pairingCode}
                    </div>
                  ) : (
                    <div class="registration-loading">
                      <Icon name="sparkle" class="spin" /> Requesting a pairing code…
                    </div>
                  )}
                  <p class="registration-help registration-steps">
                    Go to <strong>sparkade.dev/admin</strong>, choose <strong>Pair a kiosk</strong>,
                    and enter this code. It expires after 10 minutes.
                  </p>
                  <div class="registration-waiting">
                    <Icon name="sparkle" class="spin" /> Waiting for approval…
                  </div>
                </>
              ) : registration.state === 'disabled' ? (
                <div class="registration-empty">
                  <Icon name="cloud" />
                  <strong>Cloud registration is disabled</strong>
                  <p>{registration.message}</p>
                </div>
              ) : (
                <>
                  <div class="registration-empty">
                    <Icon name="warning" />
                    <strong>
                      {registration.state === 'revoked'
                        ? 'Registration revoked'
                        : registration.state === 'expired'
                          ? 'Pairing code expired'
                          : 'Could not reach Sparkade'}
                    </strong>
                    <p>{registration.message ?? 'Check the network connection and try again.'}</p>
                  </div>
                  <div
                    class={`focusable menu-item registration-action ${zone === 'panel' ? 'focused' : ''}`}
                  >
                    <span class="icon">
                      <Icon name="refresh" />
                    </span>
                    Request a new code
                  </div>
                </>
              )}
            </div>
          )}
          {tab === 'system' && info && (
            <div class="system-scroll" ref={systemRef}>
              <div class="kv">
                <span class="k">Version</span>
                <span>{info.version}</span>
              </div>
              <div class="kv">
                <span class="k">Build</span>
                <span>{info.buildCommit?.slice(0, 7) ?? 'Unavailable'}</span>
              </div>
              <div class="kv">
                <span class="k">IP address</span>
                <span>{info.ip}</span>
              </div>
              <div class="kv">
                <span class="k">Disk</span>
                <span>
                  {(info.diskFreeBytes / 1e9).toFixed(0)} / {(info.diskTotalBytes / 1e9).toFixed(0)}{' '}
                  GB free
                </span>
              </div>
              <div class="kv">
                <span class="k">Games</span>
                <span>{info.gameCount}</span>
              </div>
              <div class="kv">
                <span class="k">Data dir</span>
                <span style="font-size:12px;word-break:break-all;text-align:right">
                  {info.dataDir}
                </span>
              </div>
              <div class="kv">
                <span class="k">Lifetime API spend</span>
                <span style="color:var(--gold)">{usd(info.lifetimeSpendUsd)}</span>
              </div>
              <div class="kv">
                <span class="k">Hardware</span>
                <span>
                  {info.isPi
                    ? info.forcedPi
                      ? 'Forced Pi (mock)'
                      : 'Raspberry Pi'
                    : 'Dev machine'}
                </span>
              </div>
              {info.isPi && (
                <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--line,#333)">
                  <div class="kv">
                    <span class="k">Software update</span>
                    <span>
                      {upState === 'available' ? (
                        <span style="color:var(--gold)">{upLatest} available</span>
                      ) : upState === 'checking' ? (
                        'Checking…'
                      ) : upState === 'installing' ? (
                        <span style="color:var(--gold)">Updating…</span>
                      ) : upState === 'uptodate' ? (
                        <span style="color:var(--ok)">Up to date</span>
                      ) : upState === 'error' ? (
                        <span style="color:var(--danger)">Update error</span>
                      ) : (
                        '—'
                      )}
                    </span>
                  </div>
                  <div
                    class={`focusable menu-item ${zone === 'panel' ? 'focused' : ''}`}
                    style="margin-top:8px;max-width:360px;font-size:16px"
                  >
                    <span class="icon">
                      <Icon
                        name={
                          upState === 'checking' || upState === 'installing' ? 'sparkle' : 'refresh'
                        }
                        class={upState === 'checking' || upState === 'installing' ? 'spin' : ''}
                      />
                    </span>
                    {upState === 'available'
                      ? `Install update (${upLatest})`
                      : upState === 'checking'
                        ? 'Checking…'
                        : upState === 'installing'
                          ? 'Updating — reloading soon'
                          : 'Check for updates'}
                  </div>
                  {upMsg && (
                    <p style="color:var(--text-dim);font-size:14px;margin-top:8px;max-width:440px;line-height:1.5">
                      {upMsg}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          {tab === 'model' && (
            <div>
              {Object.entries(props.settings?.stages ?? {}).map(([stage, cfg]) => (
                <div key={stage} class="kv">
                  <span class="k">{stage}</span>
                  <span>
                    {cfg.provider} · {cfg.model}
                  </span>
                </div>
              ))}
              {props.settings?.imageGeneration && (
                <div class="kv">
                  <span class="k">image art</span>
                  <span>
                    Meta · {props.settings.imageGeneration.model} · $
                    {props.settings.imageGeneration.pricePerImageUsd.toFixed(2)}/image
                  </span>
                </div>
              )}
              <p style="color:var(--text-dim);font-size:16px;margin-top:14px">
                {isStandalonePortal() ? (
                  'Model settings are managed by Sparkade cloud. This Portal does not store model API keys.'
                ) : (
                  <>
                    Read-only here — change providers and models with <b>sparkade config</b> on the
                    command line. API keys live in the env file and never appear on this screen.
                  </>
                )}{' '}
                Contributor-tier text inputs and responses may be used by Meta for model training.
              </p>
            </div>
          )}
        </div>
      </div>
      <FooterLegend
        items={
          zone === 'tabs'
            ? [
                ['A', 'Open'],
                ['B', 'Back'],
              ]
            : [
                ['A', 'Select'],
                ['B', 'Tabs'],
              ]
        }
      />
      {osk && (
        <div class="modal-backdrop">
          <div class="modal" style="min-width:700px" role="dialog" aria-modal="true">
            <h3>Password for {oskTarget.current}</h3>
            {wifiNotice?.tone === 'error' && (
              <div class="wifi-notice error" role="alert">
                {wifiNotice.message}
              </div>
            )}
            <OnScreenKeyboard state={osk} label="enter password" />
            <p style="font-size:15px;margin-top:12px;color:var(--text-dim)">
              <Btn>A</Btn> Type · <Btn>B</Btn> Delete · <Btn>X</Btn> Cancel · START Connect
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function barsFor(signal: number): number {
  if (signal > 75) return 4;
  if (signal > 50) return 3;
  if (signal > 25) return 2;
  return 1;
}

/** Live camera preview + mic level meter for the selected devices (a hardware
 * sanity check: see the camera, watch the bar move when you speak). Holds the
 * streams only while mounted (the Camera & Mic tab); cleaned up on unmount. */
function DeviceMonitor(props: { cameraId?: string; micId?: string }): ComponentChildren {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [level, setLevel] = useState(0);
  const [camErr, setCamErr] = useState(false);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    setCamErr(false);
    void getUserMediaForDevice('video', props.cameraId, {
      width: { ideal: 640 },
      height: { ideal: 480 },
    })
      .then((s) => {
        if (stopped) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play().catch(() => {});
        }
      })
      .catch(() => setCamErr(true));
    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [props.cameraId]);

  useEffect(() => {
    let stopped = false;
    let raf = 0;
    let stream: MediaStream | null = null;
    let ac: AudioContext | null = null;
    void getUserMediaForDevice('audio', props.micId)
      .then((s) => {
        if (stopped) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        ac = new Ctor();
        const src = ac.createMediaStreamSource(s);
        const an = ac.createAnalyser();
        an.fftSize = 512;
        src.connect(an);
        const buf = new Uint8Array(an.fftSize);
        const tick = () => {
          an.getByteTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) {
            const d = (v - 128) / 128;
            sum += d * d;
          }
          setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
          raf = requestAnimationFrame(tick);
        };
        tick();
      })
      .catch(() => {});
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void ac?.close().catch(() => {});
    };
  }, [props.micId]);

  return (
    <div class="device-monitor">
      <div class="device-preview">
        {camErr ? (
          <div class="device-preview-err">no camera signal</div>
        ) : (
          <video ref={videoRef} autoplay muted playsinline />
        )}
      </div>
      <div class="mic-meter">
        <div class="mic-meter-fill" style={{ width: `${Math.round(level * 100)}%` }} />
      </div>
      <div class="device-hint">Speak — the bar should move. Preview shows the selected camera.</div>
    </div>
  );
}
