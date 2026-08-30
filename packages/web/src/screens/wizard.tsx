// Guided New Game wizard: photo (optional) → hero name → engine → creative
// details → review. Every user-approved choice is sent as a structured brief;
// promptText remains as the readable/legacy representation.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import {
  GENERATION,
  LIKENESS_OVAL,
  MAX_PHOTO_DIM,
  type ArchetypeId,
  type GameListItem,
} from '@sparkade/shared';
import { api, type SettingsPayload } from '../api';
import { FooterLegend, GameCover, Modal } from '../components';
import { Icon, Btn } from '../icons';
import { getUserMediaForDevice } from '../media';
import { shellInput } from '../shell-input';
import { pickSurpriseArchetype } from '../surprise';
import type { Screen } from '../app';

type PhotoMode = 'choice' | 'camera' | 'preview' | 'error';
type EntryMode = 'choice' | 'record' | 'transcribing' | 'cards';
type RecordTarget = 'name' | 'details';
type Step = 'photo' | 'name' | 'archetype' | 'details' | 'review';

interface ArchetypeChoice {
  id: ArchetypeId;
  label: string;
  feel: string;
  description: string;
}

const ARCHETYPES: readonly ArchetypeChoice[] = [
  {
    id: 'platformer',
    label: 'Platformer',
    feel: 'Run · jump · explore',
    description: 'Side-view stages full of movement, secrets, enemies, and a finale boss.',
  },
  {
    id: 'shooter',
    label: 'Vertical Shooter',
    feel: 'Dodge · blast · survive',
    description: 'Fly upward through enemy waves, power-ups, hazards, and giant bosses.',
  },
  {
    id: 'adventure',
    label: 'Adventure',
    feel: 'Explore · discover · battle',
    description: 'A top-down world of connected rooms, characters, items, and puzzles.',
  },
  {
    id: 'hshooter',
    label: 'Side-Scroll Shooter',
    feel: 'Fly · weave · fire',
    description: 'Race across cinematic landscapes while enemies and terrain close in.',
  },
  {
    id: 'fighter',
    label: 'Fighter',
    feel: 'Duel · counter · triumph',
    description: 'A character-driven arcade ladder with distinct rivals and arenas.',
  },
];

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

function choiceFor(id: ArchetypeId): ArchetypeChoice {
  return ARCHETYPES.find((choice) => choice.id === id) ?? ARCHETYPES[0]!;
}

export function WizardScreen(props: {
  go: (s: Screen) => void;
  settings: SettingsPayload | null;
}): ComponentChildren {
  const [step, setStep] = useState<Step>('photo');
  const [photoMode, setPhotoMode] = useState<PhotoMode>('choice');
  const [entryMode, setEntryMode] = useState<EntryMode>('choice');
  const [recordTarget, setRecordTarget] = useState<RecordTarget>('name');
  const [cursor, setCursor] = useState(0);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [heroName, setHeroName] = useState('');
  const [details, setDetails] = useState('');
  const [sourceKind, setSourceKind] = useState<'voice' | 'preset' | 'surprise'>('voice');
  const [requestedArchetype, setRequestedArchetype] = useState<ArchetypeId>('platformer');
  const [presetId, setPresetId] = useState<string | undefined>();
  const [recordSecs, setRecordSecs] = useState(0);
  const [level, setLevel] = useState(0);
  const [sttError, setSttError] = useState('');
  const [estimate, setEstimate] = useState<{
    usd: number | null;
    label: string;
    model: string;
    imageModel: string;
    busy: boolean;
  } | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [isPi, setIsPi] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [games, setGames] = useState<GameListItem[]>([]);
  const [cardsScroll, setCardsScroll] = useState({ atTop: true, atBottom: true });

  const idempotencyKey = useRef(`ik-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const gridRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingCanceledRef = useRef(false);
  const modeRef = useRef({ step, photoMode, entryMode, recordTarget, cursor });
  modeRef.current = { step, photoMode, entryMode, recordTarget, cursor };

  const presets = props.settings?.presets ?? [];
  const selectedChoice = choiceFor(requestedArchetype);
  const selectedIndex = ARCHETYPES.findIndex((choice) => choice.id === requestedArchetype);
  const readyPreviewByArchetype = new Map<ArchetypeId, GameListItem>();
  for (const game of games) {
    if (game.status === 'ready' && !readyPreviewByArchetype.has(game.archetype)) {
      readyPreviewByArchetype.set(game.archetype, game);
    }
  }

  const recomputeCards = (): void => {
    const el = gridRef.current;
    if (!el) return;
    setCardsScroll({
      atTop: el.scrollTop <= 1,
      atBottom: el.scrollTop + el.clientHeight >= el.scrollHeight - 1,
    });
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const stopMic = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    recorderRef.current = null;
  };

  const cancelRecording = () => {
    recordingCanceledRef.current = true;
    stopMic();
  };

  useEffect(
    () => () => {
      stopCamera();
      recordingCanceledRef.current = true;
      stopMic();
    },
    [],
  );

  useEffect(() => {
    if (step !== 'photo' || photoMode !== 'camera') return undefined;
    let canceled = false;
    void getUserMediaForDevice('video', props.settings?.devices?.cameraId, {
      width: { ideal: 1280 },
      height: { ideal: 720 },
    })
      .then((stream) => {
        if (canceled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch((error: Error) => {
        setCameraError(
          error.name === 'NotAllowedError' ? 'Camera access was denied.' : 'No camera found.',
        );
        setPhotoMode('error');
        setCursor(0);
      });
    return () => {
      canceled = true;
      stopCamera();
    };
  }, [step, photoMode]);

  useEffect(() => {
    void Promise.all([
      api
        .systemInfo()
        .then((info) => setIsPi(info.isPi))
        .catch(() => {}),
      api
        .listGames()
        .then(setGames)
        .catch(() => {}),
    ]);
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
    if (step !== 'review') return;
    void api
      .estimate({ photo: !!photoBlob, archetype: requestedArchetype })
      .then(setEstimate)
      .catch(() => setEstimate(null));
  }, [step, photoBlob, requestedArchetype]);

  useEffect(() => {
    if (step === 'details' && entryMode === 'cards') {
      cardRef.current?.scrollIntoView({ block: 'nearest' });
      recomputeCards();
    }
  }, [cursor, entryMode, step, presets.length]);

  const goToName = () => {
    setStep('name');
    setEntryMode('choice');
    setRecordTarget('name');
    setCursor(0);
  };

  const goToArchetype = () => {
    setStep('archetype');
    setEntryMode('choice');
    setCursor(
      Math.max(
        0,
        ARCHETYPES.findIndex((choice) => choice.id === requestedArchetype),
      ),
    );
  };

  const goToDetails = () => {
    setStep('details');
    setEntryMode('choice');
    setRecordTarget('details');
    setCursor(0);
  };

  const snapPhoto = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const side = Math.min(video.videoWidth, video.videoHeight);
    const size = Math.min(MAX_PHOTO_DIM, side);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
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
        setCursor(1);
        shellInput.blip('success');
      },
      'image/jpeg',
      0.85,
    );
  };

  const startCountdown = () => {
    setCountdown(3);
    const tick = (next: number) => {
      shellInput.blip('move');
      if (next === 0) {
        setCountdown(0);
        snapPhoto();
        return;
      }
      setCountdown(next);
      setTimeout(() => tick(next - 1), 800);
    };
    tick(3);
  };

  const startRecording = async (target: RecordTarget, append = false) => {
    setSttError('');
    setRecordTarget(target);
    recordingCanceledRef.current = false;
    try {
      const stream = await getUserMediaForDevice('audio', props.settings?.devices?.micId);
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => chunksRef.current.push(event.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (recordingCanceledRef.current) return;
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setEntryMode('transcribing');
        void api
          .transcribe(blob)
          .then((text) => {
            const heard = text.trim();
            if (target === 'name') {
              setHeroName(heard.slice(0, 48));
              goToArchetype();
            } else {
              setDetails((previous) => (append && previous ? `${previous} ${heard}` : heard));
              setSourceKind('voice');
              setPresetId(undefined);
              setStep('review');
              setCursor(0);
            }
            shellInput.blip('success');
          })
          .catch((error: Error) => {
            setSttError(error.message);
            setEntryMode('choice');
            setCursor(0);
            shellInput.blip('error');
          });
      };

      const audioCtx = new AudioContext();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let seconds = 0;
      setRecordSecs(0);
      const meter = setInterval(() => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (const value of data) sum += value;
        setLevel(Math.min(1, sum / data.length / 90));
      }, 90);
      const stopAll = () => {
        clearInterval(meter);
        clearInterval(clock);
        void audioCtx.close();
        if (recorder.state !== 'inactive') recorder.stop();
      };
      const clock = setInterval(() => {
        seconds += 1;
        setRecordSecs(seconds);
        if (seconds >= GENERATION.maxRecordingSeconds) stopAll();
      }, 1000);
      recorder.addEventListener('stop', stopAll);
      recorder.start();
    } catch {
      setSttError(
        target === 'name'
          ? 'Microphone unavailable — Spark can name the hero.'
          : 'Microphone unavailable — pick an idea card instead.',
      );
      setEntryMode('choice');
      shellInput.blip('error');
    }
  };

  const surpriseDetails = () => {
    const spark = SURPRISE_SPARKS[Math.floor(Math.random() * SURPRISE_SPARKS.length)]!;
    setDetails(
      `Invent a completely original ${selectedChoice.label.toLowerCase()} about ${spark}. Give it a bold world, surprising enemies, and a memorable finale.`,
    );
    setSourceKind('surprise');
    setPresetId(undefined);
    setStep('review');
    setCursor(0);
    shellInput.blip('success');
  };

  const surpriseType = () => {
    const archetype = pickSurpriseArchetype();
    setRequestedArchetype(archetype);
    setCursor(ARCHETYPES.findIndex((choice) => choice.id === archetype));
    shellInput.blip('success');
  };

  const generate = () => {
    if (submitting || !online || !details.trim()) return;
    setSubmitting(true);
    const promptText = heroName.trim()
      ? `${heroName.trim()} is the main character. ${details.trim()}`
      : details.trim();
    void api
      .createGame({
        promptText,
        sourceKind,
        requestedArchetype,
        ...(heroName.trim() ? { heroName: heroName.trim() } : {}),
        details: details.trim(),
        ...(presetId ? { presetId } : {}),
        ...(photoBlob ? { photo: photoBlob } : {}),
        idempotencyKey: idempotencyKey.current,
      })
      .then((result) => {
        shellInput.blip('success');
        props.go({ name: 'generation', jobId: result.jobId, gameId: result.gameId });
      })
      .catch(() => {
        setSubmitting(false);
        shellInput.blip('error');
      });
  };

  useEffect(
    () =>
      shellInput.pushHandler((button) => {
        const mode = modeRef.current;
        const nav = (count: number, horizontal = false) => {
          if ((horizontal && button === 'LEFT') || (!horizontal && button === 'UP')) {
            setCursor((current) => (current + count - 1) % count);
            shellInput.blip('move');
            return true;
          }
          if ((horizontal && button === 'RIGHT') || (!horizontal && button === 'DOWN')) {
            setCursor((current) => (current + 1) % count);
            shellInput.blip('move');
            return true;
          }
          return false;
        };

        if (mode.step === 'photo') {
          if (mode.photoMode === 'choice') {
            if (nav(2)) return;
            if (button === 'A') {
              shellInput.blip('select');
              if (mode.cursor === 0) setPhotoMode('camera');
              else {
                setPhotoBlob(null);
                goToName();
              }
            } else if (button === 'B') {
              shellInput.blip('back');
              props.go({ name: 'home' });
            }
          } else if (mode.photoMode === 'camera') {
            if (button === 'A' && countdown === 0) startCountdown();
            else if (button === 'B') {
              shellInput.blip('back');
              stopCamera();
              setPhotoMode('choice');
              setCursor(0);
            }
          } else if (mode.photoMode === 'preview') {
            if (nav(2, true)) return;
            if (button === 'A') {
              shellInput.blip('select');
              if (mode.cursor === 0) {
                setPhotoBlob(null);
                setPhotoMode('camera');
              } else goToName();
            } else if (button === 'B') {
              shellInput.blip('back');
              setPhotoMode('choice');
              setCursor(0);
            }
          } else if (mode.photoMode === 'error') {
            if (nav(2, true)) return;
            if (button === 'A') {
              shellInput.blip('select');
              if (mode.cursor === 0) setPhotoMode('camera');
              else {
                setPhotoBlob(null);
                goToName();
              }
            } else if (button === 'B') {
              shellInput.blip('back');
              setPhotoMode('choice');
              setCursor(0);
            }
          }
          return;
        }

        if (mode.step === 'name') {
          if (mode.entryMode === 'choice') {
            if (nav(2)) return;
            if (button === 'A') {
              shellInput.blip('select');
              if (mode.cursor === 0) {
                setEntryMode('record');
                void startRecording('name');
              } else {
                setHeroName('');
                goToArchetype();
              }
            } else if (button === 'B') {
              shellInput.blip('back');
              setStep('photo');
              setPhotoMode('choice');
              setCursor(0);
            }
          } else if (mode.entryMode === 'record') {
            if (button === 'A') stopMic();
            else if (button === 'B') {
              shellInput.blip('back');
              cancelRecording();
              setEntryMode('choice');
              setCursor(0);
            }
          }
          return;
        }

        if (mode.step === 'archetype') {
          if (button === 'LEFT' || button === 'RIGHT') {
            setCursor((current) => {
              const next =
                button === 'LEFT'
                  ? (current + ARCHETYPES.length - 1) % ARCHETYPES.length
                  : (current + 1) % ARCHETYPES.length;
              setRequestedArchetype(ARCHETYPES[next]!.id);
              return next;
            });
            shellInput.blip('move');
          } else if (button === 'A') {
            shellInput.blip('select');
            const choice = ARCHETYPES[mode.cursor];
            if (choice) setRequestedArchetype(choice.id);
            goToDetails();
          } else if (button === 'X') surpriseType();
          else if (button === 'B') {
            shellInput.blip('back');
            setStep('name');
            setEntryMode('choice');
            setCursor(0);
          }
          return;
        }

        if (mode.step === 'details') {
          if (mode.entryMode === 'choice') {
            if (nav(3)) return;
            if (button === 'A') {
              shellInput.blip('select');
              if (mode.cursor === 0) {
                setEntryMode('record');
                void startRecording('details');
              } else if (mode.cursor === 1) {
                setEntryMode('cards');
                setCursor(0);
              } else if (mode.cursor === 2) surpriseDetails();
            } else if (button === 'B') {
              shellInput.blip('back');
              goToArchetype();
            }
          } else if (mode.entryMode === 'record') {
            if (button === 'A') stopMic();
            else if (button === 'B') {
              shellInput.blip('back');
              cancelRecording();
              setEntryMode('choice');
              setCursor(0);
            }
          } else if (mode.entryMode === 'cards') {
            const count = presets.length;
            if (count > 0 && (button === 'LEFT' || button === 'RIGHT')) {
              setCursor((current) =>
                button === 'LEFT' ? (current + count - 1) % count : (current + 1) % count,
              );
              shellInput.blip('move');
            } else if (count > 0 && (button === 'UP' || button === 'DOWN')) {
              setCursor((current) => {
                const next = button === 'UP' ? current - 2 : current + 2;
                if (next < 0 || next >= count) return current;
                shellInput.blip('move');
                return next;
              });
            } else if (button === 'A') {
              const preset = presets[mode.cursor];
              if (preset) {
                shellInput.blip('select');
                setDetails(`${preset.title}: ${preset.premise} (${preset.tone})`);
                setSourceKind('preset');
                setPresetId(preset.id);
                setStep('review');
                setCursor(0);
              }
            } else if (button === 'B') {
              shellInput.blip('back');
              setEntryMode('choice');
              setCursor(0);
            }
          }
          return;
        }

        const canAddMore = sourceKind === 'voice';
        const count = canAddMore ? 3 : 2;
        if (nav(count)) return;
        if (button === 'A') {
          if (mode.cursor === 0) {
            if (!online) {
              shellInput.blip('error');
              return;
            }
            shellInput.blip('select');
            generate();
          } else if (mode.cursor === 1) {
            shellInput.blip('select');
            goToDetails();
          } else {
            shellInput.blip('select');
            setStep('details');
            setEntryMode('record');
            void startRecording('details', true);
          }
        } else if (button === 'B') {
          shellInput.blip('back');
          goToDetails();
        } else if (button === 'X' && !online && isPi) {
          props.go({ name: 'settings', tab: 'wifi' });
        }
      }),
    [
      countdown,
      details,
      heroName,
      isPi,
      online,
      presets,
      requestedArchetype,
      selectedChoice.label,
      sourceKind,
      submitting,
      props.go,
    ],
  );

  const stepChip = (
    <div class="wizard-steps">
      {(['photo', 'name', 'archetype', 'details', 'review'] as const).map((item, index) => (
        <span key={item} class={`step ${step === item ? 'on' : ''}`}>
          {index + 1} {item === 'archetype' ? 'TYPE' : item.toUpperCase()}
        </span>
      ))}
    </div>
  );

  const recording = entryMode === 'record';
  const transcribing = entryMode === 'transcribing';

  return (
    <div class="screen">
      <div class="screen-title wizard-title">
        <h2 class="pixel">NEW GAME</h2>
        <span class="status-chips">{stepChip}</span>
      </div>
      <div class="screen-body">
        {step === 'photo' && photoMode === 'choice' && (
          <div class="center-col">
            <div style="font-size:24px">Want to be in the game?</div>
            <div style="color:var(--text-dim);font-size:18px;max-width:560px">
              Your photo helps create your hero and is deleted after the game publishes.
            </div>
            <div class="menu-list" style="width:480px;margin-top:10px">
              <div class={`focusable menu-item ${cursor === 0 ? 'focused' : ''}`}>
                <span class="icon">
                  <Icon name="camera" />
                </span>{' '}
                Take photo
              </div>
              <div class={`focusable menu-item ${cursor === 1 ? 'focused' : ''}`}>
                <span class="icon">
                  <Icon name="arrowRight" />
                </span>{' '}
                Skip
              </div>
            </div>
          </div>
        )}

        {step === 'photo' && photoMode === 'camera' && (
          <div class="center-col">
            <div class="camera-stage">
              <video ref={videoRef} autoPlay playsInline muted />
              <div
                class="oval-guide"
                style={{
                  width: `${(2 * LIKENESS_OVAL.rx * (330 / 440) * 100).toFixed(1)}%`,
                  height: `${(2 * LIKENESS_OVAL.ry * 100).toFixed(1)}%`,
                  top: `${(LIKENESS_OVAL.cy * 100).toFixed(1)}%`,
                }}
              />
              {countdown > 0 ? <div class="countdown">{countdown}</div> : null}
            </div>
            <div style="color:var(--text-dim)">Line your face up with the oval</div>
          </div>
        )}

        {step === 'photo' && photoMode === 'preview' && (
          <div class="center-col">
            <div class="camera-stage" style="width:330px;height:330px">
              {photoUrl ? <img src={photoUrl} alt="Photo preview" /> : null}
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

        {step === 'name' && entryMode === 'choice' && (
          <div class="center-col">
            <div class="wizard-kicker">MEET YOUR HERO</div>
            <div style="font-size:26px">What is the main character's name?</div>
            <div style="color:var(--text-dim);font-size:18px">
              Say just the name. Spark will use it throughout the story.
            </div>
            {sttError ? <div style="color:var(--danger);font-size:17px">{sttError}</div> : null}
            <div class="menu-list" style="width:520px">
              <div class={`focusable menu-item ${cursor === 0 ? 'focused' : ''}`}>
                <span class="icon">
                  <Icon name="mic" />
                </span>{' '}
                Speak the name
              </div>
              <div class={`focusable menu-item ${cursor === 1 ? 'focused' : ''}`}>
                <span class="icon">
                  <Icon name="sparkle" />
                </span>{' '}
                Let Spark choose
              </div>
            </div>
          </div>
        )}

        {(step === 'name' || step === 'details') && recording && (
          <div class="center-col">
            <div style="font-size:26px;color:var(--spark)">
              <Icon name="dot" /> Recording…
            </div>
            <div style="font-size:20px;color:var(--text-dim)">
              {recordTarget === 'name'
                ? 'Say the character name.'
                : 'Describe the story, enemies, and look you want.'}{' '}
              {GENERATION.maxRecordingSeconds - recordSecs}s left
            </div>
            <div class="level-meter">
              <div style={{ width: `${Math.round(level * 100)}%` }} />
            </div>
            <div style="color:var(--text-dim);font-size:18px">
              <Btn>A</Btn> Stop · <Btn>B</Btn> Cancel
            </div>
          </div>
        )}

        {(step === 'name' || step === 'details') && transcribing && (
          <div class="center-col">
            <span style="font-size:38px;color:var(--cyan)">
              <Icon name="sparkle" class="spin" />
            </span>
            <div style="font-size:22px">Listening back…</div>
          </div>
        )}

        {step === 'archetype' && (
          <div class="archetype-stage">
            <div class="wizard-kicker">CHOOSE HOW IT PLAYS</div>
            <div class="archetype-carousel">
              <div
                class="archetype-track"
                style={{ transform: `translateX(calc(50% - ${selectedIndex * 232 + 107}px))` }}
              >
                {ARCHETYPES.map((choice, index) => {
                  const preview = readyPreviewByArchetype.get(choice.id);
                  return (
                    <div
                      key={choice.id}
                      class={`focusable archetype-card ${index === cursor ? 'focused selected' : ''}`}
                    >
                      <GameCover
                        cover={preview?.cover ?? null}
                        archetype={choice.id}
                        gameId={preview?.id}
                        seedText={preview?.title ?? choice.label}
                        class="archetype-cover"
                      />
                      <div class="archetype-name">{choice.label}</div>
                      <div class="archetype-feel">{choice.feel}</div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div class="archetype-description">{selectedChoice.description}</div>
            <div class="archetype-position">
              <Icon name="pixLeft" /> {selectedIndex + 1} / {ARCHETYPES.length}{' '}
              <Icon name="pixRight" />
            </div>
          </div>
        )}

        {step === 'details' && entryMode === 'choice' && (
          <div class="center-col">
            <div class="wizard-kicker">MAKE IT YOURS · {selectedChoice.label.toUpperCase()}</div>
            <div style="font-size:25px">What else should Spark know?</div>
            <div style="color:var(--text-dim);font-size:18px;max-width:620px;text-align:center">
              Try “fighting off invading aliens” or “escaping a zombie wasteland.”
            </div>
            {sttError ? <div style="color:var(--danger);font-size:17px">{sttError}</div> : null}
            <div class="menu-list" style="width:540px">
              <div class={`focusable menu-item ${cursor === 0 ? 'focused' : ''}`}>
                <span class="icon">
                  <Icon name="mic" />
                </span>{' '}
                Speak details
                <span class="hint">up to {GENERATION.maxRecordingSeconds}s</span>
              </div>
              <div class={`focusable menu-item ${cursor === 1 ? 'focused' : ''}`}>
                <span class="icon">
                  <Icon name="cards" />
                </span>{' '}
                Start from an idea card
              </div>
              <div class={`focusable menu-item ${cursor === 2 ? 'focused' : ''}`}>
                <span class="icon">
                  <Icon name="sparkle" />
                </span>{' '}
                Surprise me
              </div>
            </div>
          </div>
        )}

        {step === 'details' && entryMode === 'cards' && (
          <div class="idea-grid" ref={gridRef} onScroll={recomputeCards}>
            {presets.map((preset, index) => (
              <div
                key={preset.id}
                ref={index === cursor ? cardRef : undefined}
                class={`focusable idea-card ${index === cursor ? 'focused' : ''}`}
              >
                <div class="genre">
                  ADAPT TO {selectedChoice.label} · {preset.tone}
                </div>
                <div class="name">{preset.title}</div>
                <div class="premise">{preset.premise}</div>
              </div>
            ))}
          </div>
        )}

        {step === 'review' && (
          <div class="wizard-review">
            <div class="wizard-review-brief">
              <div class="wizard-kicker">READY FOR SPARK</div>
              <div class="review-row">
                <span>HERO</span>
                <b>{heroName || 'Spark will choose a name'}</b>
              </div>
              <div class="review-row">
                <span>GAME TYPE</span>
                <b>{selectedChoice.label}</b>
              </div>
              <div class="review-row details">
                <span>DETAILS</span>
                <b>{details}</b>
              </div>
              <div class="review-meta">
                {photoUrl ? (
                  <img src={photoUrl} alt="Hero photo" class="review-photo" />
                ) : (
                  <div class="review-no-photo">no photo</div>
                )}
                <div>
                  <div>
                    Models: <b>{estimate ? `${estimate.model} + ${estimate.imageModel}` : '…'}</b>
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
                  {estimate?.busy ? (
                    <div style="color:var(--cyan)">
                      Another game is generating — this one will queue.
                    </div>
                  ) : null}
                </div>
              </div>
              {!online ? (
                <div style="margin-top:10px;color:var(--danger);font-size:17px">
                  Offline — connect to WiFi to generate.
                  {isPi ? (
                    <>
                      {' '}
                      Press <Btn>X</Btn> for WiFi settings.
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div class="wizard-review-actions">
              <div class="menu-list" style="margin:0">
                <div
                  class={`focusable menu-item ${cursor === 0 ? 'focused' : ''}`}
                  style={!online ? 'opacity:0.45' : ''}
                >
                  <span class="icon">
                    <Icon name="sparkle" />
                  </span>{' '}
                  {submitting ? 'Starting…' : 'Generate'}
                </div>
                <div class={`focusable menu-item ${cursor === 1 ? 'focused' : ''}`}>
                  <span class="icon">
                    <Icon name="refresh" />
                  </span>{' '}
                  Change details
                </div>
                {sourceKind === 'voice' ? (
                  <div class={`focusable menu-item ${cursor === 2 ? 'focused' : ''}`}>
                    <span class="icon">
                      <Icon name="plus" />
                    </span>{' '}
                    Add more
                  </div>
                ) : null}
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
            : recording
              ? [
                  ['A', 'Stop'],
                  ['B', 'Cancel'],
                ]
              : step === 'archetype'
                ? [
                    ['← →', 'Browse'],
                    ['A', 'Choose'],
                    ['X', 'Random'],
                    ['B', 'Back'],
                  ]
                : [
                    ['A', 'Select'],
                    ['B', 'Back'],
                  ]
        }
      />
      {step === 'details' &&
      entryMode === 'cards' &&
      !(cardsScroll.atTop && cardsScroll.atBottom) ? (
        <div class="wizard-scroll-hint" title="scroll">
          <span class={cardsScroll.atTop ? 'off' : ''}>
            <Icon name="pixUp" />
          </span>
          <span class={cardsScroll.atBottom ? 'off' : ''}>
            <Icon name="pixDown" />
          </span>
        </div>
      ) : null}
      {submitting ? (
        <Modal>
          <h3>
            <Icon name="sparkle" class="spin" /> Starting generation…
          </h3>
        </Modal>
      ) : null}
    </div>
  );
}
