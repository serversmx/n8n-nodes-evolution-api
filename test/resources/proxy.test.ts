import { EvolutionApi } from '../../nodes/EvolutionApi/EvolutionApi.node';
import { resetRetryPolicy, setRetryPolicy } from '../../nodes/EvolutionApi/GenericFunctions';
import { createMockExecuteFunctions, rl } from '../helpers/mockExecuteFunctions';

// Tests of the proxy resource (owned by the proxy agent).

beforeEach(() => setRetryPolicy({ sleep: async () => undefined }));
afterEach(() => resetRetryPolicy());

describe('proxy > get', () => {
  it('GET /proxy/find/:instance (empty body → {})', async () => {
    const ctx = createMockExecuteFunctions({
      params: { resource: 'proxy', operation: 'get', instanceName: rl('main', 'list') },
    });
    ctx.http.reply('GET', '/proxy/find/main', null);

    const [output] = await new EvolutionApi().execute.call(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/proxy/find/main');
    expect(call.qs).toBeUndefined();
    expect(call.body).toBeUndefined();
    expect(output.map((item) => item.json)).toEqual([{}]);
    expect(output.every((item) => item.pairedItem !== undefined)).toBe(true);
  });
});
