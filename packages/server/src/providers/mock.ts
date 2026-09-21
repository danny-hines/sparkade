import { fighterStyleExample, type FighterCombatProfile } from '@sparkade/shared';
import { type ShooterPlayStyle } from '@sparkade/shared';
// Mock provider: returns golden-game fixtures with artificial stage delays and
// fake usage numbers, traveling through the SAME durable pipeline, validators,
// persistence, SSE and cost ledger as a real provider. Powers `npm run demo`,
// zero-spend UI development, and the e2e suite (SPARKADE_MOCK_FAST=1 shrinks
// the delays).
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { mockEncounterLevels } from './mock-encounters';
import {
  adventureStyleExample,
  shooterStyleExample,
  platformerStyleExample,
} from '@sparkade/archetypes';
import {
  PLATFORMER_PLAY_STYLES,
  platformerMechanics,
  type PlatformerPlayStyle,
} from '@sparkade/shared';
import type {
  ArchetypeId,
  CompleteRequest,
  CompleteResponse,
  DesignDoc,
  GameSpec,
  Provider,
  ProviderCapabilities,
  ProviderUsage,
  RacingElevation,
  RacingIdentity,
  RacingSpec,
  RacingTraversal,
} from '@sparkade/shared';

/**
 * True when the creation request asks for jet skiing / personal watercraft /
 * an explicitly water-racing cup. The mock mirrors the design-stage contract:
 * only such premises earn the jetski discipline.
 */
export function mockJetskiRequested(requestText: string): boolean {
  if (/jet[ -]?ski|personal watercraft|wave[ -]?runn/i.test(requestText)) return true;
  if (/\bhover(?:craft)?\b|\bkart\b/i.test(requestText)) return false;
  return /\bwater[ -]?rac(?:e|ing)\b|\brac(?:e|ing)\s+(?:on|across|through)\s+(?:the\s+)?water\b/i.test(
    requestText,
  );
}

/** Hero name from the approved creation brief block, when the caller supplied one. */
export function mockBriefHeroName(user: string): string | null {
  const hit = /HERO NAME:\s*([^\n]+)/i.exec(user);
  if (!hit) return null;
  const name = hit[1]!.trim();
  if (!name || /\(Spark decides\)/i.test(name)) return null;
  return name.slice(0, 48);
}

/** Mock-only translation fixtures. The live model authors these axes; neither
 * the runtime nor image routing branches on an activity name. Explicit axes
 * allow tests to exercise invented activities without adding a named preset. */
export function mockTraversalRequested(text: string): RacingTraversal | undefined {
  const handling = /\bhandling[\s:=]+(direct|grip|carve|flow)\b/i.exec(text)?.[1]?.toLowerCase();
  const surface = /\bsurface[\s:=]+(ground|water)\b/i.exec(text)?.[1]?.toLowerCase();
  const rider = /\brider[\s:=]+(none|seated|standing|onFoot)\b/i.exec(text)?.[1];
  const propulsion = /\bpropulsion[\s:=]+(motor|human|magic)\b/i.exec(text)?.[1]?.toLowerCase();
  if (handling && surface && rider && propulsion) {
    return {
      ...(/\bmotion[\s:=]+(static|pedal|stride|push|pulse)\b/i.exec(text)?.[1] ? { motion: /\bmotion[\s:=]+(static|pedal|stride|push|pulse)\b/i.exec(text)![1]!.toLowerCase() } : {}),
      label: 'Open Racing',
      handling,
      surface,
      rider: rider.toLowerCase() === 'onfoot' ? 'onFoot' : rider.toLowerCase(),
      propulsion,
    } as RacingTraversal;
  }
  if (/\bbicycle|\bcycling\b/i.test(text))
    return {
      label: 'Cycle Sprint',
      handling: 'grip',
      surface: 'ground',
      rider: 'seated',
      propulsion: 'human',
    };
  if (/\bmotorcycle\b/i.test(text))
    return {
      label: 'Moto Sprint',
      handling: 'grip',
      surface: 'ground',
      rider: 'seated',
      propulsion: 'motor',
    };
  if (/\bskateboard/i.test(text))
    return {
      label: 'Street Carve',
      handling: 'carve',
      surface: 'ground',
      rider: 'standing',
      propulsion: 'human',
    };
  return undefined;
}

/**
 * Bounded hill selection from an explicit request. The live model authors
 * these; the mock only translates obvious asks so tests can exercise the
 * complete generation contract. Returns undefined (legacy flat omission)
 * for anything else.
 */
export function mockElevationRequested(text: string): RacingElevation | undefined {
  if (/\bridge\b/i.test(text)) return 'ridge';
  if (/\brolling\b|\bhills?\b|\belevation\b/i.test(text)) return 'rolling';
  return undefined;
}

/**
 * Bounded ramp selection from an explicit request. Returns undefined (legacy
 * omission) unless the request plainly asks for jumps or ramps.
 */
export function mockJumpsRequested(text: string): 'ramps' | undefined {
  if (/\bramps?\b|\bjumps?\b|\bairborne\b/i.test(text)) return 'ramps';
  return undefined;
}

/**
 * Racing identity for the mock design stage: the golden's authored contract
 * when it has one, else a deterministic legacy-shape pads fallback derived
 * from the golden's own cast (same names, same slots). A jetski creation
 * request earns a deterministic jetski cup (combustion motors, floating
 * Tide-Cell pickups, seated-rider watercraft concepts) so integration tests
 * can exercise photo/name/details all the way to the final identity.
 */
function mockRacingIdentity(golden: GameSpec, requestText = '', user = ''): RacingIdentity {
  const briefName = user ? mockBriefHeroName(user) : null;
  const traversal = mockTraversalRequested(requestText);
  if (traversal) {
    const identity = mockRacingIdentity(golden, '', user);
    const subject =
      traversal.rider === 'onFoot'
        ? 'adult runner'
        : traversal.rider === 'none'
          ? 'unoccupied racing conveyance'
          : `${traversal.rider} adult rider with a racing conveyance`;
    return {
      ...identity,
      pilotName: briefName ?? identity.pilotName,
      traversal,
      discipline: traversal.surface === 'water' ? 'jetski' : 'hover',
      worldConcept: `A distinctive ${traversal.surface} racing world for ${requestText.replace(/[^ -~]+/g, ' ').slice(0, 200)}`,
      playerCraftConcept: `Teal ${subject}, rear view, ${traversal.propulsion} propulsion`,
      rivalCrafts: identity.rivalCrafts.map((r, k) => ({
        ...r,
        vehicleConcept: `Distinct ${['coral', 'gold', 'violet', 'blue'][k]} ${subject}, rear view, ${traversal.propulsion} propulsion`,
      })),
    };
  }
  if (mockJetskiRequested(requestText)) {
    const cast = ['VEX', 'JUNO', 'PIP', 'KAZ'];
    const hulls = [
      'teal compact jet-ski hull with orange trim and a seated rider in a white vest, rear view',
      'pearl-white jet-ski hull with coral side pods and a seated rider in a coral vest, rear view',
      'mint-green jet-ski hull with a yellow checker tail and a seated rider in a navy vest, rear view',
      'deep violet jet-ski hull with gold trim and a seated rider in a black vest, rear view',
    ];
    return {
      pilotName: briefName ?? 'RIN',
      artDirection:
        'Sunlit turquoise water cup: glossy hulls, orange buoys, sand and vegetated banks',
      worldConcept:
        'A sunlit jet-ski cup across a limestone lagoon, a stilt-house harbor, and emerald mangroves at sunset',
      playerCraftConcept:
        'Privateer turquoise jet-ski hull with orange trim and a seated rider in a white vest, compact hull touching turquoise water, rear view',
      rivalCrafts: cast.map((name, k) => ({ name, vehicleConcept: hulls[k]! })),
      sound: { engine: { family: 'combustion', tone: 0.7, pitch: 2 } },
      boost: {
        mode: 'pickups',
        displayName: 'Tide Cells',
        appearanceConcept: 'Small floating turquoise energy cells bobbing on the water surface',
      },
      discipline: 'jetski',
    };
  }
  if (golden.archetype === 'racing') {
    const spec = golden as RacingSpec;
    if (spec.identity) return structuredClone(spec.identity);
    const cast = (spec.levels[0]?.rivals ?? []).map((rival) => ({
      name: rival.name,
      vehicleConcept: `${rival.name} cup rival hovercraft in a distinct helmet-color livery, rear-view wedge silhouette`,
    }));
    while (cast.length < 4)
      cast.push({
        name: `RIVAL${cast.length + 1}`,
        vehicleConcept: 'Spare cup hovercraft in reserve livery',
      });
    return {
      pilotName: briefName ?? 'ROOKIE',
      artDirection: 'Flat-shaded procedural hover cup in the template theme colors',
      worldConcept: 'A legacy-rules hover cup run on the three proven circuits',
      playerCraftConcept: 'Privateer twin-pod hovercraft in track-day colors, rear-view silhouette',
      rivalCrafts: cast.slice(0, 4),
      sound: { engine: { family: 'electric' } },
      boost: {
        mode: 'pads',
        displayName: 'Surge Pads',
        appearanceConcept: 'Glowing accent chevron strips painted across the racing line',
      },
    };
  }
  const fallback = ['VEX', 'JUNO', 'PIP', 'KAZ'].map((name) => ({
    name,
    vehicleConcept: `${name} cup rival hovercraft in a distinct helmet-color livery, rear-view wedge silhouette`,
  }));
  return {
    pilotName: briefName ?? 'ROOKIE',
    artDirection: 'Flat-shaded procedural hover cup in the template theme colors',
    worldConcept: 'A legacy-rules hover cup run on the three proven circuits',
    playerCraftConcept: 'Privateer twin-pod hovercraft in track-day colors, rear-view silhouette',
    rivalCrafts: fallback,
    sound: { engine: { family: 'electric' } },
    boost: {
      mode: 'pads',
      displayName: 'Surge Pads',
      appearanceConcept: 'Glowing accent chevron strips painted across the racing line',
    },
  };
}
import type { FaceFeatures } from '../likeness/features';
import { repoRoot, readJson, sleep } from '../util';

const VARIANTS = ['Turbo', 'Neon', 'Super', 'Hyper', 'Mega', 'Cosmic', 'Ultra', 'Prisma'];

const CANNED_TRANSCRIPTS = [
  'A brave little robot climbs a clockwork tower to wake the sun',
  'I want to be a space gardener defending my greenhouse from asteroid weeds',
  'A knight made of jelly explores a candy dungeon looking for the lost spoon',
  'Fly a paper plane through a thunderstorm and unplug the storm king',
];

const CANNED_FACES: FaceFeatures[] = [
  {
    skinTone: '#c98f6b',
    hairColor: '#2a2320',
    hairStyle: 'parted',
    facialHairColor: '#2a2320',
    headwearColor: 'none',
    glasses: false,
    headwear: false,
    headwearType: 'none',
    facialHair: 'mustache',
    faceShape: 'oval',
    chin: 'round',
    noseSize: 'medium',
    eyeSpacing: 'average',
    eyeShape: 'almond',
    eyebrows: 'medium',
    eyebrowShape: 'straight',
    ears: 'average',
  },
  {
    skinTone: '#8d5a34',
    hairColor: '#171210',
    hairStyle: 'curly',
    facialHairColor: 'none',
    headwearColor: 'none',
    glasses: true,
    headwear: false,
    headwearType: 'none',
    facialHair: 'none',
    faceShape: 'round',
    chin: 'wide',
    noseSize: 'small',
    eyeSpacing: 'wide',
    eyeShape: 'round',
    eyebrows: 'thick',
    eyebrowShape: 'arched',
    ears: 'small',
  },
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
        // Keep the mock's legacy hover/pads baseline independent of curated
        // starter-game upgrades (riders, hills, ramps and forks are opt-in).
        const path =
          f === 'golden-racing.json'
            ? join(dir, '..', 'fixtures', 'racing-legacy.json')
            : join(dir, f);
        const spec = readJson<GameSpec>(path);
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
    if ((req.jsonSchema as { title?: string } | undefined)?.title === 'SparkadeContentReviewV1') {
      // Mock-only deterministic acceptance; policy cases use explicit verdict fixtures in site tests.
      return { text: '{"decision":"allow","category":"none"}', usage: { input: 100, output: 12 } };
    }
    const stage = detectStage(req);
    const archetype = detectArchetype(req) ?? this.pickArchetype(req.user);
    const source = this.golden(archetype);
    // Follow the actual design JSON on subsequent stages; never match the system's whole catalogue.
    const authoredStyle =
      stage === 'design'
        ? undefined
        : /"playStyle"\s*:\s*"(acrobat|runAndGun|towerClimber|meleeAction|armedClimber)"/.exec(
            req.user,
          )?.[1];
    const requestText = req.user.split('GAMES ALREADY ON THIS CABINET')[0] ?? req.user;
    const requestedStyle =
      authoredStyle ??
      (stage === 'design'
        ? /armed.?climber|mega.?man.?x/i.test(requestText) ||
          (/wall.?jump|tower|climb/i.test(requestText) && /blaster|shoot|gun/i.test(requestText))
          ? 'armedClimber'
          : /wall.?jump|tower|climb.*up/i.test(requestText)
            ? 'towerClimber'
            : /run.and.gun|blaster|mega.?man|shoot.*platform/i.test(requestText)
              ? 'runAndGun'
              : /melee|energy strike|castlevania/i.test(requestText)
                ? 'meleeAction'
                : /PLATFORMER STYLE PREFERENCE[^:]*:\s*(acrobat|runAndGun|towerClimber|meleeAction|armedClimber)/.exec(
                    req.user,
                  )?.[1]
        : undefined);
    const style =
      requestedStyle && PLATFORMER_PLAY_STYLES.includes(requestedStyle as PlatformerPlayStyle)
        ? (requestedStyle as PlatformerPlayStyle)
        : undefined;
    const shooterStyle = (
      stage === 'design'
        ? /lock.?on|missile|lockOnStriker/i.test(requestText)
          ? 'lockOnStriker'
          : /weapon.?switch|switching|spread.*focus|weaponSwitch/i.test(requestText)
            ? 'weaponSwitch'
            : /charge/i.test(requestText)
              ? 'chargeSpecialist'
              : (/VERTICAL SHOOTER STYLE PREFERENCE[^:]*:\s*(weaponSwitch|chargeSpecialist|lockOnStriker)/.exec(
                  req.user,
                )?.[1] ?? 'chargeSpecialist')
        : (/"shooterStyle"\s*:\s*"(weaponSwitch|chargeSpecialist|lockOnStriker)"/.exec(
            req.user,
          )?.[1] ?? 'chargeSpecialist')
    ) as ShooterPlayStyle;
    const adventureStyle = (
      stage === 'design'
        ? /puzzle.?quest|seals|block puzzles/i.test(requestText)
          ? 'puzzleQuest'
          : /rescue/i.test(requestText)
            ? 'rescueRaid'
            : (/ADVENTURE STYLE PREFERENCE[^:]*:\s*(dungeonExpedition|puzzleQuest|rescueRaid)/.exec(
                req.user,
              )?.[1] ?? 'dungeonExpedition')
        : (/"adventureStyle"\s*:\s*"(dungeonExpedition|puzzleQuest|rescueRaid)"/.exec(
            req.user,
          )?.[1] ?? 'dungeonExpedition')
    ) as import('@sparkade/shared').AdventurePlayStyle;
    const fighterStyle = (
      stage === 'design'
        ? /ranged.?control|projectile fighter/i.test(requestText)
          ? 'rangedControl'
          : /counter fighter|timed guard/i.test(requestText)
            ? 'counter'
            : /rushdown/i.test(requestText)
              ? 'rushdown'
              : (/FIGHTER STYLE PREFERENCE[^:]*:\s*(rushdown|counter|rangedControl)/.exec(
                  req.user,
                )?.[1] ?? 'rushdown')
        : (/"fighterStyle"\s*:\s*"(rushdown|counter|rangedControl)"/.exec(req.user)?.[1] ??
          'rushdown')
    ) as FighterCombatProfile;
    const golden =
      source.archetype === 'fighter'
        ? fighterStyleExample(source, fighterStyle)
        : source.archetype === 'platformer' && style
          ? platformerStyleExample(source, style)
          : source.archetype === 'shooter'
            ? shooterStyleExample(source, shooterStyle)
            : source.archetype === 'adventure'
              ? adventureStyleExample(source, adventureStyle)
              : source;
    this.counter++;

    let payload: unknown;
    switch (stage) {
      case 'likeness': {
        // The mock cannot inspect a face, but it must still exercise the exact
        // structured likeness path. Pick deterministically from the image bytes
        // so repeat runs of the same fixture stay stable.
        let discriminator = 0;
        if (req.image) {
          const step = Math.max(1, Math.floor(req.image.length / 128));
          for (let i = 0; i < req.image.length; i += step) {
            discriminator = (Math.imul(discriminator, 33) ^ req.image[i]!) >>> 0;
          }
        }
        payload = structuredClone(CANNED_FACES[discriminator % CANNED_FACES.length]!);
        break;
      }
      case 'design': {
        const variant = VARIANTS[(this.counter + req.user.length) % VARIANTS.length]!;
        const design: DesignDoc = {
          title: clamp(`${variant} ${golden.meta.title}`, 32),
          tagline: golden.meta.tagline,
          archetype,
          palette: [...golden.palette],
          heroConcept:
            golden.archetype === 'fighter'
              ? golden.player.visualConcept
              : golden.archetype === 'racing'
                ? (golden.meta.heroConcept ?? 'Privateer hover pilot in track-day colors')
                : 'An indigo expedition jacket with brass fasteners, sturdy tan trousers, and dark trail boots',
          ...(golden.archetype === 'adventure'
            ? { combatKit: structuredClone(golden.combatKit), adventureStyle }
            : {}),
          ...(archetype === 'hshooter' || archetype === 'shooter'
            ? {
                vehicleConcept:
                  (golden.archetype === 'hshooter' || golden.archetype === 'shooter'
                    ? golden.playerCraft.visualConcept
                    : undefined) ??
                  'The Starling, a low cobalt craft with swept brass fins, a dark bubble canopy, twin amber drives, and a bright forked nose mark',
              }
            : {}),
          ...(golden.archetype === 'fighter'
            ? { fighterArtDirection: structuredClone(golden.artDirection), fighterStyle }
            : {}),
          // Racing identity is exercisable end-to-end: a jetski creation
          // request earns the deterministic jetski cup, else the golden's
          // authored contract when present, else a deterministic pads-mode
          // fallback so legacy goldens still travel the new path.
          ...(archetype === 'racing'
            ? { racingIdentity: mockRacingIdentity(golden, requestText, req.user) }
            : {}),
          story: structuredClone(golden.story),
          levelPlan:
            archetype === 'racing'
              ? (golden.levels as { name: string }[]).map((level, i, all) => ({
                  name: level.name.slice(0, 24),
                  summary: [
                    i < all.length - 1
                      ? `Cup race ${i + 1}: bank points against the field`
                      : 'Finale: take the cup from the lead rival',
                    // Carry an explicit hill/ramp ask into the summaries so
                    // the levels stage can author the bounded course options.
                    ...(mockElevationRequested(requestText)
                      ? [`over ${mockElevationRequested(requestText)} hills`]
                      : []),
                    ...(mockJumpsRequested(requestText) ? ['with jump ramps'] : []),
                    ...(/\bforks?|alternate routes?\b/i.test(requestText) ? ['with fork routes'] : []),
                  ].join(' '),
                }))
              : [
                  { name: 'Opening', summary: 'Learn the ropes in a gentle first stretch' },
                  { name: 'Rising', summary: 'The middle act turns up the pressure' },
                  { name: 'Gauntlet', summary: 'Everything the world has learned about you' },
                  { name: 'The Boss', summary: 'A showdown with the big bad' },
                ],
          cast:
            archetype === 'racing'
              ? ((golden.levels as { rivals: { name: string }[] }[])[0]?.rivals.map((rival, i) => ({
                  role: `rival${i + 1}`,
                  concept: `${rival.name}, cup rival driver with a distinct helmet and livery`,
                })) ?? [])
              : archetype === 'hshooter' || archetype === 'shooter'
                ? [
                    { role: 'popcorn', concept: 'A small disposable cobalt scout' },
                    { role: 'weaver', concept: 'A slim brass-vane interceptor' },
                    { role: 'tank', concept: 'A broad armored hostile gunship' },
                    { role: 'turret', concept: 'A surface-mounted trench cannon' },
                    { role: 'kamikaze', concept: 'A pointed high-speed impact drone' },
                  ]
                : [
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
          abilityLoadout:
            archetype === 'platformer'
              ? golden.archetype === 'platformer'
                ? structuredClone(
                    golden.abilityLoadout ?? [
                      {
                        kind: 'projectile' as const,
                        name: 'Arc Spark',
                        visualConcept:
                          'A bright brass coil that launches a compact blue-white bolt from the hero',
                      },
                    ],
                  )
                : [
                    {
                      kind: 'projectile' as const,
                      name: 'Arc Spark',
                      visualConcept:
                        'A bright brass coil that launches a compact blue-white bolt from the hero',
                    },
                  ]
              : [],
          ...(archetype === 'shooter' ? { shooterStyle } : {}),
          ...(archetype === 'platformer'
            ? {
                playStyle: style ?? ('acrobat' as const),
                presentationFamily: /storybook/i.test(requestText)
                  ? ('storybook' as const)
                  : /tech mission|presentationFamily[^\n]*tech/i.test(requestText)
                    ? ('tech' as const)
                    : /arcade action/i.test(requestText)
                      ? ('arcade' as const)
                      : ((/PLATFORMER PRESENTATION PREFERENCE[^:]*:\s*(storybook|tech|arcade)/.exec(
                          req.user,
                        )?.[1] ?? 'arcade') as 'storybook' | 'tech' | 'arcade'),
                mechanics: platformerMechanics({ playStyle: style }),
                movementProfile: 'precision' as const,
              }
            : {}),
        };
        payload = design;
        break;
      }
      case 'levels': {
        // Racing hills/ramps author from an explicit request only: the clone
        // otherwise preserves legacy omission exactly (no elevation/jumps keys).
        let levels = structuredClone(golden.levels);
        if (golden.archetype === 'racing') {
          const elevation = mockElevationRequested(req.user);
          const jumps = mockJumpsRequested(req.user);
          const forks = /\bforks?|alternate routes?\b/i.test(req.user);
          if (elevation || jumps || forks)
            levels = (levels as RacingSpec['levels']).map((level) => ({
              ...level,
              ...(elevation ? { elevation } : {}),
              ...(jumps ? { jumps } : {}),
              ...(forks ? { forks: 'split' as const, length: 3600, jumps: 'none' as const } : {}),
            }));
        }
        payload = {
          ...(golden.archetype === 'fighter' && golden.player
            ? { player: structuredClone(golden.player) }
            : {}),
          levels:
            golden.archetype === 'platformer' && req.system.includes('`encounterRoute`')
              ? mockEncounterLevels(golden)
              : levels,
        };
        break;
      }
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
    // Saved-game catalogs must not steer the fallback guess either.
    const p = (prompt.split('GAMES ALREADY ON THIS CABINET')[0] ?? prompt).toLowerCase();
    if (
      /\brace\b|racing|kart|\bhover\b|f-?zero|grand.?prix|jet.?ski|personal watercraft|wave.?runn/.test(
        p,
      )
    )
      return 'racing';
    if (
      /(fight|versus|brawl|duel|karate|kung.?fu|boxer|boxing|martial|kombat|tournament.*(fight|duel)|street.?fight)/.test(
        p,
      )
    )
      return 'fighter';
    if (
      /(r-?type|gradius|side.?scroll|horizontal|cavern.?flight|through the (cave|tunnel))/.test(p)
    )
      return 'hshooter';
    if (/(shoot|ship|space|plane|fly|blast)/.test(p)) return 'shooter';
    if (/(dungeon|explore|zelda|adventure|museum|quest|garden(?!.*(defend|orbit)))/.test(p))
      return 'adventure';
    if (/(platform|jump|climb|run|tower|mountain)/.test(p)) return 'platformer';
    const all: ArchetypeId[] = [
      'platformer',
      'shooter',
      'adventure',
      'hshooter',
      'fighter',
      'racing',
    ];
    return all[prompt.length % all.length]!;
  }
}

type MockStage = 'likeness' | 'design' | 'levels' | 'entities' | 'music' | 'repair';

/** Stage detection from schema titles / prompt markers the templates always include. */
function detectStage(req: CompleteRequest): MockStage {
  const title = String((req.jsonSchema as { title?: string } | undefined)?.title ?? '');
  const hay = `${title}\n${req.system.slice(0, 400)}`;
  if (/face likeness analysis|portrait artist analyzing one face photo/i.test(hay))
    return 'likeness';
  if (/design pass/i.test(hay)) return 'design';
  if (/levels stage/i.test(hay)) return 'levels';
  if (/entities stage/i.test(hay)) return 'entities';
  if (/music stage/i.test(hay)) return 'music';
  if (/JSON Patch|repair/i.test(hay)) return 'repair';
  return 'design';
}

const KNOWN_ARCHETYPES = '(platformer|shooter|adventure|hshooter|fighter|racing)';

function detectArchetype(req: CompleteRequest): ArchetypeId | null {
  const schema = (req.jsonSchema ?? {}) as { title?: string; $id?: string };
  // 1. An explicit requested type always wins over every other signal.
  const required = new RegExp(`REQUIRED ARCHETYPE:\\s*${KNOWN_ARCHETYPES}`, 'i').exec(req.user);
  if (required) return required[1]!.toLowerCase() as ArchetypeId;
  // 2. The stage schema itself names its archetype (title or $id).
  const schemaHit = new RegExp(
    `sparkade://schemas/${KNOWN_ARCHETYPES}|Sparkade ${KNOWN_ARCHETYPES}\\b`,
  ).exec(`${schema.$id ?? ''}\n${schema.title ?? ''}`);
  if (schemaHit) {
    return (schemaHit[1] ?? schemaHit[2])!.toLowerCase() as ArchetypeId;
  }
  // 3. Later stages carry the design document JSON, whose archetype is authoritative.
  const docHit = new RegExp(`"archetype"\\s*:\\s*"${KNOWN_ARCHETYPES}"`).exec(req.user);
  if (docHit) return docHit[1]!.toLowerCase() as ArchetypeId;
  // 4. Fresh-premise keywords on the CURRENT request only: saved games,
  // catalogs, and excerpts must never steer detection.
  const premise = req.user.split('GAMES ALREADY ON THIS CABINET')[0] ?? req.user;
  // Racing keywords first: "race" would otherwise fall through to the
  // spaceship/shooter fallback below. Jet-ski wording routes to racing too,
  // where the design stage selects the jetski discipline.
  if (
    /\brace\b|racing|kart|\bhover\b|f-?zero|grand.?prix|jet.?ski|personal watercraft|wave.?runn/i.test(
      premise,
    )
  )
    return 'racing';
  const m =
    /(hshooter|horizontal shooter|fighting game|fighter|platformer|shooter|adventure)/i.exec(
      premise,
    );
  if (!m) return null;
  const w = m[1]!.toLowerCase();
  return (
    w === 'horizontal shooter' ? 'hshooter' : w === 'fighting game' ? 'fighter' : w
  ) as ArchetypeId;
}

function clamp(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n);
}
