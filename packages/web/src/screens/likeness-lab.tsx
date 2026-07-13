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
  const [photo, setPhoto] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

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
        body: JSON.stringify({ features: sent }),
      })
        .then((r) => r.json())
        .then((r: { avatar?: Sprites; error?: string }) => {
          if (r.avatar) setAvatar(r.avatar);
          else setErr(r.error ?? 'render failed');
        })
        .catch((e: Error) => setErr(e.message));
    }, 120);
    return () => clearTimeout(id);
  }, [sent]);

  const analyze = (file: File): void => {
    setAnalyzing(true);
    setErr('');
    const form = new FormData();
    form.append('photo', file);
    void fetch('/api/dev/likeness/analyze', { method: 'POST', body: form })
      .then((r) => r.json())
      .then((r: { features?: Features; avatar?: Sprites; bake?: Sprites; photo?: string; error?: string }) => {
        setAnalyzing(false);
        if (r.error) return setErr(r.error);
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
            <button onClick={() => fileRef.current?.click()}>{analyzing ? 'Analyzing…' : 'Drop / pick a photo → analyze'}</button>
            <button onClick={randomize}>Randomize</button>
            <button onClick={() => { setFeat(DEFAULT); setBald(false); setBake(null); setPhoto(null); }}>Reset</button>
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
        </div>
      </div>
    </div>
  );
}
