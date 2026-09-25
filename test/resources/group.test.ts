import { EvolutionApi } from '../../nodes/EvolutionApi/EvolutionApi.node';
import { resetRetryPolicy, setRetryPolicy } from '../../nodes/EvolutionApi/GenericFunctions';
import { createMockExecuteFunctions, rl } from '../helpers/mockExecuteFunctions';

// Tests of the group resource (owned by the group agent).

beforeEach(() => setRetryPolicy({ sleep: async () => undefined }));
afterEach(() => resetRetryPolicy());

describe('group > getMany', () => {
  it('GET /group/fetchAllGroups/:instance?getParticipants=', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'group',
        operation: 'getMany',
        getParticipants: false,
        returnAll: false,
        limit: 1,
        instanceName: rl('main', 'list'),
      },
    });
    ctx.http.reply('GET', '/group/fetchAllGroups/main', [{ id: '1@g.us' }, { id: '2@g.us' }]);

    const [output] = await new EvolutionApi().execute.call(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/group/fetchAllGroups/main');
    expect(call.qs).toEqual({ getParticipants: 'false' });
    expect(call.body).toBeUndefined();
    expect(output.map((item) => item.json)).toEqual([{ id: '1@g.us' }]);
    expect(output.every((item) => item.pairedItem !== undefined)).toBe(true);
  });
});
