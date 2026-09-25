import type { IDataObject, INodeExecutionData } from 'n8n-workflow';

import { EvolutionApi } from '../../nodes/EvolutionApi/EvolutionApi.node';
import { resetRetryPolicy, setRetryPolicy } from '../../nodes/EvolutionApi/GenericFunctions';
import { methods, operations } from '../../nodes/EvolutionApi/resources/label';
import type { MockExecuteFunctions, MockOptions } from '../helpers/mockExecuteFunctions';
import {
  createMockExecuteFunctions,
  createMockLoadOptionsFunctions,
  rl,
} from '../helpers/mockExecuteFunctions';

// Tests of the label resource (owned by the label agent).

beforeEach(() => setRetryPolicy({ sleep: async () => undefined }));
afterEach(() => resetRetryPolicy());

function labelContext(
  operation: string,
  params: IDataObject = {},
  options: Omit<MockOptions, 'params'> = {},
): MockExecuteFunctions {
  return createMockExecuteFunctions({
    ...options,
    params: { resource: 'label', operation, instanceName: rl('main', 'list'), ...params },
  });
}

async function run(ctx: MockExecuteFunctions): Promise<INodeExecutionData[]> {
  const [output] = await new EvolutionApi().execute.call(ctx);
  return output;
}

describe('label resource description', () => {
  it('keeps getMany as the default operation', () => {
    expect(operations.default).toBe('getMany');
  });
});

describe('label > getMany', () => {
  it('GET /label/findLabels/:instance', async () => {
    const ctx = labelContext('getMany');
    ctx.http.reply('GET', '/label/findLabels/main', [
      { id: '1', name: 'New customer', color: 1 },
      { id: '2', name: 'Paid', color: 5 },
    ]);

    const output = await run(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/label/findLabels/main');
    expect(call.qs).toBeUndefined();
    expect(call.body).toBeUndefined();
    expect(output.map((item) => item.json)).toEqual([
      { id: '1', name: 'New customer', color: 1 },
      { id: '2', name: 'Paid', color: 5 },
    ]);
    expect(output.every((item) => item.pairedItem !== undefined)).toBe(true);
  });

  it('returns no items for accounts without labels', async () => {
    const ctx = labelContext('getMany');
    ctx.http.reply('GET', '/label/findLabels/main', []);
    expect(await run(ctx)).toEqual([]);
  });
});

describe('label > addToChat', () => {
  it('POST /label/handleLabel/:instance { number, labelId, action: add }', async () => {
    const ctx = labelContext('addToChat', {
      number: '+52 1 55 1234 5678',
      labelId: rl('3', 'list'),
    });
    ctx.http.reply('POST', '/label/handleLabel/main', {
      numberJid: '525512345678@s.whatsapp.net',
      labelId: '3',
      add: true,
    });

    const output = await run(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/label/handleLabel/main');
    expect(call.body).toEqual({ number: '5215512345678', labelId: '3', action: 'add' });
    expect(output.map((item) => item.json)).toEqual([
      { numberJid: '525512345678@s.whatsapp.net', labelId: '3', add: true },
    ]);
  });

  it('labels every input item', async () => {
    const ctx = labelContext(
      'addToChat',
      { labelId: { __rl: true, mode: 'id', value: ' 7 ' } },
      {
        items: [{ json: {} }, { json: {} }],
        itemParams: [{ number: '120363025246125486@g.us' }, { number: '5511999999999' }],
      },
    );
    ctx.http
      .reply('POST', '/label/handleLabel/main', { add: true })
      .reply('POST', '/label/handleLabel/main', { add: true });

    const output = await run(ctx);

    expect(ctx.http.calls.map((c) => c.body)).toEqual([
      { number: '120363025246125486@g.us', labelId: '7', action: 'add' },
      { number: '5511999999999', labelId: '7', action: 'add' },
    ]);
    expect(output.map((item) => item.pairedItem)).toEqual([{ item: 0 }, { item: 1 }]);
  });

  it('requires the chat and the label', async () => {
    const noChat = labelContext('addToChat', { number: '', labelId: rl('3') });
    await expect(run(noChat)).rejects.toThrow('Chat is required');

    const noLabel = labelContext('addToChat', { number: '5511999999999', labelId: rl('') });
    await expect(run(noLabel)).rejects.toThrow('Label is required');
    expect(noLabel.http.calls).toHaveLength(0);
  });

  it('shows the Evolution error for numbers that are not on WhatsApp', async () => {
    const ctx = labelContext('addToChat', { number: '5511000000000', labelId: rl('3') });
    ctx.http.reply(
      'POST',
      '/label/handleLabel/main',
      { status: 404, error: 'Not Found', response: { message: ['Number is not on WhatsApp'] } },
      404,
    );

    await expect(run(ctx)).rejects.toMatchObject({
      message: 'Not found: Number is not on WhatsApp',
      httpCode: '404',
    });
  });
});

describe('label > removeFromChat', () => {
  it('POST /label/handleLabel/:instance { number, labelId, action: remove }', async () => {
    const ctx = labelContext('removeFromChat', {
      number: '5511999999999@s.whatsapp.net',
      labelId: '4',
    });
    ctx.http.reply('POST', '/label/handleLabel/main', {
      numberJid: '5511999999999@s.whatsapp.net',
      labelId: '4',
      remove: true,
    });

    const output = await run(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/label/handleLabel/main');
    expect(call.body).toEqual({
      number: '5511999999999@s.whatsapp.net',
      labelId: '4',
      action: 'remove',
    });
    expect(output[0].json).toEqual({
      numberJid: '5511999999999@s.whatsapp.net',
      labelId: '4',
      remove: true,
    });
  });
});

describe('label > labelSearchLabels (listSearch)', () => {
  it('lists the labels of the selected instance, filtered and sorted by name', async () => {
    const ctx = createMockLoadOptionsFunctions({ params: { instanceName: rl('main', 'list') } });
    ctx.http.reply('GET', '/label/findLabels/main', [
      { id: '2', name: 'Paid' },
      { id: '1', name: 'New customer' },
      { id: '3', name: 'Pending payment' },
      { name: 'No id' },
    ]);

    const all = await methods.listSearch!.labelSearchLabels.call(ctx);
    expect(all.results).toEqual([
      { name: 'New customer', value: '1' },
      { name: 'Paid', value: '2' },
      { name: 'Pending payment', value: '3' },
    ]);
    expect(ctx.http.calls[0].path).toBe('/label/findLabels/main');

    ctx.http.reply('GET', '/label/findLabels/main', [
      { id: '2', name: 'Paid' },
      { id: '3', name: 'Pending payment' },
    ]);
    const filtered = await methods.listSearch!.labelSearchLabels.call(ctx, 'PEND');
    expect(filtered.results).toEqual([{ name: 'Pending payment', value: '3' }]);
  });

  it('falls back to the default instance of the credential', async () => {
    const ctx = createMockLoadOptionsFunctions({
      params: { instanceName: rl('', 'list') },
      credentials: { defaultInstance: 'sales' },
    });
    ctx.http.reply('GET', '/label/findLabels/sales', []);

    await expect(methods.listSearch!.labelSearchLabels.call(ctx)).resolves.toEqual({ results: [] });
  });
});
