import { EvolutionApi } from '../../nodes/EvolutionApi/EvolutionApi.node';
import { resetRetryPolicy, setRetryPolicy } from '../../nodes/EvolutionApi/GenericFunctions';
import { createMockExecuteFunctions, rl } from '../helpers/mockExecuteFunctions';

// Tests of the webhook resource (owned by the webhook agent).

beforeEach(() => setRetryPolicy({ sleep: async () => undefined }));
afterEach(() => resetRetryPolicy());

describe('webhook > get', () => {
  it('GET /webhook/find/:instance', async () => {
    const ctx = createMockExecuteFunctions({
      params: { resource: 'webhook', operation: 'get', instanceName: rl('main', 'list') },
    });
    ctx.http.reply('GET', '/webhook/find/main', {
      enabled: true,
      url: 'https://n8n.test/w',
      events: ['MESSAGES_UPSERT'],
    });

    const [output] = await new EvolutionApi().execute.call(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/webhook/find/main');
    expect(call.qs).toBeUndefined();
    expect(call.body).toBeUndefined();
    expect(output.map((item) => item.json)).toEqual([
      { enabled: true, url: 'https://n8n.test/w', events: ['MESSAGES_UPSERT'] },
    ]);
    expect(output.every((item) => item.pairedItem !== undefined)).toBe(true);
  });
});
