import type { PipelineState } from './job-state';
import { defaultConfig } from '../storage/config';
import { costOf } from './cost';
import type { SparkadeConfig } from '@sparkade/shared';
import type { ProviderResult, ProviderTask } from './durable-pass';
import { stageProvider } from '../providers';
import { MetaImageAdapter } from '../providers/meta-image';
import { mockGeneratedImage } from '../assets/game-art';

/** One external request, called only inside a durable workflow step. */
export async function executeProviderTask(
  task: ProviderTask,
  config: SparkadeConfig,
  gameId: string,
): Promise<ProviderResult> {
  if (task.kind === 'text') {
    const { provider } = stageProvider(config, task.stage);
    const response = await provider.complete(
      {
        ...task.request,
        image: task.request.image ? Buffer.from(task.request.image, 'base64') : undefined,
      },
      { model: task.model },
    );
    return { kind: 'text', response };
  }
  if (process.env.SPARKADE_PROVIDER === 'mock')
    return {
      kind: 'image',
      image: (await mockGeneratedImage(task.request.prompt)).toString('base64'),
      imageCount: 1,
    };
  const adapter = new MetaImageAdapter(config.imageGeneration);
  const request = {
    prompt: task.request.prompt,
    size: task.request.size,
    outputFormat: 'png' as const,
    user: gameId,
  };
  const result = task.request.reference
    ? await adapter.edit({
        ...request,
        image: Buffer.from(task.request.reference, 'base64'),
        imageMimeType: 'image/png',
      })
    : await adapter.generate(request);
  return { kind: 'image', image: result.image.toString('base64'), imageCount: result.imageCount };
}

export function providerUsageEvent(
  task: ProviderTask,
  result: ProviderResult,
  state: PipelineState,
  attempt: number,
) {
  const config = state.config ?? defaultConfig();
  const model =
    result.kind === 'text'
      ? (result.response.model ?? (task.kind === 'text' ? task.model : ''))
      : config.imageGeneration.model;
  const usage = result.kind === 'text' ? result.response.usage : { input: 0, output: 0 };
  return {
    requestId: `${attempt}:${task.id}`,
    jobId: state.job!.id,
    gameId: state.job!.gameId,
    stage: task.kind === 'text' ? task.stage : `image:${task.request.role}`,
    model,
    provider: task.kind === 'text' ? config.stages[task.stage].provider : 'meta-image',
    inputTokens: usage.input,
    outputTokens: usage.output,
    cachedTokens: usage.cachedInput ?? 0,
    costUsd:
      result.kind === 'error' || process.env.SPARKADE_PROVIDER === 'mock'
        ? 0
        : result.kind === 'text'
          ? costOf(model, usage, state.pricing)
          : state.imagePricing?.perImageUsd == null
            ? null
            : result.imageCount * state.imagePricing.perImageUsd,
    failed: result.kind === 'error',
    repair: task.kind === 'text' && task.stage === 'repair',
    at: new Date().toISOString(),
  };
}
