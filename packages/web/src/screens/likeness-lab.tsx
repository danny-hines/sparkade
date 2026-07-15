// Dev-only Likeness Lab (http://localhost:5173/?dev=likeness): iterate on the
// player-likeness sprites in isolation — hand-set the detected FaceFeatures and
// see the drawn avatar update live, or drop a photo to run the real vision
// analysis and compare the avatar vs the photo bake. No game generation needed.
// DEV-gated in app.tsx so it is tree-shaken from production builds.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

interface Features {
  skinTone: string;
  hairColor: string;
  facialHairColor: string;
  headwearColor: string;
  glasses: boolean;
  headwear: boolean;
  facialHair: string;
  faceShape: string;
  chin: string;
  noseSize: string;
  eyeSpacing: string;
  eyeShape: string;
  eyebrows: string;
  eyebrowShape: string;
  ears: string;
}

const ENUMS: Record<string, string[]> = {
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
  facialHairColor: '#4a3a2e',
  headwearColor: '#33445e',
  glasses: false,
  headwear: false,
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

type Sprites = { portrait: string; head16: string; head12: string };
type Heads = Record<string, string>; // size → data-uri

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
  { key: 'current', label: 'Current', desc: '12px head · ships today', head: 12, w: 18, h: 24, hx: 3, body: { x: 5, y: 11, w: 8, h: 8 }, legH: 5 },
  { key: 'mario', label: 'Mario-tall', desc: '16px head · 16×32 body', head: 16, w: 18, h: 34, hx: 1, body: { x: 4, y: 15, w: 10, h: 12 }, legH: 7 },
  { key: 'chibi', label: 'Chibi big-head', desc: '24px head · compact body', head: 24, w: 26, h: 34, hx: 1, body: { x: 8, y: 22, w: 10, h: 8 }, legH: 4 },
  { key: 'both', label: 'Both', desc: '28px head · full body', head: 28, w: 30, h: 46, hx: 1, body: { x: 9, y: 27, w: 12, h: 13 }, legH: 6 },
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

function pick<T>(a: T[]): T {
  return a[Math.floor(Math.random() * a.length)]!;
}
function randHex(): string {
  return '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
}

export function LikenessLabScreen(): ComponentChildren {
  const [feat, setFeat] = useState<Features>(DEFAULT);
  const [bald, setBald] = useState(false);
  const [avatar, setAvatar] = useState<Sprites | null>(null);
  const [bake, setBake] = useState<Sprites | null>(null);
  const [heads, setHeads] = useState<Heads | null>(null);
  const [detailAt, setDetailAt] = useState(16); // preview: unlock fine features at ≥16px
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [gen, setGen] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

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
      facialHairColor: feat.facialHair === 'none' ? 'none' : feat.facialHairColor,
      headwearColor: feat.headwear ? feat.headwearColor : 'none',
    }),
    [feat, bald],
  );

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
    setPhotoFile(file);
    setGen(null);
    setAnalyzing(true);
    setErr('');
    const form = new FormData();
    form.append('photo', file);
    void fetch('/api/dev/likeness/analyze', { method: 'POST', body: form })
      .then((r) => r.json())
      .then((r: { features?: Features; avatar?: Sprites; bake?: Sprites; heads?: Heads; photo?: string; error?: string }) => {
        setAnalyzing(false);
        if (r.error) return setErr(r.error);
        if (r.heads) setHeads(r.heads);
        if (r.features) {
          setBald((r.features.hairColor ?? '').toLowerCase() === 'none');
          setFeat({
            ...DEFAULT,
            ...r.features,
            hairColor: r.features.hairColor === 'none' ? DEFAULT.hairColor : r.features.hairColor,
            facialHairColor: r.features.facialHairColor === 'none' ? DEFAULT.facialHairColor : r.features.facialHairColor,
            headwearColor: r.features.headwearColor === 'none' ? DEFAULT.headwearColor : r.features.headwearColor,
          });
        }
        if (r.avatar) setAvatar(r.avatar);
        setBake(r.bake ?? null);
        setPhoto(r.photo ?? null);
      })
      .catch((e: Error) => {
        setAnalyzing(false);
        setErr(e.message);
      });
  };

  // Webcam capture ("take a photo") → same analyze flow.
  const startCamera = async (): Promise<void> => {
    setErr('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 640 }, facingMode: 'user' } });
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
    c.toBlob((blob) => {
      if (!blob) return;
      stopCamera();
      analyze(new File([blob], 'snap.jpg', { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.9);
  };
  useEffect(() => () => stopCamera(), []);

  // Experimental: image-model portrait from the current photo + features.
  const generate = (): void => {
    if (!photoFile) return;
    setGenerating(true);
    setErr('');
    const form = new FormData();
    form.append('photo', photoFile);
    form.append('features', JSON.stringify(sent));
    void fetch('/api/dev/likeness/generate', { method: 'POST', body: form })
      .then((r) => r.json())
      .then((r: { portrait?: string; error?: string }) => {
        setGenerating(false);
        if (r.error) setErr(r.error);
        else if (r.portrait) setGen(r.portrait);
      })
      .catch((e: Error) => {
        setGenerating(false);
        setErr(e.message);
      });
  };

  const set = (k: keyof Features, v: string | boolean): void => setFeat((f) => ({ ...f, [k]: v }));
  const randomize = (): void => {
    setBald(Math.random() < 0.25);
    setFeat({
      skinTone: pick(['#f0d0b0', '#e6b892', '#c98f6b', '#a8724e', '#8d5a34', '#6b4226', '#4a2f1c']),
      hairColor: pick(['#2a2320', '#141210', '#5a3a22', '#8a5a2a', '#c98a3a', '#d8b25a', '#8a3b1e', '#9a9a9a']),
      facialHairColor: randHex(),
      headwearColor: randHex(),
      glasses: Math.random() < 0.4,
      headwear: Math.random() < 0.3,
      facialHair: pick(ENUMS.facialHair!),
      faceShape: pick(ENUMS.faceShape!),
      chin: pick(ENUMS.chin!),
      noseSize: pick(ENUMS.noseSize!),
      eyeSpacing: pick(ENUMS.eyeSpacing!),
      eyeShape: pick(ENUMS.eyeShape!),
      eyebrows: pick(ENUMS.eyebrows!),
      eyebrowShape: pick(ENUMS.eyebrowShape!),
      ears: pick(ENUMS.ears!),
    });
    setBake(null);
    setPhoto(null);
  };

  const swatch = (label: string, k: keyof Features, disabled = false): ComponentChildren => (
    <label class="lab-row" style={disabled ? 'opacity:0.4' : ''}>
      <span>{label}</span>
      <input type="color" value={feat[k] as string} disabled={disabled} onInput={(e) => set(k, (e.target as HTMLInputElement).value)} />
    </label>
  );
  const dropdown = (label: string, k: keyof Features): ComponentChildren => (
    <label class="lab-row">
      <span>{label}</span>
      <select value={feat[k] as string} onChange={(e) => set(k, (e.target as HTMLSelectElement).value)}>
        {ENUMS[k]!.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
  const check = (label: string, k: keyof Features): ComponentChildren => (
    <label class="lab-row">
      <span>{label}</span>
      <input type="checkbox" checked={feat[k] as boolean} onChange={(e) => set(k, (e.target as HTMLInputElement).checked)} />
    </label>
  );

  const spriteBlock = (title: string, s: Sprites | null, note?: string): ComponentChildren => (
    <div class="lab-preview">
      <div class="lab-preview-title">{title}</div>
      {s ? (
        <>
          <img class="lab-pixel" src={s.portrait} style="width:220px;height:220px" />
          <div style="display:flex;gap:14px;align-items:flex-end;margin-top:8px">
            <img class="lab-pixel" src={s.head16} style="width:64px;height:64px" title="head16 (in-game)" />
            <img class="lab-pixel" src={s.head12} style="width:48px;height:48px" title="head12 (in-game)" />
          </div>
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
        <span class="lab-sub">dev · avatar &amp; photo-bake in isolation</span>
        <a href="/?dev=assets" class="lab-link">→ asset gallery</a>
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
              <button onClick={() => void startCamera()}>{analyzing ? 'Analyzing…' : '📷 Take a photo'}</button>
            )}
            <button onClick={() => fileRef.current?.click()}>Drop / pick a photo</button>
            {photoFile && <button onClick={generate}>{generating ? 'Painting…' : 'Generate portrait (exp)'}</button>}
            <button onClick={randomize}>Randomize</button>
            <button onClick={() => { setFeat(DEFAULT); setBald(false); setBake(null); setPhoto(null); setGen(null); }}>Reset</button>
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
          <video ref={videoRef} autoplay muted playsinline style={`width:220px;border-radius:8px;margin-top:8px;${camOn ? '' : 'display:none'}`} />

          <div class="lab-group">Colours</div>
          {swatch('Skin', 'skinTone')}
          <label class="lab-row"><span>Bald</span><input type="checkbox" checked={bald} onChange={(e) => setBald((e.target as HTMLInputElement).checked)} /></label>
          {swatch('Hair', 'hairColor', bald)}
          {dropdown('Facial hair', 'facialHair')}
          {swatch('Beard colour', 'facialHairColor', feat.facialHair === 'none')}

          <div class="lab-group">Accessories</div>
          {check('Glasses', 'glasses')}
          {check('Headwear', 'headwear')}
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
          {spriteBlock('Avatar (drawn)', avatar, 'live from the features on the left')}
          {spriteBlock('Photo bake', bake, bake ? 'from the analyzed photo' : 'analyze a photo to compare')}
          <div class="lab-preview">
            <div class="lab-preview-title">Source photo</div>
            {photo ? <img src={photo} style="width:220px;height:220px;object-fit:cover;border-radius:8px" /> : <div class="lab-empty">—</div>}
          </div>
          {(gen || generating) && (
            <div class="lab-preview">
              <div class="lab-preview-title">Generated portrait</div>
              {gen ? <img class="lab-pixel" src={gen} style="width:220px;height:220px" /> : <div class="lab-empty">painting…</div>}
              <div class="lab-note">experimental image-model portrait (story card only)</div>
            </div>
          )}
        </div>
      </div>

      {heads && (
        <div class="lab-compare">
          <div class="lab-compare-head">
            <div class="lab-preview-title">Hero-size comparison — the same face at each candidate in-game size</div>
            <label class="lab-row" style="width:auto;margin:0">
              <span>Unlock fine features ≥</span>
              <select value={String(detailAt)} onChange={(e) => setDetailAt(Number((e.target as HTMLSelectElement).value))}>
                <option value="12">12px</option>
                <option value="16">16px</option>
                <option value="20">20px</option>
                <option value="32">32px (ships today)</option>
              </select>
            </label>
          </div>
          <div class="lab-note" style="margin-bottom:12px">Top row = same display size (readability). Bottom row = true relative size (how much bigger the head gets).</div>
          <div style="display:flex;gap:20px;align-items:flex-end;flex-wrap:wrap;margin-bottom:26px">
            {['12', '16', '20', '24', '28', '32', '48'].map((s) =>
              heads[s] ? (
                <div key={s} style="text-align:center">
                  <img class="lab-pixel" src={heads[s]} style="width:108px;height:108px" />
                  <div class="lab-note">{s}px{s === '12' ? ' · current' : ''}</div>
                  <img class="lab-pixel" src={heads[s]} style={`width:${Number(s) * 3}px;height:${Number(s) * 3}px`} title="≈ relative in-game size" />
                </div>
              ) : null,
            )}
          </div>
          <div class="lab-preview-title">Sprite proportion — head on a placeholder body (per direction)</div>
          <div style="display:flex;gap:34px;align-items:flex-end;flex-wrap:wrap;margin-top:12px">
            {PROPOSALS.map((p) => (
              <div key={p.key} style="text-align:center">
                <MockSprite src={heads[String(p.head)]} prop={p} />
                <div class="lab-note" style="font-weight:bold;color:#8ec;margin-top:6px">{p.label}</div>
                <div class="lab-note">{p.desc}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
