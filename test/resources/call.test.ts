import type { INodeProperties } from 'n8n-workflow';

import { EvolutionApi } from '../../nodes/EvolutionApi/EvolutionApi.node';
import { resetRetryPolicy, setRetryPolicy } from '../../nodes/EvolutionApi/GenericFunctions';
import { fields, operations } from '../../nodes/EvolutionApi/resources/call';
import { createMockExecuteFunctions, rl } from '../helpers/mockExecuteFunctions';

// Tests of the call resource (owned by the call agent).

beforeEach(() => setRetryPolicy({ sleep: async () => undefined }));
afterEach(() => resetRetryPolicy());

describe('call resource description', () => {
  it('says that the offer is a no-op stub', () => {
    const [offer] = operations.options as Array<{
      value: string;
      description: string;
      action: string;
    }>;
    expect(offer.value).toBe('offer');
    expect(offer.action).toContain('no-op');
    expect(offer.description).toContain('place NO call');
    const notice = fields.find((field: INodeProperties) => field.type === 'notice');
    expect(notice?.displayName).toContain('places NO call');
  });
});

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
    ctx.http.reply(
      'POST',
      '/call/offer/main',
      { id: '123', jid: '5511999999999@s.whatsapp.net' },
      201,
    );

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

  it('uses the defaults and keeps callDuration inside 1-15 for every item', async () => {
    const ctx = createMockExecuteFunctions({
      params: { resource: 'call', operation: 'offer', instanceName: rl('main') },
      items: [{ json: {} }, { json: {} }, { json: {} }],
      itemParams: [
        { number: '5511999999999' },
        { number: '123@lid', callDuration: 60 },
        { number: '5511999999999', callDuration: 0.2 },
      ],
    });
    ctx.http
      .reply('POST', '/call/offer/main', { id: '123' }, 201)
      .reply('POST', '/call/offer/main', { id: '123' }, 201)
      .reply('POST', '/call/offer/main', { id: '123' }, 201);

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls.map((c) => c.body)).toEqual([
      { number: '5511999999999', isVideo: false, callDuration: 5 },
      { number: '123@lid', isVideo: false, callDuration: 15 },
      { number: '5511999999999', isVideo: false, callDuration: 1 },
    ]);
    expect(output.map((item) => item.pairedItem)).toEqual([{ item: 0 }, { item: 1 }, { item: 2 }]);
  });

  it('requires a number', async () => {
    const ctx = createMockExecuteFunctions({
      params: { resource: 'call', operation: 'offer', instanceName: rl('main'), number: ' ' },
    });
    await expect(new EvolutionApi().execute.call(ctx)).rejects.toThrow('Number is required');
    expect(ctx.http.calls).toHaveLength(0);
  });
});
