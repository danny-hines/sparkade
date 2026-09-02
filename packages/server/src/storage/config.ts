// config.json management. Created with commented defaults on first run
// (JSON with a sibling .md explainer since JSON can't hold comments), then
// read/merged with defaults so upgrades add new keys safely.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_KEYBOARD_MAP,
  DEFAULT_MODEL,
  DEFAULT_PRICING,
  DEFAULT_STT_MODEL,
  IDEA_CARDS,
  STAGE_NAMES,
  type SparkadeConfig,
  type StageName,
} from '@sparkade/shared';
import { atomicWriteFile, ensureDir } from '../util';

export function defaultConfig(): SparkadeConfig {
  const stages = {} as Record<
    StageName,
    { provider: string; model: string; reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' }
  >;
  for (const s of STAGE_NAMES) stages[s] = { provider: 'meta', model: DEFAULT_MODEL };
  stages.stt = { provider: 'meta', model: DEFAULT_STT_MODEL };
  // Levels are the slowest call; validators guard their quality, so spend the
  // model's time writing tiles instead of deliberating about them.
  stages.levels.reasoningEffort = 'minimal';
  return {
    providers: {
      meta: {
        kind: 'meta',
        baseUrl: 'https://api.meta.ai/v1',
        apiKeyEnv: 'META_API_KEY',
        capabilities: { structuredOutput: true, audioIn: true, imageIn: true },
        reasoningEffort: 'low',
      },
      compat: {
        kind: 'openai-compatible',
        baseUrl: '',
        apiKeyEnv: 'COMPAT_API_KEY',
        capabilities: { structuredOutput: false, audioIn: false, imageIn: false },
      },
      anthropic: {
        kind: 'anthropic',
        apiKeyEnv: 'ANTHROPIC_API_KEY',
        capabilities: { structuredOutput: false, audioIn: false, imageIn: true },
      },
      mock: { kind: 'mock' },
    },
    stages,
    pricing: { ...DEFAULT_PRICING },
    imageGeneration: {
      baseUrl: 'https://api.meta.ai/v1',
      model: 'muse-image-1.0',
      apiKeyEnv: 'META_API_KEY',
      pricePerImageUsd: 0.01,
      size: '1536x1024',
      timeoutMs: 120_000,
    },
    likeness: {
      describeInStory: false,
    },
    presets: IDEA_CARDS.map((c) => ({ ...c })),
    audio: { musicVol: 0.7, sfxVol: 0.8, uiVol: 0.4 },
    input: { gamepad: {}, keyboard: { ...DEFAULT_KEYBOARD_MAP } },
    devices: {},
  };
}

const CONFIG_EXPLAINER = `# config.json
Edit with \`sparkade config edit\` (or any editor; restart the service after).

- providers: adapter definitions. "kind": meta | openai-compatible | anthropic | mock.
  API keys are NEVER stored here — set the env var named by apiKeyEnv in /etc/sparkade/env (Pi) or .env (dev).
  capabilities tell the pipeline what to send: structuredOutput (native JSON-Schema mode), audioIn (native transcription), imageIn.
  reasoningEffort (meta only): Muse Spark is a reasoning model; "low" is fast and cheap,
  "medium"/"high" think longer per call (better designs, more output-priced tokens).
- stages: which provider+model runs each pipeline stage (design/levels/entities/music/repair/stt).
  Text stages default to muse-spark-1.3-contributor; stt defaults to muse-voice-transcribe-1.0.
  Contributor-tier inputs and responses may be used by Meta for model training; choose another
  configured model/provider if that is unsuitable.
- pricing: token models use USD per million tokens; speech models use USD per processed audio hour.
  Jobs snapshot these rows; editing prices never rewrites history.
  A model missing from this table shows "cost unavailable" (never $0.00).
- imageGeneration: Muse Image configuration used by every generated game. The default is
  muse-image-1.0 through Meta's Model API at $0.01 per returned image. It authors library key art,
  intro/boss/victory/defeat scenes, and—when a photo is supplied—the neutral and defeat-expression
  portraits plus player sprites.
  There is intentionally no kiosk toggle or pixel-photo fallback: photo games require the generated
  portrait/player head to pass validation. Fighter art is a required five-character quality gate;
  an incomplete roster fails the job and remains retryable.
- likeness.describeInStory: when true, the design stage may see the player's photo to reference
  appearance in the story (observable features only). Ships OFF. The default hero-generation flow
  still sends an accepted photo to Meta's APIs, as disclosed in the wizard.
- presets: the six idea cards shown in the New Game wizard.
- audio: shell + engine volumes (also editable in Settings).
- input: saved control mappings (managed by the remap wizard; keys are KeyboardEvent codes or b<n>/a<n>+/-).
`;

const HISTORICAL_DEFAULT_TEXT_MODELS = new Set(['muse-spark-1.1', 'muse-spark-1.2-contributor']);

/** Upgrade only known historical Meta defaults. Models on another provider
 * and unrecognized Meta model ids are intentional customizations. */
function migrateDefaultStages(onDisk: Partial<SparkadeConfig>): boolean {
  let changed = false;
  for (const stage of STAGE_NAMES) {
    if (stage === 'stt') continue;
    const row = onDisk.stages?.[stage];
    if (row?.provider === 'meta' && HISTORICAL_DEFAULT_TEXT_MODELS.has(row.model)) {
      row.model = DEFAULT_MODEL;
      changed = true;
    }
  }
  // Sparkade used the general reasoning model for STT before Meta shipped its
  // dedicated voice model. Upgrade only the untouched Meta default; custom
  // providers and model ids remain authoritative.
  const stt = onDisk.stages?.stt;
  if (
    stt?.provider === 'meta' &&
    (stt.model === DEFAULT_MODEL || HISTORICAL_DEFAULT_TEXT_MODELS.has(stt.model))
  ) {
    stt.model = DEFAULT_STT_MODEL;
    changed = true;
  }
  return changed;
}

export class ConfigStore {
  private config: SparkadeConfig;
  private path: string;

  constructor(private dir: string) {
    ensureDir(dir);
    this.path = join(dir, 'config.json');
    if (!existsSync(this.path)) {
      this.config = defaultConfig();
      atomicWriteFile(this.path, JSON.stringify(this.config, null, 2));
      writeFileSync(join(dir, 'config.explained.md'), CONFIG_EXPLAINER);
    } else {
      const onDisk = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<SparkadeConfig>;
      if (migrateDefaultStages(onDisk)) {
        // Persist the narrowly migrated source config, not the merged defaults,
        // so an upgrade does not rewrite any unrelated user-owned settings.
        atomicWriteFile(this.path, JSON.stringify(onDisk, null, 2));
      }
      this.config = mergeConfig(defaultConfig(), onDisk);
    }
  }

  get(): SparkadeConfig {
    return this.config;
  }

  /** Shallow-path update ("audio.musicVol", "stages.design.model", …) + persist. */
  set(path: string, value: unknown): void {
    const parts = path.split('.');
    let target: Record<string, unknown> = this.config as unknown as Record<string, unknown>;
    for (const part of parts.slice(0, -1)) {
      const next = target[part];
      if (typeof next !== 'object' || next === null)
        throw new Error(`config path not found: ${path}`);
      target = next as Record<string, unknown>;
    }
    target[parts[parts.length - 1]!] = value;
    this.save();
  }

  update(mutate: (c: SparkadeConfig) => void): void {
    mutate(this.config);
    this.save();
  }

  save(): void {
    atomicWriteFile(this.path, JSON.stringify(this.config, null, 2));
  }
}

function mergeConfig(defaults: SparkadeConfig, onDisk: Partial<SparkadeConfig>): SparkadeConfig {
  // Provider/pricing rows deep-merge per key: user edits win, but NEW default
  // fields (e.g. cachedInputPerM, reasoningEffort added after install) flow
  // into existing configs instead of being lost to a whole-row overwrite.
  const mergeRows = <T extends Record<string, object>>(def: T, disk?: Partial<T>): T => {
    const out: Record<string, object> = { ...def };
    for (const [key, row] of Object.entries(disk ?? {})) {
      out[key] = { ...(def[key] ?? {}), ...(row as object) };
    }
    return out as T;
  };
  const merged: SparkadeConfig = {
    ...defaults,
    ...onDisk,
    providers: mergeRows(defaults.providers, onDisk.providers),
    stages: mergeRows(defaults.stages, onDisk.stages),
    pricing: mergeRows(defaults.pricing, onDisk.pricing),
    imageGeneration: {
      ...defaults.imageGeneration,
      ...(onDisk.imageGeneration ?? {}),
    },
    // Deliberately discard retired smart/style/portraitGen keys from the live
    // config. Existing files remain readable without reviving old fallbacks.
    likeness: {
      describeInStory: onDisk.likeness?.describeInStory ?? defaults.likeness.describeInStory,
    },
    presets: onDisk.presets ?? defaults.presets,
    audio: { ...defaults.audio, ...(onDisk.audio ?? {}) },
    input: {
      gamepad: onDisk.input?.gamepad ?? defaults.input.gamepad,
      keyboard: onDisk.input?.keyboard ?? defaults.input.keyboard,
    },
    devices: { ...defaults.devices, ...(onDisk.devices ?? {}) },
  };
  return merged;
}
