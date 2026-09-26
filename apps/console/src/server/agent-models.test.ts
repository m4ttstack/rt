// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { agentModels } from './agent-models';

describe('GET /api/agent/models', () => {
  it('claude returns the curated list', async () => {
    const res = await agentModels.fetch(
      new Request('http://localhost/api/agent/models?provider=claude')
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: { value: string }[] };
    expect(body.models.some(m => m.value === 'sonnet')).toBe(true);
  });

  it('unknown provider is a 400', async () => {
    const res = await agentModels.fetch(
      new Request('http://localhost/api/agent/models?provider=cursor')
    );
    expect(res.status).toBe(400);
  });
});
