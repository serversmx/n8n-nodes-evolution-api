import type { IDataObject, INodeExecutionData } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import {
  buildMethods,
  EvolutionApi,
  getOperationHandler,
  isExecutionDataArray,
  toOutputItems,
} from '../nodes/EvolutionApi/EvolutionApi.node';
import {
  resetRetryPolicy,
  resolveInstanceNameFromValue,
  searchInstances,
  setRetryPolicy,
} from '../nodes/EvolutionApi/GenericFunctions';
import type { ResourceDefinition, ResourceModule } from '../nodes/EvolutionApi/types';
import {
  binaryItem,
  createMockExecuteFunctions,
  createMockLoadOptionsFunctions,
  rl,
} from './helpers/mockExecuteFunctions';

beforeEach(() => setRetryPolicy({ sleep: async () => undefined }));
afterEach(() => resetRetryPolicy());

const node = new EvolutionApi();

describe('execute loop', () => {
  it('processes every input item with its own parameters and pairs the output', async () => {
    // Only instance operations are used here so resource agents never have to touch this file.
    const ctx = createMockExecuteFunctions({
      items: [{ json: { n: 1 } }, { json: { n: 2 } }, { json: { n: 3 } }],
      params: { resource: 'instance', operation: 'setPresence', instanceName: rl('main') },
      itemParams: [
        { presence: 'available' },
        { presence: 'unavailable', instanceName: rl('ventas mx', 'list') },
        { presence: 'composing' },
      ],
    });
    ctx.http
      .reply('POST', '/instance/setPresence/main', { presence: 'available' }, 201)
      .reply('POST', '/instance/setPresence/ventas%20mx', { presence: 'unavailable' }, 201)
      .reply('POST', '/instance/setPresence/main', { presence: 'composing' }, 201);

    const [output] = await node.execute.call(ctx);

    expect(ctx.http.calls.map((c) => [c.path, c.body])).toEqual([
      ['/instance/setPresence/main', { presence: 'available' }],
      ['/instance/setPresence/ventas%20mx', { presence: 'unavailable' }],
      ['/instance/setPresence/main', { presence: 'composing' }],
    ]);
    expect(output).toEqual([
      { json: { presence: 'available' }, pairedItem: { item: 0 } },
      { json: { presence: 'unavailable' }, pairedItem: { item: 1 } },
      { json: { presence: 'composing' }, pairedItem: { item: 2 } },
    ]);
    expect(ctx.http.pending).toEqual([]);
  });

  it('splits array responses into one item each, paired to their input', async () => {
    const ctx = createMockExecuteFunctions({
      items: [{ json: {} }, { json: {} }],
      params: { resource: 'instance', operation: 'getMany', returnAll: true },
    });
    ctx.http
      .reply('GET', '/instance/fetchInstances', [{ name: 'a' }, { name: 'b' }])
      .reply('GET', '/instance/fetchInstances', []);
    const [output] = await node.execute.call(ctx);
    expect(output).toEqual([
      { json: { name: 'a' }, pairedItem: { item: 0 } },
      { json: { name: 'b' }, pairedItem: { item: 0 } },
    ]);
  });

  it('continues on fail with an error item per failing input', async () => {
    const ctx = createMockExecuteFunctions({
      items: [{ json: {} }, { json: {} }, { json: {} }],
      continueOnFail: true,
      params: { resource: 'instance', operation: 'getConnectionState' },
      itemParams: [
        { instanceName: 'ok' },
        { instanceName: 'missing' },
        { instanceName: '' }, // no default instance in the credential → validation error
      ],
    });
    ctx.http.reply('GET', '/instance/connectionState/ok', { instance: { state: 'open' } }).reply(
      'GET',
      '/instance/connectionState/missing',
      {
        status: 404,
        error: 'Not Found',
        response: { message: ['The "missing" instance does not exist'] },
      },
      404,
    );

    const [output] = await node.execute.call(ctx);

    expect(output).toHaveLength(3);
    expect(output[0]).toEqual({ json: { instance: { state: 'open' } }, pairedItem: { item: 0 } });
    expect(output[1].pairedItem).toEqual({ item: 1 });
    expect(output[1].json).toMatchObject({
      error: 'Not found: The "missing" instance does not exist',
      httpCode: '404',
    });
    expect(output[2]).toMatchObject({
      json: { error: 'No instance selected' },
      pairedItem: { item: 2 },
    });
  });

  it('throws with the failing item index when continueOnFail is off', async () => {
    const ctx = createMockExecuteFunctions({
      items: [{ json: {} }, { json: {} }],
      params: { resource: 'instance', operation: 'getConnectionState' },
      itemParams: [{ instanceName: 'ok' }, { instanceName: 'down' }],
    });
    ctx.http
      .reply('GET', '/instance/connectionState/ok', { instance: { state: 'open' } })
      .reply('GET', '/instance/connectionState/down', {}, 500);

    const promise = node.execute.call(ctx);
    await expect(promise).rejects.toBeInstanceOf(NodeApiError);
    await expect(promise).rejects.toMatchObject({
      httpCode: '500',
      context: expect.objectContaining({ itemIndex: 1 }),
    });
  });

  it('reports 503 LICENSE_REQUIRED (Evolution 2.4) through the node', async () => {
    const ctx = createMockExecuteFunctions({
      params: { resource: 'instance', operation: 'getMany', returnAll: true },
    });
    ctx.http.reply(
      'GET',
      '/instance/fetchInstances',
      {
        error: 'service not activated',
        code: 'LICENSE_REQUIRED',
        register_url: 'https://evo.test/manager/login',
        message: 'not activated',
      },
      503,
    );
    await expect(node.execute.call(ctx)).rejects.toThrow(
      'Evolution API license not activated (503 LICENSE_REQUIRED). Activate it at https://evo.test/manager/login',
    );
    expect(ctx.http.calls).toHaveLength(1);
  });

  it('wraps unexpected handler errors in NodeOperationError', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'instance',
        operation: 'create',
        newInstanceName: 'x',
        integration: 'EVOLUTION',
        webhookConfig: { url: 'https://x', headers: '{broken' },
      },
    });
    const promise = node.execute.call(ctx);
    await expect(promise).rejects.toBeInstanceOf(NodeOperationError);
    await expect(promise).rejects.toThrow('Invalid JSON in "Webhook > Headers (JSON)"');
  });

  it('rejects unknown operations', async () => {
    const ctx = createMockExecuteFunctions({
      params: { resource: 'instance', operation: 'explode' },
    });
    await expect(node.execute.call(ctx)).rejects.toThrow(
      'The operation "explode" is not supported for resource "instance"',
    );
  });

  it('never treats inherited object members as operations', async () => {
    // Regression: execute[operation] used to resolve "constructor" to Object().
    for (const operation of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const ctx = createMockExecuteFunctions({ params: { resource: 'instance', operation } });
      await expect(node.execute.call(ctx)).rejects.toThrow(
        `The operation "${operation}" is not supported for resource "instance"`,
      );
      expect(ctx.http.calls).toHaveLength(0);
    }
    expect(getOperationHandler(undefined, 'connect')).toBeUndefined();
  });

  it('rejects "." and ".." instance names per item instead of hitting another route', async () => {
    // Regression: encodeURIComponent('..') === '..' and URL normalization turned
    // /instance/connectionState/.. into /instance/.
    const ctx = createMockExecuteFunctions({
      items: [{ json: {} }, { json: {} }, { json: {} }],
      continueOnFail: true,
      params: { resource: 'instance', operation: 'getConnectionState' },
      itemParams: [{ instanceName: 'ok' }, { instanceName: rl('..') }, { instanceName: '.' }],
    });
    ctx.http.reply('GET', '/instance/connectionState/ok', { instance: { state: 'open' } });

    const [output] = await node.execute.call(ctx);

    expect(ctx.http.calls.map((c) => c.path)).toEqual(['/instance/connectionState/ok']);
    expect(output[1]).toMatchObject({
      json: { error: 'Invalid instance name ".."' },
      pairedItem: { item: 1 },
    });
    expect(output[2]).toMatchObject({
      json: { error: 'Invalid instance name "."' },
      pairedItem: { item: 2 },
    });
  });

  it('keeps binary output produced by handlers (QR code)', async () => {
    const qr = `data:image/png;base64,${Buffer.from('png').toString('base64')}`;
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'instance',
        operation: 'connect',
        instanceName: 'main',
        options: { qrCodeAsBinary: true },
      },
    });
    ctx.http.reply('GET', '/instance/connect/main', { base64: qr, code: 'c' });
    const [output] = await node.execute.call(ctx);
    expect(output).toHaveLength(1);
    expect(output[0].pairedItem).toEqual({ item: 0 });
    expect(output[0].binary?.data.mimeType).toBe('image/png');
  });
});

describe('resource methods (loadOptions / listSearch)', () => {
  const baseModule: ResourceModule = {
    operations: {
      displayName: 'Operation',
      name: 'operation',
      type: 'options',
      options: [],
      default: '',
    },
    fields: [],
    execute: {},
  };
  const loadLabels = async () => [{ name: 'Red', value: '1' }];
  const searchBots = async () => ({ results: [{ name: 'Bot', value: 'b1' }] });
  const otherLoadLabels = async () => [];

  it('merges the methods of every resource with searchInstances (no shared-file edits)', () => {
    // Regression: methods were hard-coded in EvolutionApi.node.ts, so a resource needing a
    // loadOptions/listSearch method had to edit the shared node file.
    const resources: ResourceDefinition[] = [
      {
        name: 'A',
        value: 'a',
        description: 'a',
        module: { ...baseModule, methods: { loadOptions: { labelLoadLabels: loadLabels } } },
      },
      {
        name: 'B',
        value: 'b',
        description: 'b',
        module: {
          ...baseModule,
          methods: {
            listSearch: { chatbotSearchBots: searchBots },
            loadOptions: { labelLoadLabels: otherLoadLabels },
          },
        },
      },
      { name: 'C', value: 'c', description: 'c', module: baseModule },
    ];
    const methods = buildMethods(resources);
    expect(methods.listSearch).toEqual({ searchInstances, chatbotSearchBots: searchBots });
    // First registration wins (test/Resources.test.ts fails on duplicates anyway).
    expect(methods.loadOptions).toEqual({ labelLoadLabels: loadLabels });
  });

  it('exposes the merged methods on the node', () => {
    expect(node.methods.listSearch.searchInstances).toBe(searchInstances);
    expect(node.methods.loadOptions).toBeDefined();
  });

  it('lets loadOptions methods resolve the instance of the node being edited', async () => {
    const ctx = createMockLoadOptionsFunctions({
      params: { instanceName: rl('ventas mx', 'list') },
    });
    const value = ctx.getCurrentNodeParameter('instanceName', { extractValue: true });
    await expect(resolveInstanceNameFromValue.call(ctx, value)).resolves.toBe('ventas%20mx');

    const fallback = createMockLoadOptionsFunctions({ credentials: { defaultInstance: 'main' } });
    await expect(
      resolveInstanceNameFromValue.call(
        fallback,
        fallback.getCurrentNodeParameter('instanceName', { extractValue: true }),
      ),
    ).resolves.toBe('main');
  });
});

describe('toOutputItems', () => {
  it('passes the input binary through when requested', () => {
    const input = binaryItem({ a: 1 }, { data: { content: 'file', fileName: 'f.txt' } });
    const items = toOutputItems({ sent: true }, input, true);
    expect(items).toEqual([{ json: { sent: true }, binary: input.binary }]);
    expect(toOutputItems({ sent: true }, input, false)).toEqual([{ json: { sent: true } }]);
  });

  it('keeps INodeExecutionData results untouched', () => {
    const data: INodeExecutionData[] = [{ json: { a: 1 }, binary: {} }];
    expect(toOutputItems(data, { json: {} }, true)).toBe(data);
  });

  it('wraps primitives inside arrays and non-objects', () => {
    expect(toOutputItems(['x', { a: 1 }] as unknown as IDataObject[], undefined, false)).toEqual([
      { json: { value: 'x' } },
      { json: { a: 1 } },
    ]);
  });

  it('only treats real execution data as INodeExecutionData', () => {
    expect(isExecutionDataArray([{ json: {} }])).toBe(true);
    expect(isExecutionDataArray([{ json: {}, pairedItem: { item: 0 } }])).toBe(true);
    expect(isExecutionDataArray([])).toBe(false);
    expect(isExecutionDataArray([{ json: {}, id: 1 }] as IDataObject[])).toBe(false);
    expect(isExecutionDataArray([{ json: 'x' }] as IDataObject[])).toBe(false);
    expect(isExecutionDataArray({ json: {} })).toBe(false);
  });
});
