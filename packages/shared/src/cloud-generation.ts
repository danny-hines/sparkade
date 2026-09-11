import type {
  CreationBrief,
  GameAssetManifest,
  GameMetaFile,
  GameSpec,
  GenerationFeedEvent,
  JobRecord,
  PublicGameLink,
  PublicGamePublication,
  CoverData,
  GameStatus,
} from './types';
import type { ArchetypeId } from './constants';

export interface CloudGenerationInput {
  promptText: string;
  idempotencyKey: string;
  sourceKind: 'voice' | 'preset' | 'surprise';
  requestedArchetype?: ArchetypeId;
  creationBrief?: CreationBrief;
  presetId?: string;
}

export interface CloudGenerationSnapshot {
  job: JobRecord;
  game: {
    id: string;
    title: string;
    tagline: string;
    archetype: ArchetypeId;
    status: GameStatus;
    createdAt: string;
    golden: boolean;
    jobId: string | null;
    costUsd: number | null;
    cover: CoverData | null;
    failure: { code: string; message: string } | null;
    engineVersion: string;
    archetypeVersion: string;
  };
  events: GenerationFeedEvent[];
  publicGame?: PublicGameLink;
  publication?: PublicGamePublication;
}

export interface CloudGameBundle {
  spec: GameSpec;
  meta: GameMetaFile;
  manifest: GameAssetManifest;
}

export interface CloudGenerationSession {
  origin: string;
  token: string;
  expiresAt: number;
}
