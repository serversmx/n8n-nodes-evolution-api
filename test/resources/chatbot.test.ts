import { EvolutionApi } from '../../nodes/EvolutionApi/EvolutionApi.node';
import { resetRetryPolicy, setRetryPolicy } from '../../nodes/EvolutionApi/GenericFunctions';
import { createMockExecuteFunctions, rl } from '../helpers/mockExecuteFunctions';

// Tests of the chatbot resource (owned by the chatbot agent).

beforeEach(() => setRetryPolicy({ sleep: async () => undefined }));
afterEach(() => resetRetryPolicy());

describe('chatbot > getMany', () => {
  it('GET /:botType/find/:instance', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        ...{ resource: 'chatbot', operation: 'getMany', botType: 'evolutionBot' },
        instanceName: rl('main', 'list'),
      },
    });
    ctx.http.reply('GET', '/evolutionBot/find/main', [{ id: 'bot1' }]);

    const [output] = await new EvolutionApi().execute.call(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/evolutionBot/find/main');
    expect(call.qs).toBeUndefined();
    expect(call.body).toBeUndefined();
    expect(output.map((item) => item.json)).toEqual([{ id: 'bot1' }]);
    expect(output.every((item) => item.pairedItem !== undefined)).toBe(true);
  });
});

it('chatbot > getMany uses the default bot type (n8n) when none is given', async () => {
  // The mock falls back to the node description defaults, as n8n does.
  const ctx = createMockExecuteFunctions({
    params: { resource: 'chatbot', operation: 'getMany', instanceName: 'main' },
  });
  ctx.http.reply('GET', '/n8n/find/main', []);
  await new EvolutionApi().execute.call(ctx);
  expect(ctx.http.calls[0].path).toBe('/n8n/find/main');
});
