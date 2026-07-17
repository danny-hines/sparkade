// Dev-only Likeness Lab (http://localhost:5173/?dev=likeness): iterate on the
// player-likeness sprites in isolation — hand-set the detected FaceFeatures and
// see the drawn avatar update live, or drop a photo to run the real vision
// analysis and compare the avatar vs the photo bake. No game generation needed.
// DEV-gated in app.tsx so it is tree-shaken from production builds.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { decodeSprite, LIBRARY, makeTallHumanoidEntry } from '@sparkade/engine';
import { LIB_HEROES_PLATFORMER } from '@sparkade/shared';

interface Features {
  skinTone: string;
  hairColor: string;
  hairStyle: string;
  hairLength: string;
  hairTexture: string;
  hairPart: string;
  facialHairColor: string;
  headwearColor: string;
  glasses: boolean;
  glassesColor: string;
  headwear: boolean;
  headwearType: string;
  facialHair: string;
  faceShape: string;
  chin: string;
  noseSize: string;
  eyeSpacing: string;
  eyeShape: string;
  eyebrows: string;
  eyebrowShape: string;
  ears: string;
  topology?: {
    scalpHair?: { crown: boolean; temples: boolean; belowEars: boolean };
    headwear?: { crown: string; projection: string };
    glasses?: { frame: string; lensShape: string; lensTint: string };
    facialHair?: { upperLip: string; chin: string; jaw: string; cheeks: string };
  };
}

const ENUMS: Record<string, string[]> = {
  hairStyle: ['hidden', 'buzz', 'short', 'parted', 'curly', 'afro', 'horseshoe', 'long', 'ponytail'],
  hairLength: ['none', 'buzz', 'short', 'jaw', 'long', 'tied'],
  hairTexture: ['none', 'straight', 'wavy', 'curly', 'coily'],
  hairPart: ['none', 'left', 'center', 'right'],
  headwearType: ['cap', 'beanie', 'flatCap', 'beret', 'topHat', 'wideBrim', 'brim'],
  facialHair: ['none', 'stubble', 'mustache', 'goatee', 'beard'],
  faceShape: ['round', 'oval', 'square', 'long', 'heart'],
  chin: ['round', 'pointed', 'square', 'wide'],
  noseSize: ['small', 'medium', 'large'],
  eyeSpacing: ['close', 'average', 'wide'],
  eyeShape: ['round', 'almond', 'narrow'],
  eyebrows: ['thin', 'medium', 'thick'],
  eyebrowShape: ['straight', 'arched', 'angled'],
  ears: ['hidden', 'small', 'average', 'prominent'],
};

const DEFAULT: Features = {
  skinTone: '#c98f6b',
  hairColor: '#2a2320',
  hairStyle: 'short',
  hairLength: 'short',
  hairTexture: 'straight',
  hairPart: 'none',
  facialHairColor: '#4a3a2e',
  headwearColor: '#33445e',
  glasses: false,
  glassesColor: '#20202a',
  headwear: false,
  headwearType: 'cap',
  facialHair: 'none',
  faceShape: 'oval',
  chin: 'round',
  noseSize: 'medium',
  eyeSpacing: 'average',
  eyeShape: 'almond',
  eyebrows: 'medium',
  eyebrowShape: 'straight',
  ears: 'average',
};

type Sprites = {
  portrait: string;
  head16: string;
  head12: string;
  head12Side?: string;
  head12Back?: string;
  head16Side?: string;
  head16Back?: string;
};
type Heads = Record<string, string>; // size → data-uri
interface DirectPixels {
  identityCues: string[];
  palette: string[];
  sprites: Heads;
  validation: {
    repaired: boolean;
    errors: string[];
    opaqueBox: { x: number; y: number; width: number; height: number };
    coverage: number;
  };
  model: string;
  cached: boolean;
  usage: { input: number; output: number; cachedInput?: number };
}
interface PhotoHeads {
  features: Features;
  geometry: {
    headBox: { x: number; y: number; width: number; height: number };
    rows: { left: number; right: number }[];
    confidence: 'low' | 'medium' | 'high';
  };
  sprites: Heads;
  model: string;
  cached: boolean;
  usage: { input: number; output: number; cachedInput?: number };
}
interface GeneratedHeads {
  master: string;
  heads: Heads;
  model: string;
  cached: boolean;
}

// The candidate hero directions. `head` = head size in px; `body`/`legH`/`hx`
// define a rough placeholder body so the head-to-body proportion reads.
interface Proposal {
  key: string;
  label: string;
  desc: string;
  head: number;
  w: number;
  h: number;
  hx: number;
  body: { x: number; y: number; w: number; h: number };
  legH: number;
}
const PROPOSALS: Proposal[] = [
  {
    key: 'current',
    label: 'Legacy',
    desc: '12px head · old runtime',
    head: 12,
    w: 18,
    h: 24,
    hx: 3,
    body: { x: 5, y: 11, w: 8, h: 8 },
    legH: 5,
  },
  {
    key: 'mario',
    label: 'Mario-tall',
    desc: '16px head · 16×32 body',
    head: 16,
    w: 18,
    h: 34,
    hx: 1,
    body: { x: 4, y: 15, w: 10, h: 12 },
    legH: 7,
  },
  {
    key: 'chibi',
    label: 'Chibi big-head',
    desc: '24px head · compact body',
    head: 24,
    w: 26,
    h: 34,
    hx: 1,
    body: { x: 8, y: 22, w: 10, h: 8 },
    legH: 4,
  },
  {
    key: 'both',
    label: 'Both',
    desc: '28px head · full body',
    head: 28,
    w: 30,
    h: 46,
    hx: 1,
    body: { x: 9, y: 27, w: 12, h: 13 },
    legH: 6,
  },
];

/** Draws a proposal's head PNG on top of a placeholder body, at 5× pixel scale. */
function MockSprite(props: { src?: string; prop: Proposal }): ComponentChildren {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !props.src) return;
    const S = 5;
    const p = props.prop;
    const img = new Image();
    img.onload = () => {
      cv.width = p.w * S;
      cv.height = p.h * S;
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, cv.width, cv.height);
      const b = p.body;
      ctx.fillStyle = '#3a5a8a'; // torso
      ctx.fillRect(b.x * S, b.y * S, b.w * S, b.h * S);
      ctx.fillStyle = '#2f4a76'; // arms
      ctx.fillRect((b.x - 2) * S, (b.y + 1) * S, 2 * S, Math.round(b.h * 0.6) * S);
      ctx.fillRect((b.x + b.w) * S, (b.y + 1) * S, 2 * S, Math.round(b.h * 0.6) * S);
      ctx.fillStyle = '#28406a'; // legs
      ctx.fillRect((b.x + 1) * S, (b.y + b.h) * S, 3 * S, p.legH * S);
      ctx.fillRect((b.x + b.w - 4) * S, (b.y + b.h) * S, 3 * S, p.legH * S);
      ctx.drawImage(img, p.hx * S, 0, p.head * S, p.head * S);
    };
    img.src = props.src;
  }, [props.src, props.prop]);
  return <canvas ref={ref} class="lab-pixel" style="background:#141826;vertical-align:bottom" />;
}

const LAB_PALETTE = [
  '#000000',
  '#171c2c',
  '#29366f',
  '#3b5dc9',
  '#41a6f6',
  '#3a5a8a',
  '#5d7fb3',
  '#c98f6b',
  '#b13e53',
  '#ef7d57',
  '#ffcd75',
  '#a7f070',
  '#8f563b',
  '#f6d365',
  '#c7dcd0',
  '#f4f4f4',
];

/** Actual SpriteStore composition geometry, with the platformer 10x14 collider overlaid. */
function ActualHero(props: { src?: string; tall: boolean; heroId: string }): ComponentChildren {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !props.src) return;
    const source = LIBRARY[props.heroId] ?? LIBRARY['hero_squire']!;
    const entry = props.tall ? makeTallHumanoidEntry(source) : source;
    const frame = entry.frames[0]!;
    const slot = entry.headSlots?.[0];
    const img = new Image();
    img.onload = () => {
      const composed = decodeSprite(frame, LAB_PALETTE);
      const cctx = composed.getContext('2d')!;
      cctx.imageSmoothingEnabled = false;
      if (slot) {
        cctx.clearRect(slot.x, slot.y, slot.size, slot.size);
        cctx.drawImage(img, slot.x, slot.y, slot.size, slot.size);
        const overlay = entry.likenessOverlays?.[0];
        if (overlay) cctx.drawImage(decodeSprite(overlay, LAB_PALETTE), 0, 0);
      }

      const scale = 6;
      cv.width = frame.w * scale;
      cv.height = frame.h * scale;
      const ctx = cv.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(composed, 0, 0, cv.width, cv.height);

      // This box is gameplay geometry, not artwork. Its size and foot anchor
      // are identical in both candidates.
      ctx.strokeStyle = '#62f6a5';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(
        ((frame.w - 10) / 2) * scale + 0.5,
        (frame.h - 14) * scale + 0.5,
        10 * scale - 1,
        14 * scale - 1,
      );
    };
    img.src = props.src;
  }, [props.src, props.tall, props.heroId]);
  return <canvas ref={ref} class="lab-pixel" style="background:#141826;vertical-align:bottom" />;
}

function hasDirectionalSprites(s: Sprites | null): s is Sprites {
  return !!(s && (s.head12Side || s.head12Back || s.head16Side || s.head16Back));
}

/** Four-view turntable for checking the directional head glyphs in isolation. */
function DirectionalHeadStrip(props: { sprites: Sprites }): ComponentChildren {
  const s = props.sprites;
  const use16 = !!(s.head16Side || s.head16Back);
  const front = use16 ? s.head16 : s.head12;
  const side = use16 ? (s.head16Side ?? s.head16) : (s.head12Side ?? s.head12);
  const back = use16 ? (s.head16Back ?? s.head16) : (s.head12Back ?? s.head12);
  const views = [
    { label: 'Front', src: front, mirrored: false },
    { label: 'Right', src: side, mirrored: false },
    { label: 'Back', src: back, mirrored: false },
    { label: 'Left', src: side, mirrored: true },
  ];
  return (
    <div class="lab-directional-heads">
      <div class="lab-directional-kicker">Movement views · {use16 ? '16' : '12'}px</div>
      <div class="lab-directional-row">
        {views.map((view) => (
          <div class="lab-directional-cell" key={view.label}>
            <img
              class={`lab-pixel lab-directional-head${view.mirrored ? ' lab-directional-mirror' : ''}`}
              src={view.src}
              title={`${view.label}-facing deterministic head`}
            />
            <span>{view.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Composes one directional head over a real library frame for lab-only context. */
function DirectionalContextHero(props: {
  src: string;
  heroId: string;
  frameIndex: number;
  tall?: boolean;
  mirrored?: boolean;
  label: string;
}): ComponentChildren {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const source = LIBRARY[props.heroId] ?? LIBRARY['hero_wander']!;
    const entry = props.tall ? makeTallHumanoidEntry(source) : source;
    const frameIndex = Math.min(props.frameIndex, entry.frames.length - 1);
    const frame = entry.frames[frameIndex]!;
    const slot = entry.headSlots?.[frameIndex];
    const img = new Image();
    img.onload = () => {
      const composed = decodeSprite(frame, LAB_PALETTE);
      const composedCtx = composed.getContext('2d')!;
      composedCtx.imageSmoothingEnabled = false;
      if (slot) {
        composedCtx.clearRect(slot.x, slot.y, slot.size, slot.size);
        composedCtx.drawImage(img, slot.x, slot.y, slot.size, slot.size);
        const overlay = entry.likenessOverlays?.[frameIndex];
        if (overlay) composedCtx.drawImage(decodeSprite(overlay, LAB_PALETTE), 0, 0);
      }

      const scale = props.tall ? 4 : 6;
      cv.width = frame.w * scale;
      cv.height = frame.h * scale;
      const ctx = cv.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      if (props.mirrored) {
        ctx.translate(cv.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(composed, 0, 0, cv.width, cv.height);
    };
    img.src = props.src;
  }, [props.src, props.heroId, props.frameIndex, props.tall, props.mirrored]);
  return (
    <div class="lab-directional-context-cell">
      <canvas ref={ref} class="lab-pixel" />
      <span>{props.label}</span>
    </div>
  );
}

function DirectionalGameContext(props: {
  sprites: Sprites;
  platformerHeroId: string;
}): ComponentChildren {
  const s = props.sprites;
  const side12 = s.head12Side ?? s.head12;
  const back12 = s.head12Back ?? s.head12;
  const side16 = s.head16Side ?? s.head16;
  return (
    <div class="lab-compare lab-directional-context">
      <div class="lab-preview-title">Directional heads in game context</div>
      <div class="lab-note lab-directional-context-note">
        These are deterministic views from the same extracted features. Left mirrors right; no
        additional Muse call is made.
      </div>
      <div class="lab-directional-context-groups">
        <div>
          <div class="lab-directional-kicker">Platformer · movement-facing</div>
          <div class="lab-directional-context-row">
            <DirectionalContextHero
              src={side16}
              heroId={props.platformerHeroId}
              frameIndex={0}
              tall
              label="Right"
            />
            <DirectionalContextHero
              src={side16}
              heroId={props.platformerHeroId}
              frameIndex={0}
              tall
              mirrored
              label="Left"
            />
          </div>
        </div>
        <div>
          <div class="lab-directional-kicker">Adventure · four directions</div>
          <div class="lab-directional-context-row">
            <DirectionalContextHero
              src={s.head12}
              heroId="hero_wander"
              frameIndex={0}
              label="Down"
            />
            <DirectionalContextHero
              src={side12}
              heroId="hero_wander"
              frameIndex={4}
              label="Right"
            />
            <DirectionalContextHero src={back12} heroId="hero_wander" frameIndex={2} label="Up" />
            <DirectionalContextHero
              src={side12}
              heroId="hero_wander"
              frameIndex={4}
              mirrored
              label="Left"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function pick<T>(a: T[]): T {
  return a[Math.floor(Math.random() * a.length)]!;
}
function randHex(): string {
  return (
    '#' +
    Math.floor(Math.random() * 0xffffff)
      .toString(16)
      .padStart(6, '0')
  );
}

export function LikenessLabScreen(): ComponentChildren {
  const [feat, setFeat] = useState<Features>(DEFAULT);
  const [bald, setBald] = useState(false);
  const [avatar, setAvatar] = useState<Sprites | null>(null);
  const [bake, setBake] = useState<Sprites | null>(null);
  const [heads, setHeads] = useState<Heads | null>(null);
  const [detailAt, setDetailAt] = useState(16); // preview: unlock fine features at ≥16px
  const [heroId, setHeroId] = useState('hero_squire');
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [gen, setGen] = useState<string | null>(null);
  const [direct, setDirect] = useState<DirectPixels | null>(null);
  const [photoHead, setPhotoHead] = useState<PhotoHeads | null>(null);
  const [generatedHeads, setGeneratedHeads] = useState<GeneratedHeads | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [directGenerating, setDirectGenerating] = useState(false);
  const [photoHeadGenerating, setPhotoHeadGenerating] = useState(false);
  const [headsGenerating, setHeadsGenerating] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Paid image/model calls can finish after the user has already selected a
  // different photo. Tie every response to the photo generation it started
  // with so person A can never appear beneath person B's source image.
  const photoVersionRef = useRef(0);

  useEffect(() => {
    document.documentElement.classList.add('dev-gallery');
    document.body.classList.add('dev-gallery');
    return () => {
      document.documentElement.classList.remove('dev-gallery');
      document.body.classList.remove('dev-gallery');
    };
  }, []);

  // The FaceFeatures actually sent (respecting "bald" and the accessory toggles).
  const sent = useMemo(
    () => ({
      ...feat,
      hairColor: bald ? 'none' : feat.hairColor,
      hairStyle: bald ? 'bald' : feat.hairStyle,
      hairLength: bald ? 'none' : feat.hairLength,
      hairTexture: bald ? 'none' : feat.hairTexture,
      hairPart: bald ? 'none' : feat.hairPart,
      facialHairColor: feat.facialHair === 'none' ? 'none' : feat.facialHairColor,
      glassesColor: feat.glasses ? feat.glassesColor : 'none',
      headwearColor: feat.headwear ? feat.headwearColor : 'none',
      headwearType: feat.headwear ? feat.headwearType : 'none',
    }),
    [feat, bald],
  );
  const sentKey = JSON.stringify(sent);
  const sentKeyRef = useRef(sentKey);
  sentKeyRef.current = sentKey;
  const observedSummary = useMemo(() => {
    const cues: string[] = [];
    if (sent.headwear)
      cues.push(sent.headwearType === 'cap' ? 'panelled baseball cap' : sent.headwearType);
    const topology = sent.topology;
    if (topology?.scalpHair) {
      const visible =
        topology.scalpHair.crown || topology.scalpHair.temples || topology.scalpHair.belowEars;
      cues.push(visible ? `${sent.hairLength} ${sent.hairTexture} hair` : 'no visible scalp hair');
    } else if (sent.hairLength === 'none' || sent.hairStyle === 'hidden') {
      cues.push('no visible scalp hair');
    } else {
      cues.push(`${sent.hairLength} ${sent.hairTexture} hair`);
    }
    const facial = topology?.facialHair;
    if (facial?.upperLip === 'solid') cues.push('defined moustache');
    else if (facial?.upperLip === 'stubble') cues.push('upper-lip stubble');
    const stubbleRegions = facial
      ? (['chin', 'jaw', 'cheeks'] as const).filter((region) => facial[region] === 'stubble')
      : [];
    if (stubbleRegions.length) cues.push(`${stubbleRegions.join('/')} stubble`);
    else if (!facial && sent.facialHair !== 'none') cues.push(sent.facialHair);
    if (sent.glasses) cues.push('glasses');
    return cues.join(' · ');
  }, [sentKey]);

  // Paid feature-dependent previews describe the exact control snapshot that
  // was submitted. Clear them when controls change so an old result is never
  // displayed under a new set of traits.
  useEffect(() => {
    setGen(null);
    setPhotoHead(null);
    setGeneratedHeads(null);
    setGenerating(false);
    setPhotoHeadGenerating(false);
    setHeadsGenerating(false);
  }, [sentKey]);

  // Re-render the drawn avatar (debounced) whenever the features change.
  useEffect(() => {
    const id = setTimeout(() => {
      void fetch('/api/dev/likeness/render', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ features: sent, detailAt }),
      })
        .then((r) => r.json())
        .then((r: { avatar?: Sprites; heads?: Heads; error?: string }) => {
          if (r.avatar) setAvatar(r.avatar);
          if (r.heads) setHeads(r.heads);
          if (!r.avatar) setErr(r.error ?? 'render failed');
        })
        .catch((e: Error) => setErr(e.message));
    }, 120);
    return () => clearTimeout(id);
  }, [sent, detailAt]);

  const analyze = (file: File): void => {
    const photoVersion = ++photoVersionRef.current;
    setPhotoFile(file);
    setGen(null);
    setDirect(null);
    setPhotoHead(null);
    setGeneratedHeads(null);
    setGenerating(false);
    setDirectGenerating(false);
    setPhotoHeadGenerating(false);
    setHeadsGenerating(false);
    setAnalyzing(true);
    setErr('');
    const form = new FormData();
    form.append('photo', file);
    void fetch('/api/dev/likeness/analyze', { method: 'POST', body: form })
      .then((r) => r.json())
      .then(
        (r: {
          features?: Features;
          avatar?: Sprites;
          bake?: Sprites;
          heads?: Heads;
          photo?: string;
          error?: string;
        }) => {
          if (photoVersion !== photoVersionRef.current) return;
          setAnalyzing(false);
          if (r.error) return setErr(r.error);
          if (r.heads) setHeads(r.heads);
          if (r.features) {
            setBald(r.features.hairStyle === 'bald');
            setFeat({
              ...DEFAULT,
              ...r.features,
              hairColor: r.features.hairColor === 'none' ? DEFAULT.hairColor : r.features.hairColor,
              facialHairColor:
                r.features.facialHairColor === 'none'
                  ? DEFAULT.facialHairColor
                  : r.features.facialHairColor,
              headwearColor:
                r.features.headwearColor === 'none'
                  ? DEFAULT.headwearColor
                  : r.features.headwearColor,
              headwearType:
                r.features.headwearType === 'none' ? DEFAULT.headwearType : r.features.headwearType,
            });
          }
          if (r.avatar) setAvatar(r.avatar);
          setBake(r.bake ?? null);
          setPhoto(r.photo ?? null);
        },
      )
      .catch((e: Error) => {
        if (photoVersion !== photoVersionRef.current) return;
        setAnalyzing(false);
        setErr(e.message);
      });
  };

  // Webcam capture ("take a photo") → same analyze flow.
  const startCamera = async (): Promise<void> => {
    setErr('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 640 }, facingMode: 'user' },
      });
      streamRef.current = stream;
      setCamOn(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch (e) {
      setErr('camera unavailable: ' + (e instanceof Error ? e.message : String(e)));
    }
  };
  const stopCamera = (): void => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamOn(false);
  };
  const snap = (): void => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const s = Math.min(v.videoWidth, v.videoHeight);
    const c = document.createElement('canvas');
    c.width = s;
    c.height = s;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, (v.videoWidth - s) / 2, (v.videoHeight - s) / 2, s, s, 0, 0, s, s);
    c.toBlob(
      (blob) => {
        if (!blob) return;
        stopCamera();
        analyze(new File([blob], 'snap.jpg', { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.9,
    );
  };
  useEffect(() => () => stopCamera(), []);

  // Experimental: image-model portrait from the current photo + features.
  const generate = (): void => {
    if (!photoFile) return;
    const photoVersion = photoVersionRef.current;
    const featureSnapshot = sentKeyRef.current;
    setGenerating(true);
    setErr('');
    const form = new FormData();
    form.append('photo', photoFile);
    form.append('features', featureSnapshot);
    void fetch('/api/dev/likeness/generate', { method: 'POST', body: form })
      .then((r) => r.json())
      .then((r: { portrait?: string; error?: string }) => {
        if (photoVersion !== photoVersionRef.current || featureSnapshot !== sentKeyRef.current)
          return;
        setGenerating(false);
        if (r.error) setErr(r.error);
        else if (r.portrait) setGen(r.portrait);
      })
      .catch((e: Error) => {
        if (photoVersion !== photoVersionRef.current || featureSnapshot !== sentKeyRef.current)
          return;
        setGenerating(false);
        setErr(e.message);
      });
  };

  // Muse annotates a tight head/face box and facial landmarks; local code
  // segments and pixelizes the real photo. This avoids asking a language model
  // to spatially author thousands of colored pixels or contour rows.
  const generatePhotoHead = (fresh = false): void => {
    if (!photoFile) return;
    const photoVersion = photoVersionRef.current;
    const featureSnapshot = sentKeyRef.current;
    setPhotoHeadGenerating(true);
    setErr('');
    const form = new FormData();
    form.append('photo', photoFile);
    form.append('features', featureSnapshot);
    void fetch(`/api/dev/likeness/photo-head${fresh ? '?fresh=1' : ''}`, {
      method: 'POST',
      body: form,
    })
      .then((r) => r.json())
      .then((r: PhotoHeads & { error?: string }) => {
        if (photoVersion !== photoVersionRef.current || featureSnapshot !== sentKeyRef.current)
          return;
        setPhotoHeadGenerating(false);
        if (r.error) setErr(r.error);
        else if (r.sprites) setPhotoHead(r);
      })
      .catch((e: Error) => {
        if (photoVersion !== photoVersionRef.current || featureSnapshot !== sentKeyRef.current)
          return;
        setPhotoHeadGenerating(false);
        setErr(e.message);
      });
  };

  // Muse sees the photo plus the analyzed topology and authors one semantic
  // 28px master. Smaller candidates are role-aware local reductions.
  const generateDirectPixels = (fresh = false): void => {
    if (!photoFile) return;
    const photoVersion = photoVersionRef.current;
    const featureSnapshot = sentKeyRef.current;
    setDirectGenerating(true);
    setErr('');
    const form = new FormData();
    form.append('photo', photoFile);
    form.append('features', featureSnapshot);
    void fetch(`/api/dev/likeness/pixels${fresh ? '?fresh=1' : ''}`, { method: 'POST', body: form })
      .then((r) => r.json())
      .then((r: DirectPixels & { error?: string }) => {
        if (photoVersion !== photoVersionRef.current || featureSnapshot !== sentKeyRef.current)
          return;
        setDirectGenerating(false);
        if (r.error) setErr(r.error);
        else if (r.sprites) setDirect(r);
      })
      .catch((e: Error) => {
        if (photoVersion !== photoVersionRef.current || featureSnapshot !== sentKeyRef.current)
          return;
        setDirectGenerating(false);
        setErr(e.message);
      });
  };

  const generateImageHeads = (fresh = false): void => {
    if (!photoFile) return;
    const photoVersion = photoVersionRef.current;
    const featureSnapshot = sentKeyRef.current;
    setHeadsGenerating(true);
    setErr('');
    const form = new FormData();
    form.append('photo', photoFile);
    form.append('features', featureSnapshot);
    void fetch(`/api/dev/likeness/generated-heads${fresh ? '?fresh=1' : ''}`, {
      method: 'POST',
      body: form,
    })
      .then((r) => r.json())
      .then((r: GeneratedHeads & { error?: string }) => {
        if (photoVersion !== photoVersionRef.current || featureSnapshot !== sentKeyRef.current)
          return;
        setHeadsGenerating(false);
        if (r.error) setErr(r.error);
        else if (r.heads) setGeneratedHeads(r);
      })
      .catch((e: Error) => {
        if (photoVersion !== photoVersionRef.current || featureSnapshot !== sentKeyRef.current)
          return;
        setHeadsGenerating(false);
        setErr(e.message);
      });
  };

  const set = (k: keyof Features, v: string | boolean): void =>
    setFeat((f) => {
      const topologyBranch = ['hairStyle', 'hairLength', 'hairTexture', 'hairPart'].includes(k)
        ? 'scalpHair'
        : ['headwear', 'headwearType'].includes(k)
          ? 'headwear'
          : k === 'glasses'
            ? 'glasses'
            : k === 'facialHair'
              ? 'facialHair'
              : undefined;
      if (!topologyBranch || !f.topology) return { ...f, [k]: v };
      const topology = { ...f.topology };
      delete topology[topologyBranch];
      return { ...f, [k]: v, topology: Object.keys(topology).length ? topology : undefined };
    });
  const randomize = (): void => {
    setBald(Math.random() < 0.25);
    setFeat({
      skinTone: pick(['#f0d0b0', '#e6b892', '#c98f6b', '#a8724e', '#8d5a34', '#6b4226', '#4a2f1c']),
      hairColor: pick([
        '#2a2320',
        '#141210',
        '#5a3a22',
        '#8a5a2a',
        '#c98a3a',
        '#d8b25a',
        '#8a3b1e',
        '#9a9a9a',
      ]),
      // "hidden" is an analysis result caused by occlusion, not a useful
      // random bare-headed hairstyle.
      hairStyle: pick(ENUMS.hairStyle!.filter((style) => style !== 'hidden')),
      hairLength: pick(ENUMS.hairLength!.filter((length) => length !== 'none')),
      hairTexture: pick(ENUMS.hairTexture!.filter((texture) => texture !== 'none')),
      hairPart: pick(ENUMS.hairPart!),
      facialHairColor: randHex(),
      headwearColor: randHex(),
      glasses: Math.random() < 0.4,
      glassesColor: randHex(),
      headwear: Math.random() < 0.3,
      headwearType: pick(ENUMS.headwearType!),
      facialHair: pick(ENUMS.facialHair!),
      faceShape: pick(ENUMS.faceShape!),
      chin: pick(ENUMS.chin!),
      noseSize: pick(ENUMS.noseSize!),
      eyeSpacing: pick(ENUMS.eyeSpacing!),
      eyeShape: pick(ENUMS.eyeShape!),
      eyebrows: pick(ENUMS.eyebrows!),
      eyebrowShape: pick(ENUMS.eyebrowShape!),
      ears: pick(ENUMS.ears!),
      topology: undefined,
    });
    setBake(null);
    setPhoto(null);
  };
  const resetLab = (): void => {
    photoVersionRef.current++;
    setFeat(DEFAULT);
    setBald(false);
    setBake(null);
    setPhoto(null);
    setPhotoFile(null);
    setGen(null);
    setDirect(null);
    setPhotoHead(null);
    setGeneratedHeads(null);
    setAnalyzing(false);
    setGenerating(false);
    setDirectGenerating(false);
    setPhotoHeadGenerating(false);
    setHeadsGenerating(false);
    setErr('');
  };

  const swatch = (label: string, k: keyof Features, disabled = false): ComponentChildren => (
    <label class="lab-row" style={disabled ? 'opacity:0.4' : ''}>
      <span>{label}</span>
      <input
        type="color"
        value={feat[k] as string}
        disabled={disabled}
        onInput={(e) => set(k, (e.target as HTMLInputElement).value)}
      />
    </label>
  );
  const dropdown = (label: string, k: keyof Features): ComponentChildren => (
    <label class="lab-row">
      <span>{label}</span>
      <select
        value={feat[k] as string}
        onChange={(e) => set(k, (e.target as HTMLSelectElement).value)}
      >
        {ENUMS[k]!.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
  const check = (label: string, k: keyof Features): ComponentChildren => (
    <label class="lab-row">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={feat[k] as boolean}
        onChange={(e) => set(k, (e.target as HTMLInputElement).checked)}
      />
    </label>
  );

  const spriteBlock = (title: string, s: Sprites | null, note?: string): ComponentChildren => (
    <div class="lab-preview">
      <div class="lab-preview-title">{title}</div>
      {s ? (
        <>
          <img class="lab-pixel" src={s.portrait} style="width:220px;height:220px" />
          <div style="display:flex;gap:14px;align-items:flex-end;margin-top:8px">
            <img
              class="lab-pixel"
              src={s.head16}
              style="width:64px;height:64px"
              title="head16 (in-game)"
            />
            <img
              class="lab-pixel"
              src={s.head12}
              style="width:48px;height:48px"
              title="head12 (in-game)"
            />
          </div>
          {hasDirectionalSprites(s) && <DirectionalHeadStrip sprites={s} />}
        </>
      ) : (
        <div class="lab-empty">—</div>
      )}
      {note && <div class="lab-note">{note}</div>}
    </div>
  );

  return (
    <div class="lab-page">
      <div class="lab-header">
        <h1>Likeness Lab</h1>
        <span class="lab-sub">dev · Muse features → deterministic game avatar</span>
        <a href="/?dev=assets" class="lab-link">
          → asset gallery
        </a>
      </div>
      {err && <div class="lab-err">{err}</div>}

      <div class="lab-body">
        <div class="lab-controls">
          <div class="lab-actions">
            {camOn ? (
              <>
                <button onClick={snap}>📸 Snap</button>
                <button onClick={stopCamera}>Cancel camera</button>
              </>
            ) : (
              <button onClick={() => void startCamera()}>
                {analyzing ? 'Analyzing…' : '📷 Take a photo'}
              </button>
            )}
            <button onClick={() => fileRef.current?.click()}>Drop / pick a photo</button>
            <button onClick={randomize}>Randomize</button>
            <button onClick={resetLab}>Reset</button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style="display:none"
              onChange={(e) => {
                const f = (e.target as HTMLInputElement).files?.[0];
                if (f) analyze(f);
              }}
            />
          </div>
          {photoFile && (
            <details class="lab-experiments">
              <summary>Archived / alternate render experiments</summary>
              <div class="lab-actions lab-experiment-actions">
                <button
                  disabled={photoHeadGenerating || analyzing}
                  onClick={() => generatePhotoHead()}
                >
                  {photoHeadGenerating ? 'Muse tracing head…' : 'Muse photo-derived head'}
                </button>
                <button
                  disabled={directGenerating || analyzing}
                  onClick={() => generateDirectPixels()}
                >
                  {directGenerating ? 'Muse drawing pixels…' : 'Muse-authored game sprite'}
                </button>
                <button onClick={generate}>
                  {generating ? 'Painting…' : 'Temporary image portrait fallback'}
                </button>
                <button
                  disabled={headsGenerating || analyzing}
                  onClick={() => generateImageHeads()}
                >
                  {headsGenerating ? 'Image model painting head…' : 'Temporary image head fallback'}
                </button>
              </div>
            </details>
          )}
          <video
            ref={videoRef}
            autoplay
            muted
            playsinline
            style={`width:220px;border-radius:8px;margin-top:8px;${camOn ? '' : 'display:none'}`}
          />

          <div class="lab-group">Colours</div>
          {swatch('Skin', 'skinTone')}
          <label class="lab-row">
            <span>Bald</span>
            <input
              type="checkbox"
              checked={bald}
              onChange={(e) => {
                const next = (e.target as HTMLInputElement).checked;
                setBald(next);
                if (!next && feat.hairStyle === 'bald') {
                  setFeat((current) => ({
                    ...current,
                    hairStyle: 'short',
                    hairLength: 'short',
                    hairTexture: 'straight',
                    hairPart: 'none',
                    topology: undefined,
                  }));
                }
              }}
            />
          </label>
          {swatch('Hair', 'hairColor', bald)}
          {!bald && dropdown('Hair silhouette', 'hairStyle')}
          {!bald && dropdown('Hair length', 'hairLength')}
          {!bald && dropdown('Hair texture', 'hairTexture')}
          {!bald && dropdown('Hair part', 'hairPart')}
          {dropdown('Facial hair', 'facialHair')}
          {swatch('Beard colour', 'facialHairColor', feat.facialHair === 'none')}

          <div class="lab-group">Accessories</div>
          {check('Glasses', 'glasses')}
          {swatch('Frame colour', 'glassesColor', !feat.glasses)}
          {check('Headwear', 'headwear')}
          {feat.headwear && dropdown('Hat type', 'headwearType')}
          {swatch('Headwear colour', 'headwearColor', !feat.headwear)}

          <div class="lab-group">Structure</div>
          {dropdown('Face shape', 'faceShape')}
          {dropdown('Chin', 'chin')}
          {dropdown('Nose size', 'noseSize')}
          {dropdown('Eye spacing', 'eyeSpacing')}
          {dropdown('Eye shape', 'eyeShape')}
          {dropdown('Eyebrows', 'eyebrows')}
          {dropdown('Eyebrow shape', 'eyebrowShape')}
          {dropdown('Ears', 'ears')}
        </div>

        <div class="lab-previews">
          {spriteBlock(
            'Feature-drawn avatar · primary',
            avatar,
            observedSummary || 'live from the extracted features',
          )}
          {spriteBlock(
            'Photo bake',
            bake,
            bake ? 'from the analyzed photo' : 'analyze a photo to compare',
          )}
          <div class="lab-preview">
            <div class="lab-preview-title">Source photo</div>
            {photo ? (
              <img
                src={photo}
                style="width:220px;height:220px;object-fit:cover;border-radius:8px"
              />
            ) : (
              <div class="lab-empty">—</div>
            )}
          </div>
          {(gen || generating) && (
            <div class="lab-preview">
              <div class="lab-preview-title">Generated portrait</div>
              {gen ? (
                <img class="lab-pixel" src={gen} style="width:220px;height:220px" />
              ) : (
                <div class="lab-empty">painting…</div>
              )}
              <div class="lab-note">experimental image-model portrait (story card only)</div>
            </div>
          )}
        </div>
      </div>

      {hasDirectionalSprites(avatar) && (
        <DirectionalGameContext sprites={avatar} platformerHeroId={heroId} />
      )}

      {(photoHead || photoHeadGenerating) && (
        <div class="lab-compare">
          <div class="lab-compare-head">
            <div>
              <div class="lab-preview-title">
                Muse-guided source pixels — measured boxes + landmarks
              </div>
              <div class="lab-note">
                {photoHead
                  ? `${photoHead.model} · ${photoHead.geometry.confidence} geometry confidence · ${photoHead.cached ? 'cache hit' : `${photoHead.usage.input} input / ${photoHead.usage.output} output tokens`}`
                  : 'Muse is locating the real head contour; local code will pixelize the source…'}
              </div>
            </div>
            {photoHead && (
              <button disabled={photoHeadGenerating} onClick={() => generatePhotoHead(true)}>
                Refresh geometry (paid)
              </button>
            )}
          </div>
          {photoHead && (
            <>
              <div class="lab-note" style="margin:8px 0 14px">
                Muse supplies visual geometry and traits; every color pixel comes from the real
                photo. 24/28px are the current likeness candidates.
              </div>
              <div style="display:flex;gap:24px;align-items:flex-end;flex-wrap:wrap">
                {['16', '20', '24', '28'].map((size) => (
                  <div key={size} style="text-align:center">
                    <img
                      class="lab-pixel"
                      src={photoHead.sprites[size]}
                      style="width:140px;height:140px"
                    />
                    <div class="lab-note">{size}px Muse-guided</div>
                    <img
                      class="lab-pixel"
                      src={photoHead.sprites[size]}
                      style={`width:${Number(size) * 3}px;height:${Number(size) * 3}px;margin-top:6px`}
                      title="≈ relative in-game size"
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {(generatedHeads || headsGenerating) && (
        <div class="lab-compare">
          <div class="lab-compare-head">
            <div>
              <div class="lab-preview-title">
                Temporary image-model fallback → local native reductions
              </div>
              <div class="lab-note">
                {generatedHeads
                  ? `${generatedHeads.model} · ${generatedHeads.cached ? 'cache hit' : 'new image generation'}`
                  : 'Generating one isolated identity-preserving head master…'}
              </div>
            </div>
            {generatedHeads && (
              <button disabled={headsGenerating} onClick={() => generateImageHeads(true)}>
                Refresh candidate (paid)
              </button>
            )}
          </div>
          {generatedHeads && (
            <div style="display:flex;gap:24px;align-items:flex-end;flex-wrap:wrap;margin-top:14px">
              <div style="text-align:center">
                <img
                  class="lab-pixel"
                  src={generatedHeads.master}
                  style="width:140px;height:140px"
                />
                <div class="lab-note">transparent master</div>
              </div>
              {['16', '20', '24', '28'].map((size) => (
                <div key={size} style="text-align:center">
                  <img
                    class="lab-pixel"
                    src={generatedHeads.heads[size]}
                    style="width:140px;height:140px"
                  />
                  <div class="lab-note">{size}px generated</div>
                  <img
                    class="lab-pixel"
                    src={generatedHeads.heads[size]}
                    style={`width:${Number(size) * 3}px;height:${Number(size) * 3}px;margin-top:6px`}
                    title="≈ relative in-game size"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {(direct || directGenerating) && (
        <div class="lab-compare">
          <div class="lab-compare-head">
            <div>
              <div class="lab-preview-title">
                Archived experiment — Muse-authored semantic 28px master
              </div>
              <div class="lab-note">
                {direct
                  ? `${direct.model} · ${direct.cached ? 'cache hit' : `${direct.usage.input} input / ${direct.usage.output} output tokens`}`
                  : 'Muse is authoring one game-style master against fixed palette roles (one call, up to 100 seconds)…'}
              </div>
            </div>
            {direct && (
              <button disabled={directGenerating} onClick={() => generateDirectPixels(true)}>
                Refresh candidate (paid)
              </button>
            )}
          </div>
          {direct && (
            <>
              <div class="lab-note" style="margin:8px 0 14px">
                Hard cues: {direct.identityCues.join(' · ')}
              </div>
              <div
                class="lab-note"
                style={`margin:0 0 14px;color:${direct.validation.errors.length ? '#f88' : '#8ec'}`}
              >
                {direct.validation.errors.length
                  ? `Validator still flags: ${direct.validation.errors.join(' · ')}`
                  : `Validator passed · ${direct.validation.opaqueBox.width}×${direct.validation.opaqueBox.height}px silhouette · ${Math.round(direct.validation.coverage * 100)}% coverage`}
              </div>
              <div class="lab-note" style="margin:0 0 14px">
                Muse authors the 28px design once; 24/20/16 preserve its semantic feature pixels
                during local reduction. Validator warnings never trigger a hidden second paid call.
              </div>
              <div style="display:flex;gap:24px;align-items:flex-end;flex-wrap:wrap">
                {['16', '20', '24', '28'].map((size) => (
                  <div key={size} style="text-align:center">
                    <img
                      class="lab-pixel"
                      src={direct.sprites[size]}
                      style="width:140px;height:140px"
                    />
                    <div class="lab-note">
                      {size}px {size === '28' ? 'Muse master' : 'same design'}
                    </div>
                    <img
                      class="lab-pixel"
                      src={direct.sprites[size]}
                      style={`width:${Number(size) * 3}px;height:${Number(size) * 3}px;margin-top:6px`}
                      title="≈ relative in-game size"
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {heads && (
        <div class="lab-compare">
          <div class="lab-compare-head">
            <div class="lab-preview-title">
              Hero-size comparison — the same face at each candidate in-game size
            </div>
            <label class="lab-row" style="width:auto;margin:0">
              <span>Unlock fine features ≥</span>
              <select
                value={String(detailAt)}
                onChange={(e) => setDetailAt(Number((e.target as HTMLSelectElement).value))}
              >
                <option value="12">12px</option>
                <option value="16">16px</option>
                <option value="20">20px</option>
                <option value="32">32px (portrait baseline)</option>
              </select>
            </label>
          </div>
          <div class="lab-note" style="margin-bottom:12px">
            Top row = same display size (readability). Bottom row = true relative size (how much
            bigger the head gets).
          </div>
          <div style="display:flex;gap:20px;align-items:flex-end;flex-wrap:wrap;margin-bottom:26px">
            {['12', '16', '20', '24', '28', '32', '48'].map((s) =>
              heads[s] ? (
                <div key={s} style="text-align:center">
                  <img class="lab-pixel" src={heads[s]} style="width:108px;height:108px" />
                  <div class="lab-note">
                    {s}px{s === '12' ? ' · legacy' : ''}
                  </div>
                  <img
                    class="lab-pixel"
                    src={heads[s]}
                    style={`width:${Number(s) * 3}px;height:${Number(s) * 3}px`}
                    title="≈ relative in-game size"
                  />
                </div>
              ) : null,
            )}
          </div>
          <div class="lab-preview-title">
            Sprite proportion — head on a placeholder body (per direction)
          </div>
          <div style="display:flex;gap:34px;align-items:flex-end;flex-wrap:wrap;margin-top:12px">
            {PROPOSALS.map((p) => (
              <div key={p.key} style="text-align:center">
                <MockSprite src={heads[String(p.head)]} prop={p} />
                <div class="lab-note" style="font-weight:bold;color:#8ec;margin-top:6px">
                  {p.label}
                </div>
                <div class="lab-note">{p.desc}</div>
              </div>
            ))}
          </div>
          <div class="lab-compare-head" style="margin-top:28px">
            <div class="lab-preview-title">
              Real engine compositor — same authored hero, same gameplay collider
            </div>
            <label class="lab-row" style="width:auto;margin:0">
              <span>Hero body</span>
              <select
                value={heroId}
                onChange={(e) => setHeroId((e.target as HTMLSelectElement).value)}
              >
                {LIB_HEROES_PLATFORMER.map((id) => (
                  <option value={id} key={id}>
                    {id.replace('hero_', '')}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div class="lab-note" style="margin:6px 0 12px">
            Dashed green = the unchanged 10x14 platformer collision box. Artwork can extend above it
            without changing level reachability.
          </div>
          <div style="display:flex;gap:48px;align-items:flex-end;flex-wrap:wrap">
            <div style="text-align:center">
              <ActualHero src={avatar?.head12} tall={false} heroId={heroId} />
              <div class="lab-note" style="font-weight:bold;color:#8ec;margin-top:6px">
                Legacy likeness
              </div>
              <div class="lab-note">16x16 art · 12x12 head</div>
            </div>
            <div style="text-align:center">
              <ActualHero src={avatar?.head16} tall heroId={heroId} />
              <div class="lab-note" style="font-weight:bold;color:#8ec;margin-top:6px">
                Tall likeness · enabled
              </div>
              <div class="lab-note">16x32 art · 16x16 head</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
