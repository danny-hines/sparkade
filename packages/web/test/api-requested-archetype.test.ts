import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api';

afterEach(() => vi.unstubAllGlobals());

function captureCreateRequest(): { submitted: () => FormData } {
  let body: FormData | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = init?.body as FormData;
      return new Response(JSON.stringify({ jobId: 'j-test', gameId: 'g-test' }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return {
    submitted: () => {
      if (!body) throw new Error('request was not submitted');
      return body;
    },
  };
}

describe('createGame requested archetype', () => {
  it('sends the structured genre for a Surprise creation', async () => {
    const capture = captureCreateRequest();
    await api.createGame({
      promptText: 'Surprise me',
      sourceKind: 'surprise',
      requestedArchetype: 'hshooter',
      idempotencyKey: 'ik-surprise',
    });

    expect(capture.submitted().get('requestedArchetype')).toBe('hshooter');
  });

  it('omits the field for ordinary voice creation', async () => {
    const capture = captureCreateRequest();
    await api.createGame({
      promptText: 'A platform game about a lighthouse',
      sourceKind: 'voice',
      requestedArchetype: 'fighter',
      idempotencyKey: 'ik-voice',
    });

    expect(capture.submitted().has('requestedArchetype')).toBe(false);
  });
});
