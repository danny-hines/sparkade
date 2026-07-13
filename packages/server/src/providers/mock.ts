// Mock provider: returns golden-game fixtures with artificial stage delays and
// fake usage numbers, traveling through the SAME durable pipeline, validators,
// persistence, SSE and cost ledger as a real provider. Powers `npm run demo`,
// zero-spend UI development, and the e2e suite (SPARKADE_MOCK_FAST=1 shrinks
// the delays).
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ArchetypeId,
  CompleteRequest,
  CompleteResponse,
  DesignDoc,
  GameSpec,
  Provider,
  ProviderCapabilities,
  ProviderUsage,
} from '@sparkade/shared';
import { repoRoot, readJson, sleep } from '../util';

const VARIANTS = ['Turbo', 'Neon', 'Super', 'Hyper', 'Mega', 'Cosmic', 'Ultra', 'Prisma'];

const CANNED_TRANSCRIPTS = [
  'A brave little robot climbs a clockwork tower to wake the sun',
  'I want to be a space gardener defending my greenhouse from asteroid weeds',
  'A knight made of jelly explores a candy dungeon looking for the lost spoon',
  'Fly a paper plane through a thunderstorm and unplug the storm king',
];

export class MockProvider implements Provider {
  readonly kind = 'mock' as const;
  readonly capabilities: ProviderCapabilities = {
    structuredOutput: true,
    audioIn: true,
    imageIn: true,
  };
  private goldens = new Map<ArchetypeId, GameSpec>();
  private counter = 0;

  constructor(readonly name: string) {
    const dir = join(repoRoot(), 'packages', 'generation', 'golden');
    try {
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        const spec = readJson<GameSpec>(join(dir, f));
        if (spec) this.goldens.set(spec.archetype, spec);
      }
    } catch {
      /* goldens missing — complete() will throw a clear error */
    }
  }

  private async delay(): Promise<void> {
    const fast = process.env.SPARKADE_MOCK_FAST === '1';
    await sleep(fast ? 80 + Math.random() * 120 : 1500 + Math.random() * 2500);
  }

  private usage(): ProviderUsage {
    return {
      input: 2800 + Math.floor(Math.random() * 3000),
      output: 2200 + Math.floor(Math.random() * 2800),
    };
  }

  private golden(archetype: ArchetypeId): GameSpec {
    const g = this.goldens.get(archetype);
    if (!g) throw new Error(`mock provider: golden game for "${archetype}" not found on disk`);
    return g;
  }

  async complete(req: CompleteRequest): Promise<CompleteResponse> {
    await this.delay();
    const stage = detectStage(req);
    const archetype = detectArchetype(req) ?? this.pickArchetype(req.user);
    const golden = this.golden(archetype);
    this.counter++;

    let payload: unknown;
    switch (stage) {
      case 'design': {
        const variant = VARIANTS[(this.counter + req.user.length) % VARIANTS.length]!;
        const design: DesignDoc = {
          title: clamp(`${variant} ${golden.meta.title}`, 32),
          tagline: golden.meta.tagline,
          archetype,
          palette: [...golden.palette],
          heroConcept: 'A plucky hero shaped by the player idea',
          story: structuredClone(golden.story),
          levelPlan: [
            { name: 'Opening', summary: 'Learn the ropes in a gentle first stretch' },
            { name: 'Rising', summary: 'The middle act turns up the pressure' },
            { name: 'Gauntlet', summary: 'Everything the world has learned about you' },
            { name: 'The Boss', summary: 'A showdown with the big bad' },
          ],
          cast: [
            { role: 'walker', concept: 'A grumpy ground patroller' },
            { role: 'flyer', concept: 'A swooping nuisance' },
            { role: 'shooter', concept: 'A lobbing turret' },
            { role: 'chaser', concept: 'A fast, angry pursuer' },
          ],
          musicBrief: {
            key: golden.music.key,
            bpm: golden.music.bpm,
            themeMood: 'bright and driving',
            bossMood: 'urgent and heavy',
          },
          scoring: structuredClone(golden.scoring),
          difficulty: 'standard',
        };
        payload = design;
        break;
      }
      case 'levels':
        payload = { levels: structuredClone(golden.levels) };
        break;
      case 'entities':
        payload = {
          sprites: structuredClone(golden.sprites),
          boss: structuredClone(golden.boss),
          ...(golden.sfx ? { sfx: structuredClone(golden.sfx) } : {}),
        };
        break;
      case 'music':
        payload = { music: structuredClone(golden.music) };
        break;
      case 'repair':
        // Deliberately minimal: an empty JSON Patch (goldens never need repair).
        payload = [];
        break;
    }
    return { text: JSON.stringify(payload), usage: this.usage() };
  }

  async transcribe(audio: Buffer): Promise<{ text: string; usage: ProviderUsage }> {
    await this.delay();
    const pick = CANNED_TRANSCRIPTS[audio.length % CANNED_TRANSCRIPTS.length]!;
    return { text: pick, usage: { input: 900, output: 30 } };
  }

  private pickArchetype(prompt: string): ArchetypeId {
    const p = prompt.toLowerCase();
    if (/(r-?type|gradius|side.?scroll|horizontal|cavern.?flight|through the (cave|tunnel))/.test(p)) return 'hshooter';
    if (/(shoot|ship|space|plane|fly|blast)/.test(p)) return 'shooter';
    if (/(dungeon|explore|zelda|adventure|museum|quest|garden(?!.*(defend|orbit)))/.test(p)) return 'adventure';
    if (/(platform|jump|climb|run|tower|mountain)/.test(p)) return 'platformer';
    const all: ArchetypeId[] = ['platformer', 'shooter', 'adventure', 'hshooter'];
    return all[prompt.length % all.length]!;
  }
}

type MockStage = 'design' | 'levels' | 'entities' | 'music' | 'repair';

/** Stage detection from schema titles / prompt markers the templates always include. */
function detectStage(req: CompleteRequest): MockStage {
  const title = String((req.jsonSchema as { title?: string } | undefined)?.title ?? '');
  const hay = `${title}\n${req.system.slice(0, 400)}`;
  if (/design pass/i.test(hay)) return 'design';
  if (/levels stage/i.test(hay)) return 'levels';
  if (/entities stage/i.test(hay)) return 'entities';
  if (/music stage/i.test(hay)) return 'music';
  if (/JSON Patch|repair/i.test(hay)) return 'repair';
  return 'design';
}

function detectArchetype(req: CompleteRequest): ArchetypeId | null {
  const title = String((req.jsonSchema as { title?: string } | undefined)?.title ?? '');
  const hay = `${title}\n${req.system.slice(0, 400)}`;
  const m = /(hshooter|horizontal shooter|platformer|shooter|adventure)/i.exec(hay);
  if (!m) return null;
  const w = m[1]!.toLowerCase();
  return (w === 'horizontal shooter' ? 'hshooter' : w) as ArchetypeId;
}

function clamp(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n);
}
