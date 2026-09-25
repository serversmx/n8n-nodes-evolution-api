import { EvolutionApi } from '../../nodes/EvolutionApi/EvolutionApi.node';
import { resetRetryPolicy, setRetryPolicy } from '../../nodes/EvolutionApi/GenericFunctions';
import { createMockExecuteFunctions, rl } from '../helpers/mockExecuteFunctions';

// Tests of the chatwoot resource (owned by the chatwoot agent).

beforeEach(() => setRetryPolicy({ sleep: async () => undefined }));
afterEach(() => resetRetryPolicy());

describe('chatwoot > get', () => {
  it('GET /chatwoot/find/:instance', async () => {
    const ctx = createMockExecuteFunctions({
      params: { resource: 'chatwoot', operation: 'get', instanceName: rl('main', 'list') },
    });
    ctx.http.reply('GET', '/chatwoot/find/main', {
      enabled: false,
      url: '',
      accountId: '',
      token: '',
      signMsg: false,
    });

    const [output] = await new EvolutionApi().execute.call(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/chatwoot/find/main');
    expect(call.qs).toBeUndefined();
    expect(call.body).toBeUndefined();
    expect(output.map((item) => item.json)).toEqual([
      { enabled: false, url: '', accountId: '', token: '', signMsg: false },
    ]);
    expect(output.every((item) => item.pairedItem !== undefined)).toBe(true);
  });
});
