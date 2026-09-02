// Two-step New Game flow: capture an optional photo, then edit a compact game
// brief. Unset fields deliberately remain Spark decisions.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { GENERATION, LIKENESS_OVAL, MAX_PHOTO_DIM, type ArchetypeId } from '@sparkade/shared';
import { api, type SettingsPayload } from '../api';
import { FooterLegend, Modal } from '../components';
import { Icon, Btn } from '../icons';
import { getUserMediaForDevice } from '../media';
import { shellInput } from '../shell-input';
import { buildCreationPrompt } from '../creation-brief';
import { pickSurpriseArchetype } from '../surprise';
import { normalizeTranscribedHeroName } from '../transcription';
import type { Screen } from '../app';

type PhotoMode = 'choice' | 'camera' | 'preview' | 'error';
type EntryMode = 'choice' | 'record' | 'transcribing';
type RecordTarget = 'name' | 'details';
type Step = 'photo' | 'details' | 'archetype';

interface ArchetypeChoice {
  id: ArchetypeId;
  label: string;
  cardLabel?: string;
  previewImage: string;
  feel: string;
  description: string;
}

const ARCHETYPES: readonly ArchetypeChoice[] = [
  {
    id: 'platformer',
    label: 'Platformer',
    previewImage: '/archetypes/platformer.png',
    feel: 'Run · jump · explore',
    description: 'Side-view stages full of movement, secrets, enemies, and a finale boss.',
  },
  {
    id: 'shooter',
    label: 'Vertical Shooter',
    previewImage: '/archetypes/shooter.png',
    feel: 'Dodge · blast · survive',
    description: 'Fly upward through enemy waves, power-ups, hazards, and giant bosses.',
  },
  {
    id: 'adventure',
    label: 'Adventure',
    previewImage: '/archetypes/adventure.png',
    feel: 'Explore · discover · battle',
    description: 'A top-down world of connected rooms, characters, items, and puzzles.',
  },
  {
    id: 'hshooter',
    label: 'Side-Scroll Shooter',
    cardLabel: 'Side Shooter',
    previewImage: '/archetypes/hshooter.png',
    feel: 'Fly · weave · fire',
    description: 'Race across cinematic landscapes while enemies and terrain close in.',
  },
  {
    id: 'fighter',
    label: 'Fighter',
    previewImage: '/archetypes/fighter.png',
    feel: 'Duel · counter · triumph',
    description: 'A character-driven arcade ladder with distinct rivals and arenas.',
  },
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
  const [requestedArchetype, setRequestedArchetype] = useState<ArchetypeId | null>(null);
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

  const idempotencyKey = useRef(`ik-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingCanceledRef = useRef(false);
  const modeRef = useRef({ step, photoMode, entryMode, recordTarget, cursor });
  modeRef.current = { step, photoMode, entryMode, recordTarget, cursor };

  const chosenArchetype = requestedArchetype ? choiceFor(requestedArchetype) : null;
  const carouselChoice = ARCHETYPES[cursor] ?? ARCHETYPES[0]!;

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const clearPhoto = () => {
    setPhotoBlob(null);
    setPhotoUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
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
    void api
      .systemInfo()
      .then((info) => setIsPi(info.isPi))
      .catch(() => {});
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
    if (step !== 'details' || entryMode !== 'choice') return;
    void api
      .estimate({
        photo: !!photoBlob,
        ...(requestedArchetype ? { archetype: requestedArchetype } : {}),
      })
      .then(setEstimate)
      .catch(() => setEstimate(null));
  }, [step, entryMode, photoBlob, requestedArchetype]);

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

  const goToDetails = (nextCursor = 0) => {
    setStep('details');
    setEntryMode('choice');
    setCursor(nextCursor);
  };

  const goToPhoto = () => {
    setStep('photo');
    setEntryMode('choice');
    setPhotoMode(photoUrl ? 'preview' : 'choice');
    setCursor(photoUrl ? 1 : 0);
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

  const startRecording = async (target: RecordTarget) => {
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
            const accepted = target === 'name' ? normalizeTranscribedHeroName(heard) : heard;
            if (!accepted) {
              setSttError(
                target === 'name'
                  ? "Spark didn't catch a name. Try speaking it again."
                  : "Spark didn't catch any details. Try speaking again.",
              );
              goToDetails(target === 'name' ? 0 : 2);
              shellInput.blip('error');
              return;
            }
            if (target === 'name') setHeroName(accepted.slice(0, 48));
            else setDetails(accepted.slice(0, 1200));
            goToDetails(target === 'name' ? 0 : 2);
            shellInput.blip('success');
          })
          .catch((error: Error) => {
            setSttError(error.message);
            goToDetails(target === 'name' ? 0 : 2);
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
          : 'Microphone unavailable — Spark can invent the details.',
      );
      goToDetails(target === 'name' ? 0 : 2);
      shellInput.blip('error');
    }
  };

  const generate = () => {
    if (submitting || !online) return;
    setSubmitting(true);
    const cleanHeroName = heroName.trim();
    const cleanDetails = details.trim();
    const resolvedArchetype = requestedArchetype ?? pickSurpriseArchetype();
    const resolvedChoice = choiceFor(resolvedArchetype);
    setRequestedArchetype(resolvedArchetype);
    const promptText = buildCreationPrompt({
      heroName: cleanHeroName,
      archetypeLabel: resolvedChoice.label,
      details: cleanDetails,
    });
    void api
      .createGame({
        promptText,
        sourceKind: 'voice',
        requestedArchetype: resolvedArchetype,
        ...(cleanHeroName ? { heroName: cleanHeroName } : {}),
        ...(cleanDetails ? { details: cleanDetails } : {}),
        ...(photoBlob ? { photo: photoBlob } : {}),
        idempotencyKey: idempotencyKey.current,
      })
      .then((result) => {
        shellInput.blip('success');
        props.go({
          name: 'generation',
          jobId: result.jobId,
          gameId: result.gameId,
          publicGame: result.publicGame,
        });
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
            setSttError('');
            setCursor((current) => (current + count - 1) % count);
            shellInput.blip('move');
            return true;
          }
          if ((horizontal && button === 'RIGHT') || (!horizontal && button === 'DOWN')) {
            setSttError('');
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
                clearPhoto();
                goToDetails();
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
                clearPhoto();
                setPhotoMode('camera');
              } else goToDetails();
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
                clearPhoto();
                goToDetails();
              }
            } else if (button === 'B') {
              shellInput.blip('back');
              setPhotoMode('choice');
              setCursor(0);
            }
          }
          return;
        }

        if (mode.step === 'archetype') {
          if (button === 'LEFT' || button === 'RIGHT') {
            setCursor((current) => {
              return button === 'LEFT'
                ? (current + ARCHETYPES.length - 1) % ARCHETYPES.length
                : (current + 1) % ARCHETYPES.length;
            });
            shellInput.blip('move');
          } else if (button === 'A') {
            shellInput.blip('select');
            const choice = ARCHETYPES[mode.cursor];
            if (choice) setRequestedArchetype(choice.id);
            goToDetails(1);
          } else if (button === 'B') {
            shellInput.blip('back');
            goToDetails(1);
          }
          return;
        }

        if (mode.entryMode === 'record') {
          if (button === 'A') stopMic();
          else if (button === 'B') {
            shellInput.blip('back');
            cancelRecording();
            goToDetails(mode.recordTarget === 'name' ? 0 : 2);
          }
          return;
        }

        if (mode.entryMode === 'transcribing') return;

        if (nav(4)) return;
        if (button === 'A') {
          shellInput.blip('select');
          if (mode.cursor === 0) {
            setEntryMode('record');
            setRecordTarget('name');
            void startRecording('name');
          } else if (mode.cursor === 1) {
            setSttError('');
            goToArchetype();
          } else if (mode.cursor === 2) {
            setEntryMode('record');
            setRecordTarget('details');
            void startRecording('details');
          } else if (online) {
            generate();
          } else {
            shellInput.blip('error');
          }
        } else if (button === 'B') {
          shellInput.blip('back');
          goToPhoto();
        } else if (button === 'X') {
          if (mode.cursor === 0 && heroName) {
            setHeroName('');
            setSttError('');
            shellInput.blip('back');
          } else if (mode.cursor === 1 && requestedArchetype) {
            setRequestedArchetype(null);
            setSttError('');
            shellInput.blip('back');
          } else if (mode.cursor === 2 && details) {
            setDetails('');
            setSttError('');
            shellInput.blip('back');
          } else if (mode.cursor === 3 && !online && isPi) {
            props.go({ name: 'settings', tab: 'wifi' });
          }
        }
      }),
    [
      countdown,
      details,
      heroName,
      isPi,
      online,
      photoBlob,
      photoUrl,
      requestedArchetype,
      submitting,
      props.go,
      props.settings,
    ],
  );

  const onDetailsStep = step !== 'photo';
  const stepChip = (
    <div class="wizard-steps">
      <span class={`step ${step === 'photo' ? 'on' : ''}`}>1 PHOTO</span>
      <span class="step-separator">/</span>
      <span class={`step ${onDetailsStep ? 'on' : ''}`}>2 GAME DETAILS</span>
    </div>
  );
  const recording = entryMode === 'record';
  const transcribing = entryMode === 'transcribing';
  const hasFocusedValue =
    (cursor === 0 && !!heroName) ||
    (cursor === 1 && !!requestedArchetype) ||
    (cursor === 2 && !!details);
  const detailHelp = sttError
    ? sttError
    : ([
        'Name your main character, or leave it to Spark.',
        'Choose how the game plays, or use Random for a varied surprise.',
        'Describe the story, enemies, or visual style you want.',
        online
          ? estimate?.busy
            ? 'Another game is generating. This one will wait in line.'
            : `Start building your game${estimate ? ` · ${estimate.label}` : ''}.`
          : 'Connect to WiFi before starting generation.',
      ][cursor] ?? '');

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

        {step === 'details' && entryMode === 'choice' && (
          <div class="game-details-stage">
            <div class="wizard-kicker">TELL SPARK WHAT MATTERS</div>
            <div class="game-details-grid">
              <div class={`focusable game-detail-row ${cursor === 0 ? 'focused' : ''}`}>
                <div class="game-detail-label">Hero Name</div>
                <div class={`game-detail-value one-line ${heroName ? '' : 'spark-decides'}`}>
                  {heroName || 'Spark decides'}
                </div>
              </div>
              <div class={`focusable game-detail-row ${cursor === 1 ? 'focused' : ''}`}>
                <div class="game-detail-label">Type</div>
                <div class={`game-detail-value one-line ${chosenArchetype ? '' : 'spark-decides'}`}>
                  {chosenArchetype?.label ?? 'Random'}
                </div>
              </div>
              <div class={`focusable game-detail-row details ${cursor === 2 ? 'focused' : ''}`}>
                <div class="game-detail-label">Details</div>
                <div class={`game-detail-value multi-line ${details ? '' : 'spark-decides'}`}>
                  {details || 'Spark decides'}
                </div>
              </div>
            </div>
            <div class={`game-details-help ${sttError ? 'error' : ''}`}>
              <Icon name={sttError ? 'warning' : 'sparkle'} size={19} />
              <span>{detailHelp}</span>
            </div>
            <div
              class={`focusable game-details-create ${cursor === 3 ? 'focused' : ''}`}
              style={!online ? 'opacity:0.45' : ''}
            >
              <span>
                <Icon name="sparkle" /> {submitting ? 'Starting…' : 'Create Game'}
              </span>
              <small>{online ? (estimate?.label ?? 'Checking cost…') : 'Offline'}</small>
            </div>
          </div>
        )}

        {step === 'details' && recording && (
          <div class="center-col">
            <div class="wizard-kicker">
              {recordTarget === 'name' ? 'HERO NAME' : 'GAME DETAILS'}
            </div>
            <div style="font-size:26px;color:var(--spark)">
              <Icon name="dot" /> Recording…
            </div>
            <div style="font-size:20px;color:var(--text-dim);max-width:700px;text-align:center">
              {recordTarget === 'name'
                ? 'Say just the character name.'
                : 'Describe the story, enemies, setting, or look you want.'}{' '}
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

        {step === 'details' && transcribing && (
          <div class="center-col">
            <span style="font-size:38px;color:var(--cyan)">
              <Icon name="sparkle" class="spin" />
            </span>
            <div style="font-size:22px">Listening back…</div>
            <div style="color:var(--text-dim);font-size:17px">
              The captured words will appear on Game Details.
            </div>
          </div>
        )}

        {step === 'archetype' && (
          <div class="archetype-stage">
            <div class="wizard-kicker">CHOOSE HOW IT PLAYS</div>
            <div class="archetype-carousel">
              <div
                class="archetype-track"
                style={{ transform: `translateX(calc(50% - ${cursor * 232 + 107}px))` }}
              >
                {ARCHETYPES.map((choice, index) => (
                  <div
                    key={choice.id}
                    class={`focusable archetype-card ${index === cursor ? 'focused selected' : ''}`}
                  >
                    <img class="archetype-cover" src={choice.previewImage} alt="" />
                    <div class="archetype-name">{choice.cardLabel ?? choice.label}</div>
                    <div class="archetype-feel">{choice.feel}</div>
                  </div>
                ))}
              </div>
            </div>
            <div class="archetype-description">{carouselChoice.description}</div>
            <div class="archetype-position">
              <Icon name="pixLeft" /> {cursor + 1} / {ARCHETYPES.length} <Icon name="pixRight" />
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
              : transcribing
                ? []
                : step === 'archetype'
                  ? [
                      ['←/→', 'Browse'],
                      ['A', 'Choose'],
                      ['B', 'Back'],
                    ]
                  : step === 'details' && entryMode === 'choice'
                    ? [
                        ['A', cursor === 3 ? 'Create' : 'Edit'],
                        ...(hasFocusedValue
                          ? ([['X', cursor === 1 ? 'Random' : 'Spark decides']] as [
                              string,
                              string,
                            ][])
                          : []),
                        ...(cursor === 3 && !online && isPi
                          ? ([['X', 'WiFi']] as [string, string][])
                          : []),
                        ['B', 'Photo'],
                      ]
                    : [
                        ['A', 'Select'],
                        ['B', 'Back'],
                      ]
        }
      />
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
