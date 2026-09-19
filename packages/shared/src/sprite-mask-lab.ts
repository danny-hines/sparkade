export type SpriteMaskStrategy = 'chroma' | 'sam' | 'sam-despill' | 'sam-hybrid';

export interface SpriteMaskVariant {
  strategy: SpriteMaskStrategy;
  status: 'complete' | 'failed';
  elapsedMs: number;
  maskUrl?: string;
  cutoutUrl?: string;
  spriteUrl?: string;
  changedPixels?: number;
  hybrid?: {
    radius: number;
    removedPixels: number;
    restoredPixels: number;
    despilledPixels?: number;
    protectedGreenPixels: number;
  };
  metrics?: {
    sourceSubjectFraction: number;
    sourceBounds: { left: number; top: number; width: number; height: number };
  };
  error?: string;
}

export interface SpriteMaskComparison {
  id: string;
  status: 'running' | 'complete' | 'failed';
  createdAt: string;
  concept: string;
  sourceUrl: string;
  sourceSha256: string;
  processorVersion: string;
  reusedFrom?: string;
  model: string;
  variants: SpriteMaskVariant[];
  segmentationMs?: number;
  responseId?: string;
  segmentationCalls: number;
  estimatedCostUsd: number | null;
  error?: string;
  verdict?: { preferred: SpriteMaskStrategy | 'none'; notes: string; at: string };
}
