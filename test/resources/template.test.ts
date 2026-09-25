import { EvolutionApi } from '../../nodes/EvolutionApi/EvolutionApi.node';
import { resetRetryPolicy, setRetryPolicy } from '../../nodes/EvolutionApi/GenericFunctions';
import { createMockExecuteFunctions, rl } from '../helpers/mockExecuteFunctions';

// Tests of the template resource (owned by the template agent).

beforeEach(() => setRetryPolicy({ sleep: async () => undefined }));
afterEach(() => resetRetryPolicy());

describe('template > getMany', () => {
  it('GET /template/find/:instance', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        ...{ resource: 'template', operation: 'getMany' },
        instanceName: rl('main', 'list'),
      },
    });
    ctx.http.reply('GET', '/template/find/main', [{ name: 'hello_world', language: 'en_US' }]);

    const [output] = await new EvolutionApi().execute.call(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/template/find/main');
    expect(call.qs).toBeUndefined();
    expect(call.body).toBeUndefined();
    expect(output.map((item) => item.json)).toEqual([{ name: 'hello_world', language: 'en_US' }]);
    expect(output.every((item) => item.pairedItem !== undefined)).toBe(true);
  });
});
