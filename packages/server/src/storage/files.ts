// Data-directory layout, staging, atomic publish, golden-game seeding and
// boot-time reconciliation between DB and filesystem. A power cut can never
// publish a partial game: everything is written to staging/<jobId>/ and
// renamed into games/<gameId>/ in one atomic operation only after every gate
// passes.
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { LIBRARY } from '@sparkade/engine';
import {
  ENGINE_VERSION,
  type CoverData,
  type GameMetaFile,
  type GameSpec,
  type PartialSpec,
  type SpriteData,
} from '@sparkade/shared';
import { atomicWriteFile, ensureDir, nowIso, readJson, repoRoot } from '../util';
import type { Db, GameRow } from './db';

export class GameFiles {
  readonly gamesDir: string;
  readonly stagingDir: string;

  constructor(readonly dir: string) {
    this.gamesDir = ensureDir(join(dir, 'games'));
    this.stagingDir = ensureDir(join(dir, 'staging'));
  }

  gameDir(gameId: string): string {
    return join(this.gamesDir, gameId);
  }

  stagingFor(jobId: string): string {
    return ensureDir(join(this.stagingDir, jobId));
  }

  readSpec(gameId: string): GameSpec | null {
    return readJson<GameSpec>(join(this.gameDir(gameId), 'game.json'));
  }

  /** Replace a published game spec without exposing a partially-written JSON file. */
  writeSpec(gameId: string, spec: GameSpec): void {
    atomicWriteFile(
      join(this.gameDir(gameId), 'game.json'),
      `${JSON.stringify(spec, null, 2)}\n`,
    );
  }

  readMeta(gameId: string): GameMetaFile | null {
    return readJson<GameMetaFile>(join(this.gameDir(gameId), 'meta.json'));
  }

  writeMeta(gameId: string, meta: GameMetaFile): void {
    atomicWriteFile(join(this.gameDir(gameId), 'meta.json'), JSON.stringify(meta, null, 2));
  }

  /** Snapshot of the stable pieces built so far, surfaced to the generation
   *  screen ahead of publish. Lives in staging and is discarded with it. */
  writePartial(jobId: string, partial: PartialSpec): void {
    atomicWriteFile(join(this.stagingFor(jobId), 'partial.json'), JSON.stringify(partial));
  }

  readPartial(jobId: string): PartialSpec | null {
    return readJson<PartialSpec>(join(this.stagingDir, jobId, 'partial.json'));
  }

  /** Drop the preview snapshot without touching the rest of staging (e.g. the
   *  photo), so a retry doesn't surface last run's sprites/music. */
  clearPartial(jobId: string): void {
    rmSync(join(this.stagingDir, jobId, 'partial.json'), { force: true });
  }

  /**
   * Atomic publish: staging/<jobId> (which must contain game.json + meta.json +
   * assets/) becomes games/<gameId>. The raw photo is deleted first — it never
   * reaches the published game dir.
   */
  publish(jobId: string, gameId: string): void {
    const staging = join(this.stagingDir, jobId);
    rmSync(join(staging, 'photo.jpg'), { force: true });
    rmSync(join(staging, 'audio.webm'), { force: true });
    const target = this.gameDir(gameId);
    rmSync(target, { recursive: true, force: true });
    renameSync(staging, target);
  }

  discardStaging(jobId: string): void {
    rmSync(join(this.stagingDir, jobId), { recursive: true, force: true });
  }

  deleteGame(gameId: string): void {
    rmSync(this.gameDir(gameId), { recursive: true, force: true });
  }

  /**
   * Cover art for library cards (server-side pixel data, no canvas): hero,
   * boss, and the game's most distinctive enemy — custom sprites first, since
   * they're unique to this game.
   */
  coverFor(spec: GameSpec, gameId?: string): CoverData {
    const resolve = (ref: string | undefined): SpriteData | null => {
      if (!ref) return null;
      const [kind, id] = ref.split(':', 2);
      if (kind === 'custom' && id) return spec.sprites.custom[id] ?? null;
      if (kind === 'lib' && id) return LIBRARY[id]?.frames[0] ?? null;
      return null;
    };
    const heroRef = spec.sprites.assign['hero'] ?? '';
    const others = Object.entries(spec.sprites.assign).filter(
      ([role]) => role !== 'hero' && role !== 'boss',
    );
    const showcase = others.find(([, ref]) => ref.startsWith('custom:')) ?? others[0];
    const hasLikeness = gameId
      ? existsSync(join(this.gameDir(gameId), 'assets', 'head12.png'))
      : false;
    return {
      palette: spec.palette,
      hero: resolve(heroRef),
      heroRef,
      enemy: resolve(showcase?.[1]),
      boss: resolve(spec.sprites.assign['boss']),
      hasLikeness,
    };
  }
}

/** Seed the three golden games from packages/generation/golden on first boot. */
export function seedGoldenGames(files: GameFiles, db: Db, archetypeVersions: Record<string, string>): void {
  const goldenDir = join(repoRoot(), 'packages', 'generation', 'golden');
  if (!existsSync(goldenDir)) return;
  for (const file of readdirSync(goldenDir)) {
    if (!file.endsWith('.json')) continue;
    const id = file.replace(/\.json$/, '');
    const srcPath = join(goldenDir, file);
    const existing = db.getGame(id);
    if (existing) {
      // Built-in goldens must always match their source file. Skip only if the
      // stored copy is byte-identical; otherwise fall through to RE-SEED (the
      // golden was hand-edited, e.g. an archetype's level format changed).
      if (!existing.golden) continue; // never touch a user game that shares the id
      const storedPath = join(files.gameDir(id), 'game.json');
      try {
        if (existsSync(storedPath) && readFileSync(storedPath, 'utf8') === readFileSync(srcPath, 'utf8')) continue;
      } catch {
        continue;
      }
    }
    const spec = readJson<GameSpec>(srcPath);
    if (!spec) continue;
    const dir = ensureDir(files.gameDir(id));
    ensureDir(join(dir, 'assets'));
    cpSync(srcPath, join(dir, 'game.json'));
    const meta: GameMetaFile = {
      id,
      status: 'ready',
      createdAt: existing?.createdAt ?? nowIso(),
      archetype: spec.archetype,
      seed: spec.seed,
      engineVersion: ENGINE_VERSION,
      archetypeVersion: archetypeVersions[spec.archetype] ?? '1.0.0',
      specVersion: spec.specVersion,
      title: spec.meta.title,
      tagline: spec.meta.tagline,
      sourcePrompt: 'Built-in golden game',
      sourceKind: 'preset',
      hadPhoto: false,
      model: 'hand-authored',
      provider: 'none',
      costUsd: 0,
      costBreakdown: [],
      priceSnapshot: {},
      golden: true,
    };
    files.writeMeta(id, meta);
    db.upsertGame({
      id,
      title: spec.meta.title,
      tagline: spec.meta.tagline,
      archetype: spec.archetype,
      status: 'ready',
      createdAt: meta.createdAt,
      golden: true,
      jobId: null,
      costUsd: 0,
      cover: files.coverFor(spec, id),
      failure: null,
      engineVersion: ENGINE_VERSION,
      archetypeVersion: meta.archetypeVersion,
    });
  }
}

/**
 * Boot reconciliation: index every valid on-disk game the DB doesn't know,
 * drop DB rows whose files vanished, and flag engine/archetype major-version
 * mismatches as needs-migration instead of silently reinterpreting old games.
 */
export function reconcileGames(files: GameFiles, db: Db): void {
  const onDisk = new Set(
    existsSync(files.gamesDir)
      ? readdirSync(files.gamesDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
      : [],
  );

  for (const row of db.listGames()) {
    if ((row.status === 'ready' || row.status === 'needs-migration') && !onDisk.has(row.id)) {
      db.deleteGame(row.id);
    }
  }

  for (const id of onDisk) {
    const meta = files.readMeta(id);
    const spec = files.readSpec(id);
    if (!meta || !spec) continue; // half-written dirs are never publishable (publish is atomic)
    const majorOf = (v: string) => v.split('.')[0] ?? '0';
    const incompatible =
      majorOf(meta.engineVersion) !== majorOf(ENGINE_VERSION) || meta.specVersion !== spec.specVersion;
    const existing = db.getGame(id);
    const status = incompatible ? 'needs-migration' : (existing?.status ?? 'ready');
    const row: GameRow = {
      id,
      title: meta.title,
      tagline: meta.tagline,
      archetype: meta.archetype,
      status: status === 'queued' || status === 'generating' ? 'ready' : status,
      createdAt: meta.createdAt,
      golden: meta.golden ?? false,
      jobId: existing?.jobId ?? null,
      costUsd: meta.costUsd,
      cover: files.coverFor(spec, id),
      failure: existing?.failure ?? null,
      engineVersion: meta.engineVersion,
      archetypeVersion: meta.archetypeVersion,
    };
    db.upsertGame(row);
    if (incompatible && existing?.status !== 'needs-migration') {
      db.setGameStatus(id, 'needs-migration');
    }
  }

  // Staging dirs belonging to no live job get cleaned by the runner at boot.
}
