// New Game wizard: Step 1 photo (optional) → Step 2 idea (voice / idea cards /
// surprise me) → Step 3 review (transcript confirmed BEFORE any money is
// spent, labeled cost estimate) → Generate.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { GENERATION, LIKENESS_OVAL, MAX_PHOTO_DIM, type ArchetypeId } from '@sparkade/shared';
import { api, type SettingsPayload } from '../api';
import { FooterLegend, Modal } from '../components';
import { Icon, Btn } from '../icons';
import { getUserMediaForDevice } from '../media';
import { shellInput } from '../shell-input';
import type { Screen } from '../app';

type PhotoMode = 'choice' | 'camera' | 'preview' | 'error';
type IdeaMode = 'choice' | 'record' | 'transcribing' | 'cards';
type Step = 'photo' | 'idea' | 'review';

const SURPRISE_SPARKS = [
  'a lighthouse that walks',
  'a tea kettle knight',
  'a library whale',
  'an origami comet',
  'a moth postman',
  'a snow golem gardener',
  'a clockwork tide',
  'a mushroom orchestra',
];

export function WizardScreen(props: {
  go: (s: Screen) => void;
  settings: SettingsPayload | null;
}): ComponentChildren {
  const [step, setStep] = useState<Step>('photo');
  const [photoMode, setPhotoMode] = useState<PhotoMode>('choice');
  const [ideaMode, setIdeaMode] = useState<IdeaMode>('choice');
  const [cursor, setCursor] = useState(0);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [sourceKind, setSourceKind] = useState<'voice' | 'preset' | 'surprise'>('voice');
  const [presetId, setPresetId] = useState<string | undefined>();
  const [recordSecs, setRecordSecs] = useState(0);
  const [level, setLevel] = useState(0);
  const [sttError, setSttError] = useState('');
  const [appending, setAppending] = useState(false);
  const [estimate, setEstimate] = useState<{ usd: number | null; label: string; model: string; busy: boolean } | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [isPi, setIsPi] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [cardsScroll, setCardsScroll] = useState({ atTop: true, atBottom: true });
  const idempotencyKey = useRef(`ik-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const gridRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modeRef = useRef({ step, photoMode, ideaMode, cursor });
  modeRef.current = { step, photoMode, ideaMode, cursor };

  const presets = props.settings?.presets ?? [];

  // Idea-card grid can outgrow the screen; track scroll state for the up/down hint.
  const recomputeCards = (): void => {
    const el = gridRef.current;
    if (!el) return;
    setCardsScroll({
      atTop: el.scrollTop <= 1,
      atBottom: el.scrollTop + el.clientHeight >= el.scrollHeight - 1,
    });
  };

  // ----- camera lifecycle: request only while on the camera step ------------
  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };
  const stopMic = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    recorderRef.current = null;
  };
  useEffect(() => () => {
    stopCamera();
    stopMic();
  }, []);

  useEffect(() => {
    if (step === 'photo' && photoMode === 'camera') {
      let canceled = false;
      void getUserMediaForDevice('video', props.settings?.devices?.cameraId, {
        width: { ideal: 1280 },
        height: { ideal: 720 },
      })
        .then((stream) => {
          if (canceled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          streamRef.current = stream;
          if (videoRef.current) videoRef.current.srcObject = stream;
        })
        .catch((e: Error) => {
          setCameraError(e.name === 'NotAllowedError' ? 'Camera access was denied.' : 'No camera found.');
          setPhotoMode('error');
          setCursor(0);
        });
      return () => {
        canceled = true;
        stopCamera();
      };
    }
    return undefined;
  }, [step, photoMode]);

  useEffect(() => {
    void api.systemInfo().then((i) => setIsPi(i.isPi)).catch(() => {});
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    if (step === 'review') {
      void api.estimate().then(setEstimate).catch(() => setEstimate(null));
    }
  }, [step]);

  // Keep the focused idea card scrolled into view and refresh the up/down hint.
  useEffect(() => {
    if (step === 'idea' && ideaMode === 'cards') {
      cardRef.current?.scrollIntoView({ block: 'nearest' });
      recomputeCards();
    }
  }, [cursor, ideaMode, step, presets.length]);

  // ----- capture ------------------------------------------------------------
  const snapPhoto = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const side = Math.min(video.videoWidth, video.videoHeight);
    const size = Math.min(MAX_PHOTO_DIM, side);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    // center-crop square; canvas re-encode strips EXIF and bakes orientation
    ctx.drawImage(
      video,
      (video.videoWidth - side) / 2,
      (video.videoHeight - side) / 2,
      side,
      side,
      0,
      0,
      size,
      size,
    );
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        setPhotoBlob(blob);
        setPhotoUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(blob);
        });
        stopCamera();
        setPhotoMode('preview');
        setCursor(1); // default focus "Use photo"
        shellInput.blip('success');
      },
      'image/jpeg',
      0.85,
    );
  };

  const startCountdown = () => {
    setCountdown(3);
    const tick = (n: number) => {
      shellInput.blip('move');
      if (n === 0) {
        setCountdown(0);
        snapPhoto();
        return;
      }
      setCountdown(n);
      setTimeout(() => tick(n - 1), 800);
    };
    tick(3);
  };

  // ----- recording ------------------------------------------------------------
  const startRecording = async () => {
    setSttError('');
    try {
      const stream = await getUserMediaForDevice('audio', props.settings?.devices?.micId);
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const rec = new MediaRecorder(stream, { mimeType: mime });
      recorderRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => chunksRef.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setIdeaMode('transcribing');
        void api
          .transcribe(blob)
          .then((text) => {
            setTranscript((prev) => (appending && prev ? `${prev} ${text}` : text));
            setSourceKind('voice');
            setPresetId(undefined);
            setAppending(false);
            setStep('review');
            setCursor(0);
            shellInput.blip('success');
          })
          .catch((e: Error) => {
            setSttError(e.message);
            setIdeaMode('choice');
            setCursor(0);
            shellInput.blip('error');
          });
      };
      // live level meter
      const audioCtx = new AudioContext();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let secs = 0;
      setRecordSecs(0);
      const meter = setInterval(() => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (const v of data) sum += v;
        setLevel(Math.min(1, sum / data.length / 90));
      }, 90);
      const clock = setInterval(() => {
        secs += 1;
        setRecordSecs(secs);
        if (secs >= GENERATION.maxRecordingSeconds) stopAll();
      }, 1000);
      const stopAll = () => {
        clearInterval(meter);
        clearInterval(clock);
        void audioCtx.close();
        if (rec.state !== 'inactive') rec.stop();
      };
      rec.addEventListener('stop', stopAll);
      rec.start();
    } catch {
      setSttError('Microphone unavailable — pick an idea card instead.');
      setIdeaMode('choice');
      shellInput.blip('error');
    }
  };

  // ----- surprise -------------------------------------------------------------
  const surpriseMe = () => {
    const archetypesList: ArchetypeId[] = ['platformer', 'shooter', 'adventure', 'hshooter'];
    const arche = archetypesList[Math.floor(Math.random() * archetypesList.length)]!;
    const spark = SURPRISE_SPARKS[Math.floor(Math.random() * SURPRISE_SPARKS.length)]!;
    setTranscript(
      `Surprise me! Invent a completely original ${arche} — perhaps something like ${spark}, or better. Pick a bold premise nobody has seen.`,
    );
    setSourceKind('surprise');
    setPresetId(undefined);
    setStep('review');
    setCursor(0);
    shellInput.blip('success');
  };

  const generate = () => {
    if (submitting || !online || !transcript.trim()) return;
    setSubmitting(true);
    void api
      .createGame({
        promptText: transcript.trim(),
        sourceKind,
        ...(presetId ? { presetId } : {}),
        ...(photoBlob ? { photo: photoBlob } : {}),
        idempotencyKey: idempotencyKey.current,
      })
      .then((r) => {
        shellInput.blip('success');
        props.go({ name: 'generation', jobId: r.jobId, gameId: r.gameId });
      })
      .catch(() => {
        setSubmitting(false);
        shellInput.blip('error');
      });
  };

  // ----- input ---------------------------------------------------------------
  useEffect(
    () =>
      shellInput.pushHandler((btn) => {
        const m = modeRef.current;
        const nav = (count: number, horizontal = false) => {
          if ((horizontal && btn === 'LEFT') || (!horizontal && btn === 'UP')) {
            setCursor((c) => (c + count - 1) % count);
            shellInput.blip('move');
            return true;
          }
          if ((horizontal && btn === 'RIGHT') || (!horizontal && btn === 'DOWN')) {
            setCursor((c) => (c + 1) % count);
            shellInput.blip('move');
            return true;
          }
          return false;
        };

        if (m.step === 'photo') {
          if (m.photoMode === 'choice') {
            const count = import.meta.env.DEV ? 3 : 2;
            if (nav(count)) return;
            if (btn === 'A') {
              shellInput.blip('select');
              if (m.cursor === 0) {
                setPhotoMode('camera');
              } else if (m.cursor === 1) {
                setPhotoBlob(null);
                setStep('idea');
                setIdeaMode('choice');
                setCursor(0);
              } else {
                fileInputRef.current?.click(); // dev-only upload fallback
              }
            } else if (btn === 'B') {
              shellInput.blip('back');
              props.go({ name: 'home' });
            }
          } else if (m.photoMode === 'camera') {
            if (btn === 'A' && countdown === 0) startCountdown();
            else if (btn === 'B') {
              shellInput.blip('back');
              stopCamera();
              setPhotoMode('choice');
              setCursor(0);
            }
          } else if (m.photoMode === 'preview') {
            if (nav(2, true)) return;
            if (btn === 'A') {
              shellInput.blip('select');
              if (m.cursor === 0) {
                setPhotoBlob(null);
                setPhotoMode('camera'); // retake
              } else {
                setStep('idea');
                setIdeaMode('choice');
                setCursor(0);
              }
            } else if (btn === 'B') {
              shellInput.blip('back');
              setPhotoMode('choice');
              setCursor(0);
            }
          } else if (m.photoMode === 'error') {
            if (nav(2, true)) return;
            if (btn === 'A') {
              shellInput.blip('select');
              if (m.cursor === 0) setPhotoMode('camera');
              else {
                setPhotoBlob(null);
                setStep('idea');
                setIdeaMode('choice');
                setCursor(0);
              }
            } else if (btn === 'B') {
              shellInput.blip('back');
              setPhotoMode('choice');
              setCursor(0);
            }
          }
          return;
        }

        if (m.step === 'idea') {
          if (m.ideaMode === 'choice') {
            const count = import.meta.env.DEV ? 4 : 3;
            if (nav(count)) return;
            if (btn === 'A') {
              shellInput.blip('select');
              if (m.cursor === 0) {
                setIdeaMode('record');
                void startRecording();
              } else if (m.cursor === 1) {
                setIdeaMode('cards');
                setCursor(0);
              } else if (m.cursor === 2) {
                surpriseMe();
              } else {
                // dev-only canned transcript
                setTranscript('A brave little robot climbs a clockwork tower to wake the sun');
                setSourceKind('voice');
                setStep('review');
                setCursor(0);
              }
            } else if (btn === 'B') {
              shellInput.blip('back');
              setStep('photo');
              setPhotoMode('choice');
              setCursor(0);
            }
          } else if (m.ideaMode === 'record') {
            if (btn === 'A') stopMic(); // A stops (it also started)
            else if (btn === 'B') {
              shellInput.blip('back');
              stopMic();
              stopCamera();
              setIdeaMode('choice');
              setCursor(0);
            }
          } else if (m.ideaMode === 'cards') {
            const count = presets.length;
            if (btn === 'LEFT' || btn === 'RIGHT') {
              setCursor((c) => (btn === 'LEFT' ? (c + count - 1) % count : (c + 1) % count));
              shellInput.blip('move');
            } else if (btn === 'UP' || btn === 'DOWN') {
              setCursor((c) => {
                const next = btn === 'UP' ? c - 2 : c + 2;
                if (next < 0 || next >= count) return c;
                shellInput.blip('move');
                return next;
              });
            } else if (btn === 'A') {
              shellInput.blip('select');
              const preset = presets[m.cursor];
              if (preset) {
                setTranscript(`${preset.title}: ${preset.premise} (${preset.tone})`);
                setSourceKind('preset');
                setPresetId(preset.id);
                setStep('review');
                setCursor(0);
              }
            } else if (btn === 'B') {
              shellInput.blip('back');
              setIdeaMode('choice');
              setCursor(0);
            }
          }
          return;
        }

        // review
        const canAddMore = sourceKind === 'voice';
        const count = canAddMore ? 3 : 2;
        if (nav(count)) return;
        if (btn === 'A') {
          if (m.cursor === 0) {
            if (!online) {
              shellInput.blip('error');
              return;
            }
            shellInput.blip('select');
            generate();
          } else if (m.cursor === 1) {
            shellInput.blip('select');
            setAppending(false);
            setStep('idea');
            setIdeaMode(sourceKind === 'voice' ? 'record' : 'choice');
            setCursor(0);
            if (sourceKind === 'voice') void startRecording();
          } else {
            shellInput.blip('select');
            setAppending(true);
            setStep('idea');
            setIdeaMode('record');
            void startRecording();
          }
        } else if (btn === 'B') {
          shellInput.blip('back');
          setStep('idea');
          setIdeaMode('choice');
          setCursor(0);
        } else if (btn === 'X' && !online && isPi) {
          props.go({ name: 'settings', tab: 'wifi' });
        }
      }),
    [countdown, online, isPi, presets, sourceKind, submitting, transcript, props.go],
  );

  // ------------------------------------------------------------------ render
  const stepChip = (
    <div class="wizard-steps">
      <span class={`step ${step === 'photo' ? 'on' : ''}`}>1 PHOTO</span>
      <span><Icon name="chevronRight" /></span>
      <span class={`step ${step === 'idea' ? 'on' : ''}`}>2 IDEA</span>
      <span><Icon name="chevronRight" /></span>
      <span class={`step ${step === 'review' ? 'on' : ''}`}>3 REVIEW</span>
    </div>
  );

  return (
    <div class="screen">
      <div class="screen-title">
        <h2 class="pixel">NEW GAME</h2>
        <span class="status-chips">{stepChip}</span>
      </div>
      <div class="screen-body">
        {step === 'photo' && photoMode === 'choice' && (
          <div class="center-col">
            <div style="font-size:24px">Want to be in the game?</div>
            <div style="color:var(--text-dim);font-size:18px;max-width:560px">
              Your face becomes the hero's pixel head and the story-card portrait. The photo never
              leaves this cabinet.
            </div>
            <div class="menu-list" style="width:480px;margin-top:10px">
              <div class={`focusable menu-item ${cursor === 0 ? 'focused' : ''}`}>
                <span class="icon"><Icon name="camera" /></span> Take photo
              </div>
              <div class={`focusable menu-item ${cursor === 1 ? 'focused' : ''}`}>
                <span class="icon"><Icon name="arrowRight" /></span> Skip
              </div>
              {import.meta.env.DEV && (
                <div class={`focusable menu-item ${cursor === 2 ? 'focused' : ''}`}>
                  <span class="icon"><Icon name="folder" /></span> Upload photo (dev)
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style="display:none"
              onChange={(e) => {
                const f = (e.target as HTMLInputElement).files?.[0];
                if (f) {
                  setPhotoBlob(f);
                  setPhotoUrl((old) => {
                    if (old) URL.revokeObjectURL(old);
                    return URL.createObjectURL(f);
                  });
                  setStep('idea');
                  setIdeaMode('choice');
                  setCursor(0);
                }
              }}
            />
          </div>
        )}
        {step === 'photo' && photoMode === 'camera' && (
          <div class="center-col">
            <div class="camera-stage">
              <video ref={videoRef} autoPlay playsInline muted />
              {/* Guide geometry = LIKENESS_OVAL, the same numbers the server
                  crops with. Under object-fit:cover on a landscape camera the
                  captured square displays exactly stage-height tall, so:
                  width% = 2·rx·(stageH/stageW), height% = 2·ry. */}
              <div
                class="oval-guide"
                style={{
                  width: `${(2 * LIKENESS_OVAL.rx * (330 / 440) * 100).toFixed(1)}%`,
                  height: `${(2 * LIKENESS_OVAL.ry * 100).toFixed(1)}%`,
                  top: `${(LIKENESS_OVAL.cy * 100).toFixed(1)}%`,
                }}
              />
              {countdown > 0 && <div class="countdown">{countdown}</div>}
            </div>
            <div style="color:var(--text-dim)">Line your face up with the oval</div>
          </div>
        )}
        {step === 'photo' && photoMode === 'preview' && (
          <div class="center-col">
            <div class="camera-stage" style="width:330px;height:330px">
              {photoUrl && <img src={photoUrl} style="width:100%;height:100%;object-fit:cover" />}
            </div>
            <div class="modal-choices" style="display:flex;gap:18px">
              <div class={`focusable ${cursor === 0 ? 'focused' : ''}`} style="padding:12px 28px">
                Retake
              </div>
              <div class={`focusable ${cursor === 1 ? 'focused' : ''}`} style="padding:12px 28px">
                Use photo
              </div>
            </div>
          </div>
        )}
        {step === 'photo' && photoMode === 'error' && (
          <div class="center-col">
            <div style="font-size:24px;color:var(--danger)">{cameraError}</div>
            <div style="display:flex;gap:18px;margin-top:10px">
              <div class={`focusable ${cursor === 0 ? 'focused' : ''}`} style="padding:12px 28px">
                Retry
              </div>
              <div class={`focusable ${cursor === 1 ? 'focused' : ''}`} style="padding:12px 28px">
                Continue without photo
              </div>
            </div>
          </div>
        )}

        {step === 'idea' && ideaMode === 'choice' && (
          <div class="center-col">
            <div style="font-size:24px">What should this game be?</div>
            {sttError && <div style="color:var(--danger);font-size:17px">{sttError}</div>}
            <div class="menu-list" style="width:520px">
              <div class={`focusable menu-item ${cursor === 0 ? 'focused' : ''}`}>
                <span class="icon"><Icon name="mic" /></span> Speak
                <span class="hint">up to {GENERATION.maxRecordingSeconds}s</span>
              </div>
              <div class={`focusable menu-item ${cursor === 1 ? 'focused' : ''}`}>
                <span class="icon"><Icon name="cards" /></span> Idea card
              </div>
              <div class={`focusable menu-item ${cursor === 2 ? 'focused' : ''}`}>
                <span class="icon"><Icon name="sparkle" /></span> Surprise me
              </div>
              {import.meta.env.DEV && (
                <div class={`focusable menu-item ${cursor === 3 ? 'focused' : ''}`}>
                  <span class="icon"><Icon name="keyboard" /></span> Canned (dev)
                </div>
              )}
            </div>
          </div>
        )}
        {step === 'idea' && ideaMode === 'record' && (
          <div class="center-col">
            <div style="font-size:26px;color:var(--spark)"><Icon name="dot" /> Recording…</div>
            <div style="font-size:20px;color:var(--text-dim)">
              Describe the game you want. {GENERATION.maxRecordingSeconds - recordSecs}s left
            </div>
            <div class="level-meter">
              <div style={{ width: `${Math.round(level * 100)}%` }} />
            </div>
            <div style="color:var(--text-dim);font-size:18px"><Btn>A</Btn> Stop · <Btn>B</Btn> Cancel</div>
          </div>
        )}
        {step === 'idea' && ideaMode === 'transcribing' && (
          <div class="center-col">
            <span style="font-size:38px;color:var(--cyan)"><Icon name="sparkle" class="spin" /></span>
            <div style="font-size:22px">Listening back…</div>
          </div>
        )}
        {step === 'idea' && ideaMode === 'cards' && (
          <div class="idea-grid" ref={gridRef} onScroll={recomputeCards}>
            {presets.map((p, i) => (
              <div
                key={p.id}
                ref={i === cursor ? cardRef : undefined}
                class={`focusable idea-card ${i === cursor ? 'focused' : ''}`}
              >
                <div class="genre">{p.archetype} · {p.tone}</div>
                <div class="name">{p.title}</div>
                <div class="premise">{p.premise}</div>
              </div>
            ))}
          </div>
        )}

        {step === 'review' && (
          <div class="two-col">
            <div>
              <div style="color:var(--cyan);font-size:17px;margin-bottom:8px">
                {sourceKind === 'voice' ? 'HEARD:' : sourceKind === 'preset' ? 'IDEA CARD:' : 'SURPRISE:'}
              </div>
              <div class="transcript-box">{transcript}</div>
              <div style="display:flex;gap:16px;margin-top:16px;align-items:center">
                {photoUrl ? (
                  <img
                    src={photoUrl}
                    style="width:84px;height:84px;object-fit:cover;border-radius:10px;border:2px solid var(--line)"
                  />
                ) : (
                  <div style="width:84px;height:84px;border-radius:10px;border:2px dashed var(--line);display:flex;align-items:center;justify-content:center;color:var(--text-dim);font-size:13px;text-align:center">
                    no photo
                  </div>
                )}
                <div style="font-size:17px;color:var(--text-dim)">
                  <div>
                    Model: <b style="color:var(--text)">{estimate?.model ?? '…'}</b>
                  </div>
                  <div>
                    Network:{' '}
                    <b style={`color:${online ? 'var(--ok)' : 'var(--danger)'}`}>
                      {online ? 'online' : 'offline'}
                    </b>
                  </div>
                  <div>
                    Cost: <b style="color:var(--gold)">{estimate?.label ?? '…'}</b>
                  </div>
                  {estimate?.busy && <div style="color:var(--cyan)">Another game is generating — this one will queue.</div>}
                </div>
              </div>
              {!online && (
                <div style="margin-top:12px;color:var(--danger);font-size:18px">
                  Offline — connect to WiFi to generate.{isPi ? (<> Press <Btn>X</Btn> for WiFi settings.</>) : ''}
                </div>
              )}
            </div>
            <div>
              <div class="menu-list" style="margin:0">
                <div
                  class={`focusable menu-item ${cursor === 0 ? 'focused' : ''}`}
                  style={!online ? 'opacity:0.45' : ''}
                >
                  <span class="icon"><Icon name="sparkle" /></span> {submitting ? 'Starting…' : 'Generate'}
                </div>
                <div class={`focusable menu-item ${cursor === 1 ? 'focused' : ''}`}>
                  <span class="icon"><Icon name="refresh" /></span> {sourceKind === 'voice' ? 'Re-record' : 'Change idea'}
                </div>
                {sourceKind === 'voice' && (
                  <div class={`focusable menu-item ${cursor === 2 ? 'focused' : ''}`}>
                    <span class="icon"><Icon name="plus" /></span> Add more
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      <FooterLegend
        items={
          step === 'photo' && photoMode === 'camera'
            ? [
                ['A', 'Snap (3·2·1)'],
                ['B', 'Back'],
              ]
            : step === 'idea' && ideaMode === 'record'
              ? [
                  ['A', 'Stop'],
                  ['B', 'Cancel'],
                ]
              : [
                  ['A', 'Select'],
                  ['B', 'Back'],
                ]
        }
      />
      {step === 'idea' && ideaMode === 'cards' && !(cardsScroll.atTop && cardsScroll.atBottom) && (
        <div class="wizard-scroll-hint" title="scroll">
          <span class={cardsScroll.atTop ? 'off' : ''}>
            <Icon name="pixUp" />
          </span>
          <span class={cardsScroll.atBottom ? 'off' : ''}>
            <Icon name="pixDown" />
          </span>
        </div>
      )}
      {submitting && (
        <Modal>
          <h3>
            <Icon name="sparkle" class="spin" /> Starting generation…
          </h3>
        </Modal>
      )}
    </div>
  );
}
