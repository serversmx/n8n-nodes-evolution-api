import { EvolutionApi } from '../../nodes/EvolutionApi/EvolutionApi.node';
import { resetRetryPolicy, setRetryPolicy } from '../../nodes/EvolutionApi/GenericFunctions';
import { createMockExecuteFunctions, rl } from '../helpers/mockExecuteFunctions';

// Tests of the label resource (owned by the label agent).

beforeEach(() => setRetryPolicy({ sleep: async () => undefined }));
afterEach(() => resetRetryPolicy());

describe('label > getMany', () => {
  it('GET /label/findLabels/:instance', async () => {
    const ctx = createMockExecuteFunctions({
      params: { resource: 'label', operation: 'getMany', instanceName: rl('main', 'list') },
    });
    ctx.http.reply('GET', '/label/findLabels/main', [{ id: '1', name: 'New customer', color: 1 }]);

    const [output] = await new EvolutionApi().execute.call(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/label/findLabels/main');
    expect(call.qs).toBeUndefined();
    expect(call.body).toBeUndefined();
    expect(output.map((item) => item.json)).toEqual([{ id: '1', name: 'New customer', color: 1 }]);
    expect(output.every((item) => item.pairedItem !== undefined)).toBe(true);
  });
});
