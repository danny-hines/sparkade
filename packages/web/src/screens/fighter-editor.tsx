// Dev-only workshop for the procedural fighter renderer
// (http://localhost:5173/?dev=fighter-editor). Fighters are articulated canvas
// drawings rather than LIBRARY row sprites, so this screen edits the bounded
// appearance data the game actually stores and previews it with drawFighter.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import {
  FIGHTER_COLOR_ROLES,
  FIGHTER_FOOT_PRESETS,
  FIGHTER_FOOT_SHAPES,
  FIGHTER_HAND_SHAPES,
  FIGHTER_LEG_ACCENTS,
  FIGHTER_OUTFIT_IDS,
  FIGHTER_OUTFIT_RIG_BOUNDS,
  FIGHTER_OUTFIT_RIGS,
  FIGHTER_POSES,
  FIGHTER_TORSO_DETAILS,
  cloneFighterOutfitRig,
  cloneFighterOutfitRigs,
  drawFighter,
  fighterColorsForPalette,
  fighterIdentitySeed,
  fighterScaleForBuild,
  resolveFighterAvatarHead,
  validateFighterOutfitRig,
  type FighterAvatarHead,
  type FighterFootPreset,
  type FighterOutfitRig,
  type FighterPose,
} from '@sparkade/archetypes';
import {
  PALETTE_MOODS,
  type FighterBuild,
  type FighterBoss,
  type FighterCharacter,
  type FighterOutfit,
  type FighterSpec,
  type GameListItem,
  type LintError,
} from '@sparkade/shared';
import { api } from '../api';
import { loadLikenessAssets } from '../likeness-assets';

const BUILDS: readonly FighterBuild[] = ['nimble', 'balanced', 'heavy'];
const OUTFITS: readonly FighterOutfit[] = FIGHTER_OUTFIT_IDS;
const FALLBACK_PALETTE = [
  '#000000', '#1a1c2c', '#29366f', '#3b5dc9', '#41a6f6', '#38b764', '#a7f070', '#ffcd75',
  '#b13e53', '#ef7d57', '#5d275d', '#e04040', '#ffa300', '#ffd75e', '#94b0c2', '#f4f4f4',
];
const SCRATCH_PALETTE = PALETTE_MOODS[0]?.colors ?? FALLBACK_PALETTE;
const PREVIEW_W = 96;
const PREVIEW_H = 76;
const SHEET_COLS = 4;
const SHEET_CELL_W = 76;
const SHEET_CELL_H = 84;
const MAX_MOVE_T = 0.12;
const RIG_DRAFT_SESSION_KEY = 'sparkade:fighter-outfit-rig-drafts';

interface Appearance {
  name: string;
  build: FighterBuild;
  outfit: FighterOutfit;
  colorSlot: number;
}

type EditTarget =
  | { kind: 'player' }
  | { kind: 'opponent'; index: number }
  | { kind: 'boss' };

interface InitialState {
  gameId: string;
  targetKey: string;
  appearance: Appearance;
  hasAppearance: boolean;
  pose: FighterPose;
  facing: 1 | -1;
  moveT: number;
  playing: boolean;
  flash: boolean;
}

interface SaveResponse {
  ok: true;
  spec: FighterSpec;
  file: string;
  warnings: LintError[];
}

type RigPart = 'torso' | 'arms' | 'legs';
type RigColorRole = (typeof FIGHTER_COLOR_ROLES)[number];
type OutfitRigMap = Record<FighterOutfit, FighterOutfitRig>;

const FOOT_PRESET_OPTIONS = [
  { id: 'sneakers', label: 'Sneakers' },
  { id: 'barefoot', label: 'Barefoot' },
  { id: 'ankleBoots', label: 'Ankle boots' },
  { id: 'tallBoots', label: 'Tall boots' },
  { id: 'none', label: 'No added foot' },
] as const satisfies ReadonlyArray<{ id: FighterFootPreset; label: string }>;

const FOOT_PRESET_FOR_SHAPE = {
  none: 'none',
  bare: 'barefoot',
  shoe: 'sneakers',
  boot: 'ankleBoots',
} as const satisfies Record<FighterOutfitRig['feet']['shape'], FighterFootPreset>;

interface RigLoadResponse {
  ok: true;
  file: string;
  version: 1;
  revision: string;
  outfits: OutfitRigMap;
}

interface RigSaveResponse {
  ok: true;
  file: string;
  version: 1;
  revision: string;
  outfit: FighterOutfit;
  style: FighterOutfitRig;
}

const DEFAULT_APPEARANCE: Appearance = {
  name: 'HERO',
  build: 'balanced',
  outfit: 'gi',
  colorSlot: 5,
};

function isBuild(value: string | null): value is FighterBuild {
  return value !== null && (BUILDS as readonly string[]).includes(value);
}

function isOutfit(value: string | null): value is FighterOutfit {
  return value !== null && (OUTFITS as readonly string[]).includes(value);
}

function isPose(value: string | null): value is FighterPose {
  return value !== null && (FIGHTER_POSES as readonly string[]).includes(value);
}

function readInitialState(): InitialState {
  if (typeof location === 'undefined') {
    return {
      gameId: '',
      targetKey: 'player',
      appearance: { ...DEFAULT_APPEARANCE },
      hasAppearance: false,
      pose: 'idle',
      facing: 1,
      moveT: 0,
      playing: false,
      flash: false,
    };
  }
  const q = new URLSearchParams(location.search);
  const color = Number(q.get('colorSlot'));
  const moveT = Number(q.get('moveT'));
  const build = q.get('build');
  const outfit = q.get('outfit');
  const name = q.get('name');
  return {
    gameId: q.get('game') ?? '',
    targetKey: q.get('target') ?? 'player',
    appearance: {
      name: name?.slice(0, 24) || DEFAULT_APPEARANCE.name,
      build: isBuild(build) ? build : DEFAULT_APPEARANCE.build,
      outfit: isOutfit(outfit) ? outfit : DEFAULT_APPEARANCE.outfit,
      colorSlot: Number.isInteger(color) && color >= 5 && color <= 11 ? color : 5,
    },
    hasAppearance: ['name', 'build', 'outfit', 'colorSlot'].some((key) => q.has(key)),
    pose: isPose(q.get('pose')) ? q.get('pose') as FighterPose : 'idle',
    facing: q.get('facing') === 'left' ? -1 : 1,
    moveT: Number.isFinite(moveT) ? Math.max(0, Math.min(MAX_MOVE_T, moveT)) : 0,
    playing: q.get('play') === '1',
    flash: q.get('flash') === '1',
  };
}

function targetFromKey(key: string): EditTarget | null {
  if (key === 'player') return { kind: 'player' };
  if (key === 'boss') return { kind: 'boss' };
  const match = /^opponent:(\d+)$/.exec(key);
  if (!match) return null;
  return { kind: 'opponent', index: Number(match[1]) };
}

function normalizedTargetKey(spec: FighterSpec, requested: string): string {
  const target = targetFromKey(requested);
  if (!target) return 'player';
  if (target.kind === 'opponent' && (target.index < 0 || target.index >= spec.levels.length)) {
    return 'player';
  }
  return requested;
}

function appearanceOf(spec: FighterSpec, target: EditTarget): Appearance {
  let character: Pick<FighterCharacter, 'name' | 'build' | 'outfit' | 'colorSlot'> | undefined;
  if (target.kind === 'player') character = spec.player;
  else if (target.kind === 'opponent') character = spec.levels[target.index]?.opponent;
  else character = spec.boss;
  return {
    name: character?.name ?? DEFAULT_APPEARANCE.name,
    build: character?.build ?? DEFAULT_APPEARANCE.build,
    // Legacy fighter saves can omit outfit. Choosing an explicit gi makes the
    // next Apply deterministic without changing the save merely by opening it.
    outfit: character?.outfit ?? DEFAULT_APPEARANCE.outfit,
    colorSlot: character?.colorSlot ?? DEFAULT_APPEARANCE.colorSlot,
  };
}

function hpForTarget(spec: FighterSpec | null, target: EditTarget | null): number {
  if (!spec || !target) return 100;
  if (target.kind === 'player') return spec.player?.hp ?? 100;
  if (target.kind === 'opponent') return spec.levels[target.index]?.opponent.hp ?? 100;
  return spec.boss.hp;
}

function characterForTarget(
  spec: FighterSpec | null,
  target: EditTarget | null,
): FighterCharacter | FighterBoss | null {
  if (!spec || !target) return null;
  if (target.kind === 'player') return spec.player ?? null;
  if (target.kind === 'opponent') return spec.levels[target.index]?.opponent ?? null;
  return spec.boss;
}

function maxColorSlot(target: EditTarget | null): number {
  return target?.kind === 'boss' ? 11 : 10;
}

function validName(name: string): boolean {
  return name.length >= 1 && name.length <= 24 && name.trim().length > 0 && /^[ -~]+$/.test(name);
}

function safeFilename(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'fighter';
}

function sameRig(a: FighterOutfitRig, b: FighterOutfitRig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameFeet(a: FighterOutfitRig['feet'], b: FighterOutfitRig['feet']): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function cloneRigMap(rigs: OutfitRigMap): OutfitRigMap {
  return Object.fromEntries(
    FIGHTER_OUTFIT_IDS.map((id) => [id, cloneFighterOutfitRig(rigs[id])]),
  ) as OutfitRigMap;
}

function drawPreview(
  canvas: HTMLCanvasElement,
  appearance: Appearance,
  palette: readonly string[],
  pose: FighterPose,
  facing: 1 | -1,
  moveT: number,
  anim: number,
  flash: boolean,
  avatarHead: FighterAvatarHead,
  likenessHead: CanvasImageSource | null,
  outfitRig: FighterOutfitRig,
  guides = false,
): void {
  if (canvas.width !== PREVIEW_W) canvas.width = PREVIEW_W;
  if (canvas.height !== PREVIEW_H) canvas.height = PREVIEW_H;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, PREVIEW_W, PREVIEW_H);
  ctx.imageSmoothingEnabled = false;
  drawFighter(ctx, {
    cx: PREVIEW_W / 2,
    feetY: PREVIEW_H - 7,
    facing,
    pose,
    t: moveT,
    anim,
    scale: fighterScaleForBuild(appearance.build),
    build: appearance.build,
    outfit: appearance.outfit,
    outfitRig,
    colors: fighterColorsForPalette(palette, appearance.colorSlot),
    avatarHead,
    likenessHead,
    flash,
    guides,
  });
}

function drawContactSheet(
  canvas: HTMLCanvasElement,
  appearance: Appearance,
  palette: readonly string[],
  facing: 1 | -1,
  moveT: number,
  anim: number,
  flash: boolean,
  avatarHead: FighterAvatarHead,
  likenessHead: CanvasImageSource | null,
  outfitRig: FighterOutfitRig,
): void {
  const rows = Math.ceil(FIGHTER_POSES.length / SHEET_COLS);
  const width = SHEET_COLS * SHEET_CELL_W;
  const height = rows * SHEET_CELL_H;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = false;
  ctx.font = '6px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  FIGHTER_POSES.forEach((sheetPose, index) => {
    const col = index % SHEET_COLS;
    const row = Math.floor(index / SHEET_COLS);
    const x = col * SHEET_CELL_W;
    const y = row * SHEET_CELL_H;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, SHEET_CELL_W, SHEET_CELL_H);
    ctx.clip();
    drawFighter(ctx, {
      cx: x + SHEET_CELL_W / 2,
      feetY: y + SHEET_CELL_H - 7,
      facing,
      pose: sheetPose,
      t: moveT,
      anim,
      scale: fighterScaleForBuild(appearance.build),
      build: appearance.build,
      outfit: appearance.outfit,
      outfitRig,
      colors: fighterColorsForPalette(palette, appearance.colorSlot),
      avatarHead,
      likenessHead,
      flash,
    });
    ctx.restore();
    ctx.fillStyle = palette[15] ?? '#ffffff';
    ctx.fillText(sheetPose, x + SHEET_CELL_W / 2, y + 2);
  });
}

async function responseError(res: Response): Promise<string> {
  try {
    const body = await res.json() as { error?: string; details?: string[] };
    const base = body.error ?? `HTTP ${res.status}`;
    return body.details?.length ? `${base}: ${body.details.join('; ')}` : base;
  } catch {
    return `HTTP ${res.status}`;
  }
}

function RigRange(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}): ComponentChildren {
  const setValue = (raw: string): void => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    props.onChange(Math.max(props.min, Math.min(props.max, value)));
  };
  return (
    <label class="fed-rig-range">
      <span>{props.label}</span>
      <div>
        <input
          type="range"
          min={props.min}
          max={props.max}
          step={props.step}
          value={props.value}
          onInput={(event) => setValue((event.target as HTMLInputElement).value)}
        />
        <input
          type="number"
          aria-label={`${props.label} value`}
          min={props.min}
          max={props.max}
          step={props.step}
          value={props.value}
          onInput={(event) => setValue((event.target as HTMLInputElement).value)}
        />
        {props.suffix && <span class="fed-rig-unit">{props.suffix}</span>}
      </div>
    </label>
  );
}

function RigSelect<T extends string>(props: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
}): ComponentChildren {
  return (
    <label class="fed-field fed-rig-select">
      <span>{props.label}</span>
      <select
        value={props.value}
        onChange={(event) => props.onChange((event.target as HTMLSelectElement).value as T)}
      >
        {props.options.map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
    </label>
  );
}

export function FighterEditorScreen(): ComponentChildren {
  const initial = useMemo(readInitialState, []);
  const [games, setGames] = useState<GameListItem[]>([]);
  const [gameId, setGameId] = useState(initial.gameId);
  const [spec, setSpec] = useState<FighterSpec | null>(null);
  const [targetKey, setTargetKey] = useState(initial.gameId ? initial.targetKey : 'player');
  const [appearance, setAppearance] = useState<Appearance>(initial.appearance);
  const [rigDrafts, setRigDrafts] = useState<OutfitRigMap>(() => cloneFighterOutfitRigs());
  const [rigSaved, setRigSaved] = useState<OutfitRigMap>(() => cloneFighterOutfitRigs());
  const [rigExpanded, setRigExpanded] = useState(true);
  const [rigPart, setRigPart] = useState<RigPart>('torso');
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [rigRevision, setRigRevision] = useState('');
  const [rigFile, setRigFile] = useState('');
  const [rigLoading, setRigLoading] = useState(true);
  const [rigSaving, setRigSaving] = useState(false);
  const [rigMessage, setRigMessage] = useState('');
  const [rigError, setRigError] = useState('');
  const [pose, setPose] = useState<FighterPose>(initial.pose);
  const [facing, setFacing] = useState<1 | -1>(initial.facing);
  const [moveT, setMoveT] = useState(initial.moveT);
  const [playing, setPlaying] = useState(initial.playing);
  const [flash, setFlash] = useState(initial.flash);
  const [sideHead, setSideHead] = useState<CanvasImageSource | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<LintError[]>([]);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const sheetRef = useRef<HTMLCanvasElement>(null);
  const loadSequence = useRef(0);

  const palette = spec?.palette ?? SCRATCH_PALETTE;
  const target = spec ? targetFromKey(targetKey) : { kind: 'player' } as EditTarget;
  const slotMax = maxColorSlot(target);
  const likenessHead = target?.kind === 'player' ? sideHead : null;
  const avatarRosterSlot = target?.kind === 'opponent'
    ? target.index + 1
    : target?.kind === 'boss'
      ? (spec?.levels.length ?? 0) + 1
      : 0;
  const avatarHead = useMemo(
    () => resolveFighterAvatarHead(
      fighterIdentitySeed(spec?.seed ?? 0, avatarRosterSlot, appearance.name),
    ),
    [spec?.seed, avatarRosterSlot, appearance.name],
  );
  const outfitRig = rigDrafts[appearance.outfit] ?? FIGHTER_OUTFIT_RIGS[appearance.outfit];
  const savedOutfitRig = rigSaved[appearance.outfit] ?? FIGHTER_OUTFIT_RIGS[appearance.outfit];
  const activeFootPreset = FOOT_PRESET_OPTIONS.find(({ id }) =>
    sameFeet(outfitRig.feet, FIGHTER_FOOT_PRESETS[id]),
  )?.id;
  const rigDirty = !sameRig(outfitRig, savedOutfitRig);
  const anyRigDirty = FIGHTER_OUTFIT_IDS.some((id) => !sameRig(rigDrafts[id], rigSaved[id]));
  const slots = useMemo(
    () => Array.from({ length: slotMax - 4 }, (_, index) => index + 5),
    [slotMax],
  );

  const loadGame = async (
    id: string,
    requestedTarget = 'player',
    appearanceOverride?: Appearance,
  ): Promise<void> => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setMessage('');
    setError('');
    setWarnings([]);
    try {
      const detail = await api.getGame(id);
      if (sequence !== loadSequence.current) return;
      if (!detail.spec || detail.spec.archetype !== 'fighter') {
        throw new Error('That game does not contain a ready fighter spec.');
      }
      const nextSpec = detail.spec;
      const nextTargetKey = normalizedTargetKey(nextSpec, requestedTarget);
      const nextTarget = targetFromKey(nextTargetKey)!;
      setGameId(id);
      setSpec(nextSpec);
      setTargetKey(nextTargetKey);
      setAppearance(appearanceOverride ?? appearanceOf(nextSpec, nextTarget));

      const likeness = await loadLikenessAssets(id, detail.assets);
      if (sequence !== loadSequence.current) return;
      // Matches SpriteStore.likenessHead(16, 'side'): directional asset first,
      // with the legacy front head as its production fallback.
      setSideHead(likeness?.head16Side ?? likeness?.head16 ?? null);
    } catch (cause) {
      if (sequence !== loadSequence.current) return;
      setSpec(null);
      setSideHead(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  };

  useEffect(() => {
    document.documentElement.classList.add('dev-gallery');
    document.body.classList.add('dev-gallery');
    void api
      .listGames()
      .then((items) => setGames(items.filter((game) => game.archetype === 'fighter' && game.status === 'ready')))
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    if (initial.gameId) {
      void loadGame(
        initial.gameId,
        initial.targetKey,
        initial.hasAppearance ? initial.appearance : undefined,
      );
    }
    return () => {
      loadSequence.current++;
      document.documentElement.classList.remove('dev-gallery');
      document.body.classList.remove('dev-gallery');
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setRigLoading(true);
    void fetch('/api/dev/fighter/outfits')
      .then(async (res) => {
        if (!res.ok) throw new Error(await responseError(res));
        return res.json() as Promise<RigLoadResponse>;
      })
      .then((result) => {
        if (cancelled) return;
        const loaded = cloneRigMap(result.outfits);
        try {
          const stashed = JSON.parse(sessionStorage.getItem(RIG_DRAFT_SESSION_KEY) ?? '{}') as Record<string, unknown>;
          for (const id of FIGHTER_OUTFIT_IDS) {
            const validated = validateFighterOutfitRig(stashed[id], `stashed.${id}`);
            if (validated.ok) loaded[id] = validated.value;
          }
          sessionStorage.removeItem(RIG_DRAFT_SESSION_KEY);
        } catch {
          sessionStorage.removeItem(RIG_DRAFT_SESSION_KEY);
        }
        setRigDrafts(loaded);
        setRigSaved(cloneRigMap(result.outfits));
        setRigRevision(result.revision);
        setRigFile(result.file);
        setRigError('');
      })
      .catch((cause) => {
        if (cancelled) return;
        setRigError(`${cause instanceof Error ? cause.message : String(cause)} Bundled rigs remain available for preview.`);
      })
      .finally(() => {
        if (!cancelled) setRigLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // A successful source save may trigger Vite HMR. Other outfit drafts are
    // stashed before that request, so do not block the intentional reload.
    if (!anyRigDirty || rigSaving) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    addEventListener('beforeunload', warnBeforeUnload);
    return () => removeEventListener('beforeunload', warnBeforeUnload);
  }, [anyRigDirty, rigSaving]);

  useEffect(() => {
    setRigMessage('');
  }, [appearance.outfit]);

  useEffect(() => {
    let request = 0;
    const started = performance.now();
    const render = (now: number): void => {
      const elapsed = Math.max(0, (now - started) / 1000);
      const phase = (elapsed % 0.4) / 0.4;
      const animatedT = phase < 0.5 ? phase * 2 * MAX_MOVE_T : (1 - phase) * 2 * MAX_MOVE_T;
      const frameT = playing ? animatedT : moveT;
      const anim = playing ? elapsed : 0;
      if (previewRef.current) {
        drawPreview(
          previewRef.current,
          appearance,
          palette,
          pose,
          facing,
          frameT,
          anim,
          flash,
          avatarHead,
          likenessHead,
          outfitRig,
          showSkeleton,
        );
      }
      if (sheetRef.current) {
        drawContactSheet(
          sheetRef.current,
          appearance,
          palette,
          facing,
          frameT,
          anim,
          flash,
          avatarHead,
          likenessHead,
          outfitRig,
        );
      }
      if (playing) request = requestAnimationFrame(render);
    };
    render(performance.now());
    return () => cancelAnimationFrame(request);
  }, [appearance, palette, pose, facing, moveT, playing, flash, avatarHead, likenessHead, outfitRig, showSkeleton]);

  const resetScratch = (): void => {
    loadSequence.current++;
    setGameId('');
    setSpec(null);
    setTargetKey('player');
    setAppearance({ ...DEFAULT_APPEARANCE });
    setSideHead(null);
    setLoading(false);
    setMessage('scratch fighter');
    setError('');
    setWarnings([]);
  };

  const changeTarget = (key: string): void => {
    if (!spec) return;
    const normalized = normalizedTargetKey(spec, key);
    const nextTarget = targetFromKey(normalized)!;
    setTargetKey(normalized);
    setAppearance(appearanceOf(spec, nextTarget));
    setMessage('');
    setError('');
    setWarnings([]);
  };

  const copyText = async (text: string, success: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage(success);
      setError('');
    } catch {
      setError('Clipboard access failed.');
    }
  };

  const replaceOutfitRig = (next: FighterOutfitRig): void => {
    const outfit = appearance.outfit;
    setRigDrafts((current) => ({ ...current, [outfit]: next }));
    setRigMessage('');
    setRigError('');
  };
  const patchRigTorso = (patch: Partial<FighterOutfitRig['torso']>): void =>
    replaceOutfitRig({ ...outfitRig, torso: { ...outfitRig.torso, ...patch } });
  const patchRigArms = (patch: Partial<FighterOutfitRig['arms']>): void =>
    replaceOutfitRig({ ...outfitRig, arms: { ...outfitRig.arms, ...patch } });
  const patchRigLegs = (patch: Partial<FighterOutfitRig['legs']>): void =>
    replaceOutfitRig({ ...outfitRig, legs: { ...outfitRig.legs, ...patch } });
  const patchRigHands = (patch: Partial<FighterOutfitRig['hands']>): void =>
    replaceOutfitRig({ ...outfitRig, hands: { ...outfitRig.hands, ...patch } });
  const patchRigFeet = (patch: Partial<FighterOutfitRig['feet']>): void =>
    replaceOutfitRig({ ...outfitRig, feet: { ...outfitRig.feet, ...patch } });
  const applyFootPreset = (preset: FighterFootPreset): void =>
    patchRigFeet({ ...FIGHTER_FOOT_PRESETS[preset] });

  const workshopUrl = (): URL => {
    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set('dev', 'fighter-editor');
    if (gameId) {
      url.searchParams.set('game', gameId);
      url.searchParams.set('target', targetKey);
    }
    url.searchParams.set('name', appearance.name);
    url.searchParams.set('build', appearance.build);
    url.searchParams.set('outfit', appearance.outfit);
    url.searchParams.set('colorSlot', String(appearance.colorSlot));
    url.searchParams.set('pose', pose);
    url.searchParams.set('facing', facing === -1 ? 'left' : 'right');
    url.searchParams.set('moveT', moveT.toFixed(3));
    if (playing) url.searchParams.set('play', '1');
    if (flash) url.searchParams.set('flash', '1');
    return url;
  };

  const revertOutfitRig = (): void => {
    replaceOutfitRig(cloneFighterOutfitRig(savedOutfitRig));
    setRigMessage(`reverted unsaved ${appearance.outfit} changes`);
  };

  const copyOutfitRig = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(outfitRig, null, 2));
      setRigMessage(`${appearance.outfit} rig JSON copied`);
      setRigError('');
    } catch {
      setRigError('Clipboard access failed.');
    }
  };

  const saveOutfitRig = async (): Promise<void> => {
    if (!rigRevision || rigLoading || rigSaving || !rigDirty) return;
    const outfit = appearance.outfit;
    const requestedStyle = cloneFighterOutfitRig(outfitRig);
    const stashed = Object.fromEntries(
      FIGHTER_OUTFIT_IDS
        .filter((id) => id !== outfit && !sameRig(rigDrafts[id], rigSaved[id]))
        .map((id) => [id, rigDrafts[id]]),
    );
    if (Object.keys(stashed).length > 0) {
      sessionStorage.setItem(RIG_DRAFT_SESSION_KEY, JSON.stringify(stashed));
    } else {
      sessionStorage.removeItem(RIG_DRAFT_SESSION_KEY);
    }
    // Saving the imported JSON can make Vite reload this screen. Preserve the
    // selected game, roster target, appearance and pose in that case.
    history.replaceState(null, '', workshopUrl());
    setRigSaving(true);
    setRigMessage('');
    setRigError('');
    try {
      const res = await fetch(`/api/dev/fighter/outfits/${encodeURIComponent(outfit)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ revision: rigRevision, style: requestedStyle }),
      });
      if (!res.ok) throw new Error(await responseError(res));
      const result = await res.json() as RigSaveResponse;
      const savedStyle = cloneFighterOutfitRig(result.style);
      setRigSaved((current) => ({ ...current, [outfit]: savedStyle }));
      setRigDrafts((current) => sameRig(current[outfit], requestedStyle)
        ? { ...current, [outfit]: cloneFighterOutfitRig(savedStyle) }
        : current);
      setRigRevision(result.revision);
      setRigFile(result.file);
      setRigMessage(`saved ${outfit} globally → ${result.file}`);
    } catch (cause) {
      sessionStorage.removeItem(RIG_DRAFT_SESSION_KEY);
      setRigError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRigSaving(false);
    }
  };

  const copyCharacter = (): void => {
    const character = {
      ...(characterForTarget(spec, target) ?? { hp: hpForTarget(spec, target) }),
      ...appearance,
    };
    void copyText(JSON.stringify(character, null, 2), 'character JSON copied');
  };

  const copyUrl = (): void => {
    void copyText(workshopUrl().toString(), 'workshop URL copied');
  };

  const exportPng = (): void => {
    const canvas = document.createElement('canvas');
    drawPreview(
      canvas,
      appearance,
      palette,
      pose,
      facing,
      moveT,
      0,
      flash,
      avatarHead,
      likenessHead,
      outfitRig,
      false,
    );
    canvas.toBlob((blob) => {
      if (!blob) {
        setError('PNG export failed.');
        return;
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${safeFilename(appearance.name)}-${appearance.outfit}-${pose}.png`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setMessage(`exported ${canvas.width}×${canvas.height} production-resolution PNG`);
      setError('');
    }, 'image/png');
  };

  const applyToGame = async (): Promise<void> => {
    if (!gameId || !spec || !target) return;
    if (!validName(appearance.name)) {
      setError('Name must be 1–24 printable ASCII characters.');
      return;
    }
    if (appearance.colorSlot > maxColorSlot(target)) {
      setError(`Color slot must be between 5 and ${maxColorSlot(target)} for this target.`);
      return;
    }
    setSaving(true);
    setMessage('');
    setError('');
    setWarnings([]);
    try {
      const res = await fetch(`/api/dev/fighter/games/${encodeURIComponent(gameId)}/character`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target, appearance }),
      });
      if (!res.ok) throw new Error(await responseError(res));
      const result = await res.json() as SaveResponse;
      setSpec(result.spec);
      setWarnings(result.warnings ?? []);
      setMessage(`saved → ${result.file}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const targetOptions = spec
    ? [
        { key: 'player', label: `Player · ${spec.player?.name ?? 'HERO'}` },
        ...spec.levels.map((level, index) => ({
          key: `opponent:${index}`,
          label: `Opponent ${index + 1} · ${level.opponent.name} (${level.name})`,
        })),
        { key: 'boss', label: `Boss · ${spec.boss.name}` },
      ]
    : [{ key: 'player', label: 'Scratch fighter' }];

  return (
    <div class="fed-page">
      <header class="fed-header">
        <div>
          <h1>Fighter Workshop</h1>
          <div class="fed-subtitle">dev · production renderer · appearance edits preserve combat stats</div>
        </div>
        <nav class="fed-nav">
          <a href="/?dev=playtest&arch=fighter">→ fighter playtest</a>
          <a href="/?dev=sprite-editor">→ sprite editor</a>
          <a href="/?dev=assets">→ asset gallery</a>
        </nav>
      </header>

      <div class="fed-layout">
        <aside class="fed-controls">
          <section class="fed-panel">
            <h2>Source</h2>
            <label class="fed-field">
              <span>Fighter game</span>
              <select
                value={gameId}
                disabled={loading}
                onChange={(event) => {
                  const id = (event.target as HTMLSelectElement).value;
                  if (!id) resetScratch();
                  else {
                    setGameId(id);
                    void loadGame(id);
                  }
                }}
              >
                <option value="">Scratch fighter</option>
                {games.map((game) => (
                  <option key={game.id} value={game.id}>{game.title} · {game.id}</option>
                ))}
              </select>
            </label>
            <label class="fed-field">
              <span>Roster target</span>
              <select
                value={targetKey}
                disabled={!spec || loading}
                onChange={(event) => changeTarget((event.target as HTMLSelectElement).value)}
              >
                {targetOptions.map((option) => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>
            </label>
            <div class={`fed-likeness ${likenessHead ? 'fed-likeness-on' : ''}`}>
              {!gameId
                ? 'Scratch uses a deterministic avatar head.'
                : target?.kind !== 'player'
                  ? 'Opponent and boss use deterministic avatar heads in production.'
                  : likenessHead
                    ? 'Using this game’s 16px side likeness.'
                    : 'No likeness asset; using a deterministic avatar head.'}
            </div>
          </section>

          <section class="fed-panel">
            <h2>Character</h2>
            <label class="fed-field">
              <span>Name</span>
              <input
                type="text"
                maxlength={24}
                value={appearance.name}
                class={!validName(appearance.name) ? 'fed-invalid' : ''}
                onInput={(event) => setAppearance({ ...appearance, name: (event.target as HTMLInputElement).value })}
              />
            </label>
            <label class="fed-field">
              <span>Build</span>
              <select
                value={appearance.build}
                onChange={(event) => setAppearance({ ...appearance, build: (event.target as HTMLSelectElement).value as FighterBuild })}
              >
                {BUILDS.map((build) => <option key={build} value={build}>{build}</option>)}
              </select>
            </label>
            <label class="fed-field">
              <span>Outfit</span>
              <select
                value={appearance.outfit}
                onChange={(event) => setAppearance({ ...appearance, outfit: (event.target as HTMLSelectElement).value as FighterOutfit })}
              >
                {OUTFITS.map((outfit) => <option key={outfit} value={outfit}>{outfit}</option>)}
              </select>
            </label>
            <div class="fed-field">
              <span>Color slot · {appearance.colorSlot.toString(16)}</span>
              <div class="fed-color-slots">
                {slots.map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    class={`fed-color-slot ${appearance.colorSlot === slot ? 'fed-color-slot-on' : ''}`}
                    style={{ background: palette[slot] ?? '#ffffff' }}
                    title={`palette slot ${slot.toString(16)} · ${palette[slot] ?? ''}`}
                    aria-label={`Use palette slot ${slot.toString(16)}`}
                    aria-pressed={appearance.colorSlot === slot}
                    onClick={() => setAppearance({ ...appearance, colorSlot: slot })}
                  >
                    {slot.toString(16)}
                  </button>
                ))}
              </div>
              <div class="fed-palette" aria-label="Selected game's palette">
                {palette.map((color, index) => (
                  <span key={index} title={`${index.toString(16)} · ${color}`} style={{ background: color }} />
                ))}
              </div>
            </div>
          </section>

          <details
            class="fed-panel fed-rig-panel"
            open={rigExpanded}
            onToggle={(event) => setRigExpanded((event.currentTarget as HTMLDetailsElement).open)}
          >
            <summary>
              <span>Outfit rig · global</span>
              <small>{appearance.outfit}{rigDirty ? ' · unsaved' : ''}</small>
            </summary>
            <div class="fed-rig-body">
              <div class="fed-rig-scope" id="fed-rig-scope">
                Editing <strong>{appearance.outfit}</strong> changes every fighter that uses this outfit.
                “Apply to game” only selects the outfit for the current character.
              </div>

              <div class="fed-rig-tabs" role="group" aria-label="Outfit rig part">
                {([
                  ['torso', 'Torso'],
                  ['arms', 'Arms'],
                  ['legs', 'Legs & endpoints'],
                ] as const).map(([part, label]) => (
                  <button
                    key={part}
                    type="button"
                    class={rigPart === part ? 'fed-on' : ''}
                    aria-pressed={rigPart === part}
                    onClick={() => setRigPart(part)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <fieldset class="fed-rig-fieldset" disabled={rigLoading || rigSaving} aria-describedby="fed-rig-scope">
                <legend class="fed-rig-legend">{rigPart === 'legs' ? 'Legs and endpoints' : rigPart} controls</legend>
                {rigPart === 'torso' && (
                  <div class="fed-rig-fields">
                    <RigRange label="Body width" value={outfitRig.torso.widthAdd} {...FIGHTER_OUTFIT_RIG_BOUNDS.torso.widthAdd} step={0.25} suffix="px" onChange={(value) => patchRigTorso({ widthAdd: value })} />
                    <RigRange label="Shoulder width" value={outfitRig.torso.shoulderAdd} {...FIGHTER_OUTFIT_RIG_BOUNDS.torso.shoulderAdd} step={0.25} suffix="px" onChange={(value) => patchRigTorso({ shoulderAdd: value })} />
                    <RigRange label="Hem drop" value={outfitRig.torso.hemDrop} {...FIGHTER_OUTFIT_RIG_BOUNDS.torso.hemDrop} step={0.5} suffix="px" onChange={(value) => patchRigTorso({ hemDrop: value })} />
                    <RigSelect label="Torso detail" value={outfitRig.torso.detail} options={FIGHTER_TORSO_DETAILS} onChange={(value) => patchRigTorso({ detail: value })} />
                    <RigRange label="Detail weight" value={outfitRig.torso.detailWeight} {...FIGHTER_OUTFIT_RIG_BOUNDS.torso.detailWeight} step={0.1} suffix="×" onChange={(value) => patchRigTorso({ detailWeight: value })} />
                  </div>
                )}

                {rigPart === 'arms' && (
                  <div class="fed-rig-fields">
                    <RigRange label="Arm width" value={outfitRig.arms.widthAdd} {...FIGHTER_OUTFIT_RIG_BOUNDS.arms.widthAdd} step={0.1} suffix="px" onChange={(value) => patchRigArms({ widthAdd: value })} />
                    <RigRange label="Sleeve coverage" value={outfitRig.arms.sleeveLength} {...FIGHTER_OUTFIT_RIG_BOUNDS.arms.sleeveLength} step={0.05} suffix="ratio" onChange={(value) => patchRigArms({ sleeveLength: value })} />
                    <RigRange label="Sleeve width" value={outfitRig.arms.sleeveWidthAdd} {...FIGHTER_OUTFIT_RIG_BOUNDS.arms.sleeveWidthAdd} step={0.1} suffix="px" onChange={(value) => patchRigArms({ sleeveWidthAdd: value })} />
                    <RigSelect<RigColorRole> label="Arm color" value={outfitRig.arms.baseColor} options={FIGHTER_COLOR_ROLES} onChange={(value) => patchRigArms({ baseColor: value })} />
                    <RigSelect<RigColorRole> label="Sleeve color" value={outfitRig.arms.sleeveColor} options={FIGHTER_COLOR_ROLES} onChange={(value) => patchRigArms({ sleeveColor: value })} />
                  </div>
                )}

                {rigPart === 'legs' && (
                  <div class="fed-rig-fields fed-rig-endpoints">
                    <h3>Legs</h3>
                    <RigRange label="Leg width" value={outfitRig.legs.widthAdd} {...FIGHTER_OUTFIT_RIG_BOUNDS.legs.widthAdd} step={0.1} suffix="px" onChange={(value) => patchRigLegs({ widthAdd: value })} />
                    <RigSelect<RigColorRole> label="Leg color" value={outfitRig.legs.color} options={FIGHTER_COLOR_ROLES} onChange={(value) => patchRigLegs({ color: value })} />
                    <RigSelect label="Leg detail" value={outfitRig.legs.accent} options={FIGHTER_LEG_ACCENTS} onChange={(value) => patchRigLegs({ accent: value })} />

                    <h3>Hands</h3>
                    <RigSelect label="Hand shape" value={outfitRig.hands.shape} options={FIGHTER_HAND_SHAPES} onChange={(value) => patchRigHands({ shape: value })} />
                    <RigRange label="Hand size" value={outfitRig.hands.radius} {...FIGHTER_OUTFIT_RIG_BOUNDS.hands.radius} step={0.1} suffix="px" onChange={(value) => patchRigHands({ radius: value })} />
                    <RigSelect<RigColorRole> label="Hand color" value={outfitRig.hands.color} options={FIGHTER_COLOR_ROLES} onChange={(value) => patchRigHands({ color: value })} />
                    <RigRange label="Cuff length" value={outfitRig.hands.cuffLength} {...FIGHTER_OUTFIT_RIG_BOUNDS.hands.cuffLength} step={0.25} suffix="px" onChange={(value) => patchRigHands({ cuffLength: value })} />

                    <h3>Feet</h3>
                    <div class="fed-foot-presets" role="group" aria-label="Footwear presets">
                      <span>Quick presets</span>
                      <div>
                        {FOOT_PRESET_OPTIONS.map(({ id, label }) => (
                          <button
                            type="button"
                            key={id}
                            aria-pressed={activeFootPreset === id}
                            class={activeFootPreset === id ? 'fed-on' : ''}
                            onClick={() => applyFootPreset(id)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <small>Heel and ankle overlap are automatic; use advanced tuning for toe and upper shape.</small>
                    </div>
                    <details class="fed-rig-advanced">
                      <summary>Advanced foot tuning</summary>
                      <div class="fed-rig-fields">
                        <RigSelect
                          label="Foot style"
                          value={outfitRig.feet.shape}
                          options={FIGHTER_FOOT_SHAPES}
                          onChange={(value) => applyFootPreset(FOOT_PRESET_FOR_SHAPE[value])}
                        />
                        {outfitRig.feet.shape !== 'none' && (
                          <>
                            <RigRange label="Toe extension" value={outfitRig.feet.lengthAdd} {...FIGHTER_OUTFIT_RIG_BOUNDS.feet.lengthAdd} step={0.25} suffix="px" onChange={(value) => patchRigFeet({ lengthAdd: value })} />
                            <RigRange label="Upper height" value={outfitRig.feet.height} {...FIGHTER_OUTFIT_RIG_BOUNDS.feet.height} step={0.25} suffix="px" onChange={(value) => patchRigFeet({ height: value })} />
                            <RigSelect<RigColorRole> label="Foot color" value={outfitRig.feet.color} options={FIGHTER_COLOR_ROLES} onChange={(value) => patchRigFeet({ color: value })} />
                            {outfitRig.feet.shape === 'boot' && (
                              <RigRange
                                label="Shaft height"
                                value={outfitRig.feet.bootLength * 100}
                                min={FIGHTER_OUTFIT_RIG_BOUNDS.feet.bootLength.min * 100}
                                max={FIGHTER_OUTFIT_RIG_BOUNDS.feet.bootLength.max * 100}
                                step={2.5}
                                suffix="% leg"
                                onChange={(value) => patchRigFeet({ bootLength: value / 100 })}
                              />
                            )}
                          </>
                        )}
                      </div>
                    </details>
                  </div>
                )}
              </fieldset>

              <label class="fed-rig-guide">
                <input type="checkbox" checked={showSkeleton} onChange={() => setShowSkeleton(!showSkeleton)} />
                Show articulated skeleton guide
              </label>

              <div class="fed-rig-actions">
                <button type="button" disabled={!rigDirty || rigSaving} onClick={revertOutfitRig}>Revert draft</button>
                <button type="button" onClick={() => void copyOutfitRig()}>Copy JSON</button>
                <button
                  type="button"
                  class="fed-rig-save"
                  disabled={!rigDirty || rigLoading || rigSaving || !rigRevision}
                  onClick={() => void saveOutfitRig()}
                >
                  {rigSaving ? 'Saving…' : `Save ${appearance.outfit} globally`}
                </button>
              </div>

              {rigLoading && <div class="fed-status" role="status">Loading outfit rigs…</div>}
              {rigMessage && <div class="fed-status fed-success" role="status">{rigMessage}</div>}
              {rigError && <div class="fed-status fed-error" role="alert">{rigError}</div>}
              {anyRigDirty && (
                <div class="fed-rig-dirty" role="status">
                  Unsaved global rig edits
                  {FIGHTER_OUTFIT_IDS.filter((id) => !sameRig(rigDrafts[id], rigSaved[id])).map((id) => ` · ${id}`)}
                </div>
              )}
              {rigFile && <div class="fed-rig-file" title={rigFile}>source · {rigFile}</div>}
            </div>
          </details>

          <section class="fed-panel">
            <h2>Pose</h2>
            <label class="fed-field">
              <span>Pose</span>
              <select value={pose} onChange={(event) => setPose((event.target as HTMLSelectElement).value as FighterPose)}>
                {FIGHTER_POSES.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <div class="fed-field">
              <span>Facing</span>
              <div class="fed-segmented">
                <button aria-pressed={facing === 1} class={facing === 1 ? 'fed-on' : ''} onClick={() => setFacing(1)}>Right</button>
                <button aria-pressed={facing === -1} class={facing === -1 ? 'fed-on' : ''} onClick={() => setFacing(-1)}>Left</button>
              </div>
            </div>
            <label class="fed-field">
              <span>Move progress · {moveT.toFixed(3)}s</span>
              <input
                type="range"
                min={0}
                max={MAX_MOVE_T}
                step={0.005}
                value={moveT}
                disabled={playing}
                onInput={(event) => setMoveT(Number((event.target as HTMLInputElement).value))}
              />
            </label>
            <div class="fed-preview-toggles">
              <button aria-pressed={playing} class={playing ? 'fed-on' : ''} onClick={() => setPlaying(!playing)}>
                {playing ? 'Pause animation' : 'Play animation'}
              </button>
              <label>
                <input type="checkbox" checked={flash} onChange={() => setFlash(!flash)} /> Damage flash
              </label>
            </div>
          </section>

          <div class="fed-actions">
            <button onClick={copyCharacter}>Copy Character JSON</button>
            <button onClick={copyUrl}>Copy URL</button>
            <button onClick={exportPng}>Export PNG</button>
            <button
              class="fed-primary"
              disabled={!gameId || !spec || saving || !validName(appearance.name) || appearance.colorSlot > slotMax}
              onClick={() => void applyToGame()}
            >
              {saving ? 'Applying…' : 'Apply to game'}
            </button>
          </div>
          {loading && <div class="fed-status" role="status">Loading fighter game…</div>}
          {message && <div class="fed-status fed-success" role="status">{message}</div>}
          {error && <div class="fed-status fed-error" role="alert">{error}</div>}
          {warnings.length > 0 && (
            <div class="fed-warnings">
              <strong>Saved with lint warnings</strong>
              {warnings.map((warning) => (
                <div key={`${warning.code}:${warning.path}`}>{warning.code}: {warning.message}</div>
              ))}
            </div>
          )}
        </aside>

        <main class="fed-workspace">
          <section class="fed-preview-panel">
            <div class="fed-preview-heading">
              <div>
                <h2>{appearance.name || 'Unnamed fighter'}</h2>
                <span>{appearance.build} · {appearance.outfit} · slot {appearance.colorSlot.toString(16)}</span>
              </div>
              <span class="fed-native-size">native {PREVIEW_W}×{PREVIEW_H}</span>
            </div>
            <canvas
              ref={previewRef}
              class="fed-preview-canvas"
              role="img"
              aria-label={`${appearance.name || 'Fighter'} in the ${pose} pose, facing ${facing === 1 ? 'right' : 'left'}`}
            />
          </section>

          <section class="fed-sheet-panel">
            <div class="fed-preview-heading">
              <div>
                <h2>All production poses</h2>
                <span>same renderer, build, outfit, palette, facing, and likeness</span>
              </div>
            </div>
            <canvas
              ref={sheetRef}
              class="fed-sheet-canvas"
              role="img"
              aria-label={`All production poses for ${appearance.name || 'the fighter'}`}
            />
          </section>
        </main>
      </div>
    </div>
  );
}
