import { EvolutionApi } from '../../nodes/EvolutionApi/EvolutionApi.node';
import { resetRetryPolicy, setRetryPolicy } from '../../nodes/EvolutionApi/GenericFunctions';
import { createMockExecuteFunctions, rl } from '../helpers/mockExecuteFunctions';

// Tests of the chat resource (owned by the chat agent).

beforeEach(() => setRetryPolicy({ sleep: async () => undefined }));
afterEach(() => resetRetryPolicy());

describe('chat > checkNumbers', () => {
  it('POST /chat/whatsappNumbers/:instance', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        ...{ resource: 'chat', operation: 'checkNumbers', numbers: '+55 11 99999-9999, 123@lid' },
        instanceName: rl('main', 'list'),
      },
    });
    ctx.http.reply('POST', '/chat/whatsappNumbers/main', [
      { exists: true, jid: '5511999999999@s.whatsapp.net', number: '5511999999999' },
    ]);

    const [output] = await new EvolutionApi().execute.call(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/chat/whatsappNumbers/main');
    expect(call.qs).toBeUndefined();
    expect(call.body).toEqual({ numbers: ['5511999999999', '123@lid'] });
    expect(output.map((item) => item.json)).toEqual([
      { exists: true, jid: '5511999999999@s.whatsapp.net', number: '5511999999999' },
    ]);
    expect(output.every((item) => item.pairedItem !== undefined)).toBe(true);
  });
});
