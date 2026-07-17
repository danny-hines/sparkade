import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DesignDoc } from '@sparkade/shared';
import { buildLevelsPrompt } from '../src/pipeline/prompts';
import { MockProvider } from '../src/providers/mock';
import { validateAgainst } from '../src/pipeline/validate';

const previousFast = process.env.SPARKADE_MOCK_FAST;

beforeAll(() => {
  process.env.SPARKADE_MOCK_FAST = '1';
});

afterAll(() => {
  if (previousFast === undefined) delete process.env.SPARKADE_MOCK_FAST;
  else process.env.SPARKADE_MOCK_FAST = previousFast;
});

describe('mock fighter roster stage', () => {
  it('keeps the golden player and every required outfit', async () => {
    const prompt = buildLevelsPrompt('fighter', {
      title: 'Roster Test',
      archetype: 'fighter',
    } as DesignDoc);
    const response = await new MockProvider('test').complete({
      system: prompt.system,
      user: prompt.user,
      maxTokens: prompt.maxTokens,
      jsonSchema: prompt.jsonSchema,
    });
    const payload = JSON.parse(response.text) as {
      player?: { name?: string; outfit?: string };
      levels?: { opponent?: { outfit?: string } }[];
    };

    expect(payload.player).toMatchObject({ name: 'RONIN', outfit: 'gi' });
    expect(payload.levels?.map((level) => level.opponent?.outfit)).toEqual([
      'street',
      'wrestler',
      'robe',
    ]);
    expect(validateAgainst('test:fighter-roster', prompt.jsonSchema, payload)).toEqual([]);
  });
});
