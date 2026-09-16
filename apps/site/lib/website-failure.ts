import { rejectionMessage } from './content-policy';

interface FailureContext {
  status: string | null;
  moderation: string;
  inputReview: string | null;
  error?: unknown;
  reviewCategory?: string;
}

/** Owner-facing copy only: never pass through provider errors, prompts, URLs or costs. */
export function websiteFailure(context: FailureContext): string | null {
  if (context.status !== 'failed') return null;
  if (context.moderation === 'rejected' || context.inputReview === 'rejected')
    return rejectionMessage(context.reviewCategory ?? 'other-unsafe');

  const error =
    context.error && typeof context.error === 'object'
      ? (context.error as Record<string, unknown>)
      : {};
  // Spending and review failures can arrive wrapped as auth/cloud-step errors.
  // Match only messages produced by our own guards, and return fixed public copy.
  if (
    error.message === 'Website generation paused or provider-spend limit reached.' ||
    error.message === 'Provider usage exceeded its reservation; creation has been paused.'
  )
    return 'Creation was paused or reached a generation limit before this game could finish.';
  if (error.message === 'The content check could not finish. Your credits will be returned.')
    return 'The content-check service couldn’t finish checking this game.';
  if (error.message === 'Source photo unavailable for content check.')
    return 'Your saved photo couldn’t be loaded for the content check.';
  if (error.message === 'Generation exceeded its step budget. Retry to continue.')
    return 'The game took too many build steps to finish in this attempt.';

  switch (error.code) {
    case 'timeout':
    case 'call-timeout':
      return 'Generation took too long and reached its time limit.';
    case 'image-content-policy':
      return 'The image service blocked a requested image during its safety check.';
    case 'image-invalid':
      return 'Some generated artwork didn’t pass the checks needed to work in the game.';
    case 'image-provider-error':
      return 'The image service couldn’t finish creating the artwork.';
    case 'design-invalid':
    case 'validation-failed':
      return 'The generated game didn’t pass our checks for playable rules and levels.';
    case 'provider-unavailable':
      return 'The generation service was unavailable after several attempts.';
    case 'provider-error':
      return 'The generation service couldn’t complete a request.';
    case 'auth':
    case 'image-config':
      return 'A service configuration problem stopped generation.';
    case 'storage':
      return 'We couldn’t save part of the generated game.';
    case 'interrupted':
    case 'cloud-step':
      return 'The build was interrupted by a technical problem.';
    default:
      return 'An unexpected technical problem stopped this game from finishing.';
  }
}
