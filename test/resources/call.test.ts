import { EvolutionApi } from '../../nodes/EvolutionApi/EvolutionApi.node';
import { resetRetryPolicy, setRetryPolicy } from '../../nodes/EvolutionApi/GenericFunctions';
import { createMockExecuteFunctions, rl } from '../helpers/mockExecuteFunctions';

// Tests of the call resource (owned by the call agent).

beforeEach(() => setRetryPolicy({ sleep: async () => undefined }));
afterEach(() => resetRetryPolicy());

describe('call > offer', () => {
  it('POST /call/offer/:instance', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'call',
        operation: 'offer',
        number: '+55 11 99999-9999',
        isVideo: true,
        callDuration: 3,
        instanceName: rl('main', 'list'),
      },
    });
    ctx.http.reply('POST', '/call/offer/main', { id: '123', jid: '5511999999999@s.whatsapp.net' });

    const [output] = await new EvolutionApi().execute.call(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/call/offer/main');
    expect(call.qs).toBeUndefined();
    expect(call.body).toEqual({ number: '5511999999999', isVideo: true, callDuration: 3 });
    expect(output.map((item) => item.json)).toEqual([
      { id: '123', jid: '5511999999999@s.whatsapp.net' },
    ]);
    expect(output.every((item) => item.pairedItem !== undefined)).toBe(true);
  });
});
