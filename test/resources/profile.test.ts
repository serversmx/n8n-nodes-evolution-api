import { EvolutionApi } from '../../nodes/EvolutionApi/EvolutionApi.node';
import { resetRetryPolicy, setRetryPolicy } from '../../nodes/EvolutionApi/GenericFunctions';
import { createMockExecuteFunctions, rl } from '../helpers/mockExecuteFunctions';

// Tests of the profile resource (owned by the profile agent).

beforeEach(() => setRetryPolicy({ sleep: async () => undefined }));
afterEach(() => resetRetryPolicy());

describe('profile > get', () => {
  it('POST /chat/fetchProfile/:instance (own profile)', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        ...{ resource: 'profile', operation: 'get', number: '' },
        instanceName: rl('main', 'list'),
      },
    });
    ctx.http.reply('POST', '/chat/fetchProfile/main', { wuid: '1@s.whatsapp.net', name: 'Me' });

    const [output] = await new EvolutionApi().execute.call(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/chat/fetchProfile/main');
    expect(call.qs).toBeUndefined();
    expect(call.body).toBeUndefined();
    expect(output.map((item) => item.json)).toEqual([{ wuid: '1@s.whatsapp.net', name: 'Me' }]);
    expect(output.every((item) => item.pairedItem !== undefined)).toBe(true);
  });
});
