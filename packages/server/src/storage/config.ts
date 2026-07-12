// config.json management. Created with commented defaults on first run
// (JSON with a sibling .md explainer since JSON can't hold comments), then
// read/merged with defaults so upgrades add new keys safely.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_KEYBOARD_MAP,
  DEFAULT_MODEL,
  DEFAULT_PRICING,
  IDEA_CARDS,
  STAGE_NAMES,
  type SparkadeConfig,
  type StageName,
} from '@sparkade/shared';
import { atomicWriteFile, ensureDir } from '../util';

export function defaultConfig(): SparkadeConfig {
  const stages = {} as Record<StageName, { provider: string; model: string; reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' }>;
  for (const s of STAGE_NAMES) stages[s] = { provider: 'meta', model: DEFAULT_MODEL };
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
    likeness: { describeInStory: false },
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
  reasoningEffort (meta only): muse-spark-1.1 is a reasoning model; "low" is fast and cheap,
  "medium"/"high" think longer per call (better designs, more output-priced tokens).
- stages: which provider+model runs each pipeline stage (design/levels/entities/music/repair/stt).
- pricing: USD per million tokens, per model. Jobs snapshot these rows; editing prices never rewrites history.
  A model missing from this table shows "cost unavailable" (never $0.00).
- likeness.describeInStory: when true, the design stage may see the player's photo to reference
  appearance in the story (observable features only). Ships OFF; the photo never leaves the device otherwise.
- presets: the six idea cards shown in the New Game wizard.
- audio: shell + engine volumes (also editable in Settings).
- input: saved control mappings (managed by the remap wizard; keys are KeyboardEvent codes or b<n>/a<n>+/-).
`;

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
      if (typeof next !== 'object' || next === null) throw new Error(`config path not found: ${path}`);
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
    likeness: { ...defaults.likeness, ...(onDisk.likeness ?? {}) },
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
