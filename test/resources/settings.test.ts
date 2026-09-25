import { EvolutionApi } from '../../nodes/EvolutionApi/EvolutionApi.node';
import { resetRetryPolicy, setRetryPolicy } from '../../nodes/EvolutionApi/GenericFunctions';
import { createMockExecuteFunctions, rl } from '../helpers/mockExecuteFunctions';

// Tests of the settings resource (owned by the settings agent).

beforeEach(() => setRetryPolicy({ sleep: async () => undefined }));
afterEach(() => resetRetryPolicy());

describe('settings > get', () => {
  it('GET /settings/find/:instance', async () => {
    const ctx = createMockExecuteFunctions({
      params: { resource: 'settings', operation: 'get', instanceName: rl('main', 'list') },
    });
    ctx.http.reply('GET', '/settings/find/main', { rejectCall: false, groupsIgnore: true });

    const [output] = await new EvolutionApi().execute.call(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/settings/find/main');
    expect(call.qs).toBeUndefined();
    expect(call.body).toBeUndefined();
    expect(output.map((item) => item.json)).toEqual([{ rejectCall: false, groupsIgnore: true }]);
    expect(output.every((item) => item.pairedItem !== undefined)).toBe(true);
  });
});
