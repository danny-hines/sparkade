// Settings: Controls (view + remap), Audio (volume sliders), WiFi (Pi only,
// with on-screen keyboard), System info (incl. lifetime API spend), Model info.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { LOGICAL_BUTTONS, type SystemInfo, type WifiNetwork } from '@sparkade/shared';
import { api, type SettingsPayload } from '../api';
import { FooterLegend, newOskState, OnScreenKeyboard, oskHandle, usd, type OskState } from '../components';
import { enumerateInputs, getUserMediaForDevice, type DeviceInfo } from '../media';
import { shellInput } from '../shell-input';
import type { Screen } from '../app';

type Tab = 'controls' | 'audio' | 'devices' | 'wifi' | 'system' | 'model';
type DeviceSel = { cameraId?: string; cameraLabel?: string; micId?: string; micLabel?: string };

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
    { id: 'system', label: 'System info' },
    { id: 'model', label: 'Model info' },
  ];
  const [tab, setTab] = useState<Tab>((props.tab as Tab) ?? 'controls');
  const [zone, setZone] = useState<'tabs' | 'panel'>('tabs');
  const [panelCursor, setPanelCursor] = useState(0);
  const [audio, setAudio] = useState(props.settings?.audio ?? { musicVol: 0.7, sfxVol: 0.8, uiVol: 0.4 });
  const [networks, setNetworks] = useState<WifiNetwork[] | null>(null);
  const [wifiMsg, setWifiMsg] = useState('');
  const [osk, setOsk] = useState<OskState | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [inputs, setInputs] = useState<{ cameras: DeviceInfo[]; mics: DeviceInfo[] } | null>(null);
  const [devSel, setDevSel] = useState<DeviceSel>(props.settings?.devices ?? {});
  const oskTarget = useRef<string>('');
  const stateRef = useRef({ tab, zone, panelCursor, tabs, osk, networks, inputs });
  stateRef.current = { tab, zone, panelCursor, tabs, osk, networks, inputs };

  useEffect(() => {
    void api.systemInfo().then(setInfo).catch(() => {});
  }, []);
  useEffect(() => {
    if (props.settings) setAudio(props.settings.audio);
    if (props.settings) setDevSel(props.settings.devices ?? {});
  }, [props.settings]);
  useEffect(() => {
    if (tab === 'wifi' && networks === null) {
      void api.wifiNetworks().then(setNetworks).catch((e: Error) => setWifiMsg(e.message));
    }
    if (tab === 'devices' && inputs === null) {
      void enumerateInputs().then(setInputs).catch(() => setInputs({ cameras: [], mics: [] }));
    }
  }, [tab, networks, inputs]);

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

  useEffect(
    () =>
      shellInput.pushHandler((btn) => {
        const s = stateRef.current;

        // On-screen keyboard modal owns input while open.
        if (s.osk) {
          setOsk((cur) =>
            cur
              ? oskHandle(
                  cur,
                  btn,
                  (psk) => {
                    setOsk(null);
                    setConnecting(true);
                    setWifiMsg('');
                    void api.wifiConnect(oskTarget.current, psk).then((res) => {
                      setConnecting(false);
                      if (res.ok) {
                        setWifiMsg(`Connected to ${oskTarget.current}`);
                        shellInput.blip('success');
                        setNetworks(null); // refresh
                      } else {
                        setWifiMsg(
                          res.reason === 'bad-password'
                            ? 'Wrong password — try again.'
                            : res.reason === 'timeout'
                              ? 'The network did not respond in time.'
                              : (res.error ?? 'Connection failed.'),
                        );
                        shellInput.blip('error');
                      }
                    });
                  },
                  () => setOsk(null),
                )
              : cur,
          );
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
            props.go({ name: 'menu' });
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
            next[key] = Math.max(0, Math.min(1, Math.round((next[key] + (btn === 'RIGHT' ? 0.1 : -0.1)) * 10) / 10));
            saveAudio(next);
            shellInput.blip('move');
          }
        } else if (s.tab === 'controls') {
          if (btn === 'A') {
            shellInput.blip('select');
            props.go({ name: 'remap', firstBoot: false, returnTo: { name: 'settings', tab: 'controls' } });
          }
        } else if (s.tab === 'devices') {
          const cams = s.inputs?.cameras ?? [];
          const mics = s.inputs?.mics ?? [];
          const rows = cams.length + mics.length + 1; // + rescan row
          if (btn === 'UP' || btn === 'DOWN') {
            setPanelCursor((c) => (c + (btn === 'DOWN' ? 1 : rows - 1)) % rows);
            shellInput.blip('move');
          } else if (btn === 'A') {
            if (s.panelCursor < cams.length) chooseDevice('camera', cams[s.panelCursor]!);
            else if (s.panelCursor < cams.length + mics.length) chooseDevice('mic', mics[s.panelCursor - cams.length]!);
            else {
              setInputs(null); // rescan
              setPanelCursor(0);
              shellInput.blip('select');
            }
          }
        } else if (s.tab === 'wifi') {
          const list = s.networks ?? [];
          if (btn === 'UP' || btn === 'DOWN') {
            setPanelCursor((c) => {
              const n = list.length + 1; // + rescan row
              return (c + (btn === 'DOWN' ? 1 : n - 1)) % Math.max(1, n);
            });
            shellInput.blip('move');
          } else if (btn === 'A') {
            shellInput.blip('select');
            if (s.panelCursor >= list.length) {
              setNetworks(null); // rescan
              setWifiMsg('Scanning…');
            } else {
              const net = list[s.panelCursor]!;
              if (net.current) {
                setWifiMsg(`Already connected to ${net.ssid}`);
              } else if (!net.secured) {
                setConnecting(true);
                void api.wifiConnect(net.ssid, '').then((res) => {
                  setConnecting(false);
                  setWifiMsg(res.ok ? `Connected to ${net.ssid}` : (res.error ?? 'Failed'));
                  if (res.ok) setNetworks(null);
                });
              } else {
                oskTarget.current = net.ssid;
                setOsk(newOskState());
              }
            }
          }
        }
      }),
    [audio, props.go],
  );

  return (
    <div class="screen">
      <div class="screen-title">
        <h2 class="pixel">SETTINGS</h2>
      </div>
      <div class="screen-body settings-layout">
        <div class="settings-tabs">
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
                <div key={key} class={`slider-row focusable ${zone === 'panel' && panelCursor === i ? 'focused' : ''}`}>
                  <span style="width:130px">{label}</span>
                  <div class="bar">
                    <div style={{ width: `${audio[key] * 100}%` }} />
                  </div>
                  <span style="width:56px;text-align:right">{Math.round(audio[key] * 100)}%</span>
                </div>
              ))}
              <p style="color:var(--text-dim);font-size:16px;margin-top:14px">◀ ▶ adjust · Ⓑ back to tabs</p>
            </div>
          )}
          {tab === 'controls' && (
            <div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 30px;font-size:18px">
                {LOGICAL_BUTTONS.map((b) => {
                  const gp = Object.entries(props.settings?.input.gamepad ?? {}).find(([, v]) => v === b)?.[0];
                  const kb = Object.entries(props.settings?.input.keyboard ?? {}).find(([, v]) => v === b)?.[0];
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
              <div class={`focusable menu-item ${zone === 'panel' ? 'focused' : ''}`} style="margin-top:16px;max-width:320px">
                <span class="icon">🕹</span> Remap controls
              </div>
              <p style="color:var(--text-dim);font-size:16px;margin-top:10px">
                Tip: hold any single button for 5 seconds on any menu to remap.
              </p>
            </div>
          )}
          {tab === 'devices' && (
            <div class="devices-layout">
              <div class="device-lists">
                {inputs === null ? (
                  <div style="color:var(--text-dim)"><span class="spin">✦</span> Finding cameras & mics…</div>
                ) : (
                  <>
                    <div class="device-group">Camera</div>
                    {inputs.cameras.length === 0 && <div class="device-none">No camera found — check the USB connection</div>}
                    {inputs.cameras.map((d, i) => (
                      <div key={d.id} class={`focusable device-row ${zone === 'panel' && panelCursor === i ? 'focused' : ''}`}>
                        <span class="device-check">{devSel.cameraId === d.id ? '●' : '○'}</span>
                        <span class="device-label">{d.label}</span>
                      </div>
                    ))}
                    <div class="device-group">Microphone</div>
                    {inputs.mics.length === 0 && <div class="device-none">No microphone found — check the USB connection</div>}
                    {inputs.mics.map((d, i) => {
                      const row = inputs.cameras.length + i;
                      return (
                        <div key={d.id} class={`focusable device-row ${zone === 'panel' && panelCursor === row ? 'focused' : ''}`}>
                          <span class="device-check">{devSel.micId === d.id ? '●' : '○'}</span>
                          <span class="device-label">{d.label}</span>
                        </div>
                      );
                    })}
                    <div class={`focusable device-row device-rescan ${zone === 'panel' && panelCursor === inputs.cameras.length + inputs.mics.length ? 'focused' : ''}`}>
                      <span class="device-check">↻</span>
                      <span class="device-label">Rescan devices</span>
                    </div>
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
              {wifiMsg && <div style="color:var(--cyan);font-size:18px;margin-bottom:10px">{wifiMsg}</div>}
              {connecting && (
                <div style="color:var(--gold);font-size:18px;margin-bottom:10px">
                  <span class="spin">✦</span> Connecting…
                </div>
              )}
              {networks === null ? (
                <div style="color:var(--text-dim)">
                  <span class="spin">✦</span> Scanning networks…
                </div>
              ) : (
                <div style="display:flex;flex-direction:column;gap:8px;max-height:360px;overflow:hidden">
                  {networks.slice(0, 7).map((n, i) => (
                    <div key={n.ssid} class={`focusable wifi-row ${zone === 'panel' && panelCursor === i ? 'focused' : ''}`}>
                      <span>{n.current ? '✓' : n.secured ? '🔒' : '·'}</span>
                      <span>{n.ssid}</span>
                      <span class="signal">{signalBars(n.signal)}</span>
                    </div>
                  ))}
                  <div class={`focusable wifi-row ${zone === 'panel' && panelCursor === (networks?.length ?? 0) ? 'focused' : ''}`}>
                    <span>↻</span>
                    <span>Rescan</span>
                  </div>
                </div>
              )}
              {info?.forcedPi && <p style="color:var(--gold);font-size:15px;margin-top:10px">MOCK WiFi (SPARKADE_FORCE_PI)</p>}
            </div>
          )}
          {tab === 'system' && info && (
            <div>
              <div class="kv"><span class="k">Version</span><span>{info.version}</span></div>
              <div class="kv"><span class="k">IP address</span><span>{info.ip}</span></div>
              <div class="kv">
                <span class="k">Disk</span>
                <span>
                  {(info.diskFreeBytes / 1e9).toFixed(1)} GB free of {(info.diskTotalBytes / 1e9).toFixed(1)} GB
                </span>
              </div>
              <div class="kv"><span class="k">Games</span><span>{info.gameCount}</span></div>
              <div class="kv"><span class="k">Data dir</span><span style="font-size:15px">{info.dataDir}</span></div>
              <div class="kv">
                <span class="k">Lifetime API spend</span>
                <span style="color:var(--gold)">{usd(info.lifetimeSpendUsd)}</span>
              </div>
              <div class="kv"><span class="k">Hardware</span><span>{info.isPi ? (info.forcedPi ? 'Forced Pi (mock)' : 'Raspberry Pi') : 'Dev machine'}</span></div>
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
              <p style="color:var(--text-dim);font-size:16px;margin-top:14px">
                Read-only here — change providers and models with <b>sparkade config</b> on the
                command line. API keys live in the env file and never appear on this screen.
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
          <div class="modal" style="min-width:700px">
            <h3>Password for {oskTarget.current}</h3>
            <OnScreenKeyboard state={osk} label="enter password" />
            <p style="font-size:15px;margin-top:12px;color:var(--text-dim)">
              Ⓐ Type · Ⓑ Backspace/Cancel · Ⓨ Shift · START Done
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function signalBars(signal: number): string {
  if (signal > 75) return '▂▄▆█';
  if (signal > 50) return '▂▄▆_';
  if (signal > 25) return '▂▄__';
  return '▂___';
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
    void getUserMediaForDevice('video', props.cameraId, { width: { ideal: 640 }, height: { ideal: 480 } })
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
