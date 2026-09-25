import { EvolutionApi } from '../../nodes/EvolutionApi/EvolutionApi.node';
import { resetRetryPolicy, setRetryPolicy } from '../../nodes/EvolutionApi/GenericFunctions';
import { createMockExecuteFunctions, rl } from '../helpers/mockExecuteFunctions';

// Tests of the message resource (owned by the message agent).

beforeEach(() => setRetryPolicy({ sleep: async () => undefined }));
afterEach(() => resetRetryPolicy());

describe('message > sendText', () => {
  it('POST /message/sendText/:instance', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'message',
        operation: 'sendText',
        number: '5511999999999',
        text: 'Hola',
        options: { delay: 1200, linkPreview: false },
        instanceName: rl('main', 'list'),
      },
    });
    ctx.http.reply('POST', '/message/sendText/main', { key: { id: 'MSG' } });

    const [output] = await new EvolutionApi().execute.call(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/message/sendText/main');
    expect(call.qs).toBeUndefined();
    expect(call.body).toEqual({
      number: '5511999999999',
      text: 'Hola',
      delay: 1200,
      linkPreview: false,
    });
    expect(output.map((item) => item.json)).toEqual([{ key: { id: 'MSG' } }]);
    expect(output.every((item) => item.pairedItem !== undefined)).toBe(true);
  });
});

it('message > sendText validates number and text before calling the API', async () => {
  const ctx = createMockExecuteFunctions({
    params: {
      resource: 'message',
      operation: 'sendText',
      instanceName: 'main',
      number: ' ',
      text: 'x',
    },
  });
  await expect(new EvolutionApi().execute.call(ctx)).rejects.toThrow('Number is required');
  expect(ctx.http.calls).toHaveLength(0);
});
