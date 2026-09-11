import { ARCHETYPE_IDS, type CloudGenerationInput } from '@sparkade/shared';

export function validateCloudInput(value: unknown): CloudGenerationInput {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid creation inputs');
  const v = value as Record<string, unknown>;
  if (
    typeof v.promptText !== 'string' ||
    !v.promptText.trim() ||
    v.promptText.length > 1200 ||
    typeof v.idempotencyKey !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(v.idempotencyKey) ||
    !['voice', 'preset', 'surprise'].includes(String(v.sourceKind)) ||
    (v.requestedArchetype !== undefined &&
      !(ARCHETYPE_IDS as readonly unknown[]).includes(v.requestedArchetype)) ||
    (v.presetId !== undefined && (typeof v.presetId !== 'string' || v.presetId.length > 100))
  )
    throw new Error('Invalid creation inputs');
  if (v.creationBrief !== undefined) {
    const b = v.creationBrief as Record<string, unknown>;
    if (
      !b ||
      typeof b !== 'object' ||
      b.version !== 1 ||
      (b.heroName !== undefined && (typeof b.heroName !== 'string' || b.heroName.length > 48)) ||
      (b.details !== undefined && (typeof b.details !== 'string' || b.details.length > 1200)) ||
      (b.archetype !== undefined && b.archetype !== v.requestedArchetype)
    )
      throw new Error('Invalid creation brief');
  }
  return {
    promptText: v.promptText,
    idempotencyKey: v.idempotencyKey,
    sourceKind: v.sourceKind as CloudGenerationInput['sourceKind'],
    ...(v.requestedArchetype
      ? { requestedArchetype: v.requestedArchetype as CloudGenerationInput['requestedArchetype'] }
      : {}),
    ...(v.presetId ? { presetId: v.presetId as string } : {}),
    ...(v.creationBrief
      ? { creationBrief: v.creationBrief as CloudGenerationInput['creationBrief'] }
      : {}),
  };
}
