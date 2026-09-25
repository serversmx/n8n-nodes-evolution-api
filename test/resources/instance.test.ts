import type { IDataObject, INodeExecutionData, INodeProperties, INodePropertyOptions } from 'n8n-workflow';

import { resetRetryPolicy, setRetryPolicy } from '../../nodes/EvolutionApi/GenericFunctions';
import { EvolutionApi } from '../../nodes/EvolutionApi/EvolutionApi.node';
import { execute as instanceExecute } from '../../nodes/EvolutionApi/resources/instance';
import { description as createDescription } from '../../nodes/EvolutionApi/resources/instance/create.operation';
import { redactInstanceSecrets } from '../../nodes/EvolutionApi/resources/instance/getMany.operation';
import { redactCreatedInstanceSecrets } from '../../nodes/EvolutionApi/resources/instance/helpers';
import { createMockExecuteFunctions, rl } from '../helpers/mockExecuteFunctions';

const QR_DATA_URI = `data:image/png;base64,${Buffer.from('qr-png').toString('base64')}`;

beforeEach(() => setRetryPolicy({ sleep: async () => undefined }));
afterEach(() => resetRetryPolicy());

describe('instance > getConnectionState', () => {
  it('GET /instance/connectionState/:instance', async () => {
    const ctx = createMockExecuteFunctions({ params: { instanceName: rl('main') } });
    ctx.http.reply('GET', '/instance/connectionState/main', {
      instance: { instanceName: 'main', state: 'open' },
    });
    const result = await instanceExecute.getConnectionState.call(ctx, 0);
    expect(result).toEqual({ instance: { instanceName: 'main', state: 'open' } });
    expect(ctx.http.calls[0].method).toBe('GET');
  });
});

describe('instance > connect', () => {
  it('GET /instance/connect/:instance?number= and returns the QR payload', async () => {
    const ctx = createMockExecuteFunctions({
      params: { instanceName: rl('main'), options: { number: '+52 1 55 1234 5678' } },
    });
    ctx.http.reply('GET', '/instance/connect/main', {
      pairingCode: 'ABCD1234',
      code: '2@xyz',
      base64: QR_DATA_URI,
      count: 1,
    });
    const result = (await instanceExecute.connect.call(ctx, 0)) as IDataObject;
    expect(ctx.http.calls[0].qs).toEqual({ number: '5215512345678' });
    expect(result.pairingCode).toBe('ABCD1234');
  });

  it('outputs the QR code as binary when asked', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        instanceName: 'main',
        options: { qrCodeAsBinary: true, binaryPropertyName: 'qr' },
      },
    });
    ctx.http.reply('GET', '/instance/connect/main', {
      code: '2@xyz',
      base64: QR_DATA_URI,
      count: 1,
    });
    const result = (await instanceExecute.connect.call(ctx, 0)) as INodeExecutionData[];
    expect(result).toHaveLength(1);
    expect(result[0].json.code).toBe('2@xyz');
    expect(result[0].binary?.qr).toMatchObject({
      data: Buffer.from('qr-png').toString('base64'),
      mimeType: 'image/png',
      fileName: 'qrcode.png',
    });
  });

  it('returns JSON only when the instance is already open (no QR)', async () => {
    const ctx = createMockExecuteFunctions({
      params: { instanceName: 'main', options: { qrCodeAsBinary: true } },
    });
    ctx.http.reply('GET', '/instance/connect/main', {
      instance: { instanceName: 'main', state: 'open' },
    });
    await expect(instanceExecute.connect.call(ctx, 0)).resolves.toEqual({
      instance: { instanceName: 'main', state: 'open' },
    });
  });

  it('turns { error: true } answered with HTTP 200 into an error', async () => {
    const ctx = createMockExecuteFunctions({ params: { instanceName: 'main' } });
    ctx.http.reply('GET', '/instance/connect/main', { error: true, message: '[object Object]' });
    await expect(instanceExecute.connect.call(ctx, 0)).rejects.toThrow(
      'Evolution API could not start the connection of this instance',
    );
  });
});

describe('instance > create', () => {
  it('creates a Baileys instance with QR code, number and token', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        newInstanceName: '  ventas  ',
        integration: 'WHATSAPP-BAILEYS',
        qrcode: true,
        additionalFields: { token: 'secret-token', number: '+55 11 99999-9999' },
      },
    });
    ctx.http.reply(
      'POST',
      '/instance/create',
      {
        instance: { instanceName: 'ventas', instanceId: 'id-1', status: 'connecting' },
        hash: 'secret-token',
        qrcode: { pairingCode: 'WZYEH1YY', code: '2@abc', base64: QR_DATA_URI, count: 1 },
      },
      201,
    );

    const result = (await instanceExecute.create.call(ctx, 0)) as IDataObject;
    expect(ctx.http.calls[0].body).toEqual({
      instanceName: 'ventas',
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      token: 'secret-token',
      number: '5511999999999',
    });
    expect(result.hash).toBeUndefined();
  });

  it('requires the Meta token and phone number ID for WhatsApp Cloud API', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        newInstanceName: 'cloud',
        integration: 'WHATSAPP-BUSINESS',
        businessToken: '',
        phoneNumberId: '',
      },
    });
    await expect(instanceExecute.create.call(ctx, 0)).rejects.toThrow(
      'Access Token and Phone Number ID are required',
    );
    expect(ctx.http.calls).toHaveLength(0);
  });

  it('creates a WhatsApp Cloud API instance (token, number = phone number ID, businessId)', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        newInstanceName: 'cloud',
        integration: 'WHATSAPP-BUSINESS',
        businessToken: 'EAAG',
        phoneNumberId: '1234567890',
        businessId: '99887766',
        // must be ignored for Cloud API
        qrcode: true,
        additionalFields: { token: 'ignored', number: '5511' },
      },
    });
    ctx.http.reply('POST', '/instance/create', { instance: { instanceName: 'cloud' } }, 201);
    await instanceExecute.create.call(ctx, 0);
    expect(ctx.http.calls[0].body).toEqual({
      instanceName: 'cloud',
      integration: 'WHATSAPP-BUSINESS',
      token: 'EAAG',
      number: '1234567890',
      businessId: '99887766',
    });
  });

  it('creates an Evolution channel instance without qrcode', async () => {
    const ctx = createMockExecuteFunctions({
      params: { newInstanceName: 'evo', integration: 'EVOLUTION', qrcode: true },
    });
    ctx.http.reply('POST', '/instance/create', { instance: { instanceName: 'evo' } }, 201);
    await instanceExecute.create.call(ctx, 0);
    expect(ctx.http.calls[0].body).toEqual({ instanceName: 'evo', integration: 'EVOLUTION' });
  });

  it('maps settings, webhook, proxy and Chatwoot blocks to the create DTO', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        newInstanceName: 'full',
        integration: 'WHATSAPP-BAILEYS',
        qrcode: false,
        instanceSettings: {
          rejectCall: true,
          msgCall: 'No calls',
          groupsIgnore: false,
          wavoipToken: '   ',
        },
        webhookConfig: {
          url: 'https://n8n.test/webhook/evo',
          headers: '{"authorization":"Bearer x"}',
          byEvents: false,
        },
        proxyConfig: { host: 'proxy.test', port: 8080, username: 'u', password: 'p' },
        chatwootConfig: {
          accountId: '1',
          token: 'cw-token',
          url: 'https://chatwoot.test/',
          reopenConversation: true,
          daysLimitImportMessages: 7,
          nameInbox: 'WhatsApp',
        },
      },
    });
    ctx.http.reply('POST', '/instance/create', { instance: { instanceName: 'full' } }, 201);
    await instanceExecute.create.call(ctx, 0);

    expect(ctx.http.calls[0].body).toEqual({
      instanceName: 'full',
      integration: 'WHATSAPP-BAILEYS',
      qrcode: false,
      rejectCall: true,
      msgCall: 'No calls',
      groupsIgnore: false,
      webhook: {
        enabled: true,
        url: 'https://n8n.test/webhook/evo',
        events: [],
        byEvents: false,
        base64: false,
        headers: { authorization: 'Bearer x' },
      },
      proxyHost: 'proxy.test',
      proxyPort: '8080',
      proxyProtocol: 'http',
      proxyUsername: 'u',
      proxyPassword: 'p',
      chatwootAccountId: '1',
      chatwootToken: 'cw-token',
      chatwootUrl: 'https://chatwoot.test',
      chatwootSignMsg: false,
      chatwootReopenConversation: true,
      chatwootConversationPending: false,
      chatwootDaysLimitImportMessages: 7,
      chatwootNameInbox: 'WhatsApp',
    });
  });

  it('keeps selected webhook events (2.4 MESSAGING_HISTORY_SET included)', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        newInstanceName: 'hooks',
        integration: 'EVOLUTION',
        webhookConfig: {
          url: 'https://n8n.test/w',
          events: ['MESSAGES_UPSERT', 'MESSAGING_HISTORY_SET'],
          base64: true,
          headers: '{}',
        },
      },
    });
    ctx.http.reply('POST', '/instance/create', {}, 201);
    await instanceExecute.create.call(ctx, 0);
    expect((ctx.http.calls[0].body as IDataObject).webhook).toEqual({
      enabled: true,
      url: 'https://n8n.test/w',
      events: ['MESSAGES_UPSERT', 'MESSAGING_HISTORY_SET'],
      byEvents: false,
      base64: true,
    });
  });

  it.each([
    [{ webhookConfig: { events: ['CALL'] } }, 'Webhook URL is required'],
    [
      { webhookConfig: { url: 'https://x', headers: '[1]' } },
      'Webhook headers must be a JSON object',
    ],
    [{ proxyConfig: { host: 'p' } }, 'Proxy Host and Port are required'],
    [
      { chatwootConfig: { accountId: '1' } },
      'Chatwoot Account ID, API Access Token and URL are required',
    ],
    [{ newInstanceName: '   ' }, 'New Instance Name is required'],
  ])('validates incomplete blocks (%#)', async (params, message) => {
    const ctx = createMockExecuteFunctions({
      params: { newInstanceName: 'x', integration: 'EVOLUTION', ...params },
    });
    await expect(instanceExecute.create.call(ctx, 0)).rejects.toThrow(message);
    expect(ctx.http.calls).toHaveLength(0);
  });

  it('surfaces "name already in use" (403) clearly', async () => {
    const ctx = createMockExecuteFunctions({
      params: { newInstanceName: 'dup', integration: 'EVOLUTION' },
    });
    ctx.http.reply(
      'POST',
      '/instance/create',
      {
        status: 403,
        error: 'Forbidden',
        response: { message: ['This name "dup" is already in use.'] },
      },
      403,
    );
    await expect(instanceExecute.create.call(ctx, 0)).rejects.toMatchObject({
      message: 'Forbidden: This name "dup" is already in use.',
      httpCode: '403',
    });
  });

  it('outputs the QR code of a new Baileys instance as binary', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        newInstanceName: 'qr',
        integration: 'WHATSAPP-BAILEYS',
        qrcode: true,
        options: { qrCodeAsBinary: true },
      },
    });
    ctx.http.reply('POST', '/instance/create', { hash: 'h', qrcode: { base64: QR_DATA_URI } }, 201);
    const result = (await instanceExecute.create.call(ctx, 0)) as INodeExecutionData[];
    expect(result[0].binary?.data?.mimeType).toBe('image/png');
    expect(result[0].json.hash).toBeUndefined();
  });

  it.each(['WHATSAPP-BAILEYS', 'WHATSAPP-BUSINESS', 'EVOLUTION'])(
    'rejects Wavoip before creating a %s instance with no socket',
    async (integration) => {
      const ctx = createMockExecuteFunctions({
        params: {
          resource: 'instance', operation: 'create', newInstanceName: 'new', integration,
          businessToken: 'meta-token', phoneNumberId: '123',
          instanceSettings: { wavoipToken: 'voice-secret' },
        },
      });
      await expect(new EvolutionApi().execute.call(ctx)).rejects.toMatchObject({
        message: 'Wavoip Token cannot be set during instance creation',
        description: expect.stringContaining('Settings > Set'),
      });
      expect(ctx.http.calls).toEqual([]);
    },
  );

  const secretResponse = {
    hash: 'instance-secret',
    instance: { instanceName: 'new', accessTokenWaBusiness: 'verify-secret' },
    chatwoot: { token: 'chatwoot-secret', url: 'https://cw.test' },
    settings: { wavoipToken: 'voice-secret', alwaysOnline: true },
    webhook: {
      webhookUrl: 'https://hook.test',
      webhookHeaders: {
        jwt_key: 'jwt-secret', Authorization: 'Bearer secret', Cookie: 'session=secret',
        'x-api-key': 'api-secret', 'x-tenant': 'sales',
      },
    },
    qrcode: { base64: QR_DATA_URI },
  };

  it.each([false, true])('redacts every create secret with QR binary %s', async (qrCodeAsBinary) => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'instance', operation: 'create', newInstanceName: 'new',
        options: { qrCodeAsBinary },
      },
    });
    ctx.http.reply('POST', '/instance/create', secretResponse, 201);
    const [output] = await new EvolutionApi().execute.call(ctx);
    expect(output[0].json).toEqual({
      instance: { instanceName: 'new' },
      chatwoot: { url: 'https://cw.test' },
      settings: { alwaysOnline: true },
      webhook: { webhookUrl: 'https://hook.test', webhookHeaders: { 'x-tenant': 'sales' } },
      qrcode: { base64: QR_DATA_URI },
    });
    expect(Boolean(output[0].binary)).toBe(qrCodeAsBinary);
    expect(secretResponse.hash).toBe('instance-secret');
    expect(secretResponse.webhook.webhookHeaders.jwt_key).toBe('jwt-secret');
  });

  it.each([false, true])('includes create secrets only on opt-in with QR binary %s', async (qrCodeAsBinary) => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'instance', operation: 'create', newInstanceName: 'new',
        options: { qrCodeAsBinary, includeSecrets: true },
      },
    });
    ctx.http.reply('POST', '/instance/create', secretResponse, 201);
    const [output] = await new EvolutionApi().execute.call(ctx);
    expect(output[0].json).toEqual(secretResponse);
    expect(Boolean(output[0].binary)).toBe(qrCodeAsBinary);
  });

  it('keeps unknown non-secret create fields without mutating the response', () => {
    const response = { hash: 'secret', token: 'secret', newField: true };
    expect(redactCreatedInstanceSecrets(response)).toEqual({ newField: true });
    expect(response.hash).toBe('secret');
  });

  it('annotates never-delivered webhook events and history completion during creation', () => {
    const webhook = createDescription.find((p) => p.name === 'webhookConfig');
    const events = (webhook?.options as INodeProperties[]).find((p) => p.name === 'events');
    const options = events?.options as INodePropertyOptions[];
    for (const value of ['APPLICATION_STARTUP', 'CONTACTS_SET', 'GROUP_UPDATE']) {
      expect(options.find((o) => o.value === value)?.description).toContain('never');
    }
    expect(options.find((o) => o.value === 'MESSAGING_HISTORY_SET')?.description)
      .toContain('History sync finished');
  });
});

describe('instance > getMany', () => {
  const instances = [
    {
      id: 'id-a',
      name: 'alpha',
      number: '5511999999999',
      token: 'tok-a',
      Chatwoot: { token: 'cw-secret', url: 'https://cw' },
      Proxy: { host: 'p', password: 'proxy-secret' },
      Setting: { rejectCall: false, wavoipToken: 'wv' },
    },
    { id: 'id-b', name: 'beta', number: null, token: 'tok-b' },
    { id: 'id-c', name: 'gamma', token: 'tok-c' },
  ];

  it('lists instances without secrets by default and applies the limit', async () => {
    const ctx = createMockExecuteFunctions({ params: { returnAll: false, limit: 2 } });
    ctx.http.reply('GET', '/instance/fetchInstances', instances);
    const result = (await instanceExecute.getMany.call(ctx, 0)) as IDataObject[];
    expect(result.map((i) => i.name)).toEqual(['alpha', 'beta']);
    expect(result[0].token).toBeUndefined();
    expect((result[0].Chatwoot as IDataObject).token).toBeUndefined();
    expect((result[0].Chatwoot as IDataObject).url).toBe('https://cw');
    expect((result[0].Proxy as IDataObject).password).toBeUndefined();
    expect((result[0].Setting as IDataObject).wavoipToken).toBeUndefined();
    expect(ctx.http.calls[0].qs).toBeUndefined();
  });

  it('keeps secrets when asked and returns all', async () => {
    const ctx = createMockExecuteFunctions({
      params: { returnAll: true, options: { includeSecrets: true } },
    });
    ctx.http.reply('GET', '/instance/fetchInstances', instances);
    const result = (await instanceExecute.getMany.call(ctx, 0)) as IDataObject[];
    expect(result).toHaveLength(3);
    expect(result[0].token).toBe('tok-a');
  });

  it('sends the filters and re-applies them client side', async () => {
    const ctx = createMockExecuteFunctions({
      params: { returnAll: true, filters: { instanceName: 'beta' } },
    });
    // develop builds ignore ?instanceName and return every instance
    ctx.http.reply('GET', '/instance/fetchInstances', instances);
    const result = (await instanceExecute.getMany.call(ctx, 0)) as IDataObject[];
    expect(ctx.http.calls[0].qs).toEqual({ instanceName: 'beta' });
    expect(result.map((i) => i.name)).toEqual(['beta']);
  });

  it('filters by instance ID and number', async () => {
    const ctx = createMockExecuteFunctions({
      params: { returnAll: true, filters: { instanceId: 'id-a', number: '+55 11 99999-9999' } },
    });
    ctx.http.reply('GET', '/instance/fetchInstances', instances);
    const result = (await instanceExecute.getMany.call(ctx, 0)) as IDataObject[];
    expect(ctx.http.calls[0].qs).toEqual({ instanceId: 'id-a', number: '5511999999999' });
    expect(result.map((i) => i.name)).toEqual(['alpha']);
  });

  it('returns no items when a filter matches nothing (Evolution answers 404)', async () => {
    // Regression: monitor.service instanceInfo/instanceInfoById throw 404 'Instance "x" not
    // found' for filters; Get Many must return an empty result, not fail the workflow.
    const ctx = createMockExecuteFunctions({
      params: { returnAll: true, filters: { instanceName: 'ghost' } },
    });
    ctx.http.reply(
      'GET',
      '/instance/fetchInstances',
      { status: 404, error: 'Not Found', response: { message: 'Instance "ghost" not found' } },
      404,
    );
    await expect(instanceExecute.getMany.call(ctx, 0)).resolves.toEqual([]);

    const byId = createMockExecuteFunctions({
      params: { returnAll: true, filters: { instanceId: 'nope' } },
    });
    byId.http.reply(
      'GET',
      '/instance/fetchInstances',
      { status: 404, error: 'Not Found', response: { message: ['Instance "nope" not found'] } },
      404,
    );
    await expect(instanceExecute.getMany.call(byId, 0)).resolves.toEqual([]);
  });

  it('still fails on a 404 without filters or on a missing route', async () => {
    const noFilter = createMockExecuteFunctions({ params: { returnAll: true } });
    noFilter.http.reply(
      'GET',
      '/instance/fetchInstances',
      { status: 404, error: 'Not Found', response: { message: 'Instance "x" not found' } },
      404,
    );
    await expect(instanceExecute.getMany.call(noFilter, 0)).rejects.toMatchObject({
      httpCode: '404',
    });

    const wrongBaseUrl = createMockExecuteFunctions({
      params: { returnAll: true, filters: { instanceName: 'a' } },
    });
    wrongBaseUrl.http.reply(
      'GET',
      '/instance/fetchInstances',
      {
        status: 404,
        error: 'Not Found',
        response: { message: ['Cannot GET /instance/fetchInstances?instanceName=a'] },
      },
      404,
    );
    await expect(instanceExecute.getMany.call(wrongBaseUrl, 0)).rejects.toMatchObject({
      httpCode: '404',
    });
  });

  it('explains filtered 401 without hiding a genuinely invalid credential', async () => {
    const ctx = createMockExecuteFunctions({
      params: { returnAll: true, filters: { instanceName: 'other' } },
    });
    ctx.http.reply(
      'GET',
      '/instance/fetchInstances',
      { status: 401, error: 'Unauthorized', response: { message: 'Unauthorized' } },
      401,
    );
    await expect(instanceExecute.getMany.call(ctx, 0)).rejects.toMatchObject({
      httpCode: '401',
      message: expect.stringContaining('filter matched nothing'),
      description: expect.stringContaining('Remove the filters to check the credential'),
    });
  });

  it('keeps the authentication hint for 401 without filters', async () => {
    const ctx = createMockExecuteFunctions({ params: { returnAll: true } });
    ctx.http.reply('GET', '/instance/fetchInstances', { status: 401, message: 'Unauthorized' }, 401);
    await expect(instanceExecute.getMany.call(ctx, 0)).rejects.toMatchObject({
      httpCode: '401', message: expect.not.stringContaining('filter matched nothing'),
    });
  });

  it('redactInstanceSecrets does not mutate the input', () => {
    const original = { name: 'x', token: 't', Chatwoot: { token: 'c' } };
    const copy = redactInstanceSecrets(original);
    expect(copy).toEqual({ name: 'x', Chatwoot: {} });
    expect(original.token).toBe('t');
    expect(original.Chatwoot.token).toBe('c');
  });
});

describe('instance > restart, logout, delete, setPresence', () => {
  it('restart uses POST (not PUT)', async () => {
    const ctx = createMockExecuteFunctions({ params: { instanceName: 'main' } });
    ctx.http.reply('POST', '/instance/restart/main', {
      instance: { instanceName: 'main', status: 'open' },
    });
    await expect(instanceExecute.restart.call(ctx, 0)).resolves.toEqual({
      instance: { instanceName: 'main', status: 'open' },
    });
  });

  it('restart of a closed instance (HTTP 200 + error: true) fails clearly', async () => {
    const ctx = createMockExecuteFunctions({ params: { instanceName: 'main' } });
    ctx.http.reply('POST', '/instance/restart/main', { error: true, message: '[object Object]' });
    await expect(instanceExecute.restart.call(ctx, 0)).rejects.toThrow('use "Connect"');
  });

  it('logout uses DELETE and surfaces the 2.3.x "not connected" 400', async () => {
    const ctx = createMockExecuteFunctions({ params: { instanceName: 'main' } });
    ctx.http
      .reply('DELETE', '/instance/logout/main', {
        status: 'SUCCESS',
        error: false,
        response: { message: 'Instance was already disconnected' },
      })
      .reply(
        'DELETE',
        '/instance/logout/main',
        {
          status: 400,
          error: 'Bad Request',
          response: { message: ['The "main" instance is not connected'] },
        },
        400,
      );
    await expect(instanceExecute.logout.call(ctx, 0)).resolves.toMatchObject({ status: 'SUCCESS' });
    await expect(instanceExecute.logout.call(ctx, 0)).rejects.toThrow(
      'Bad request: The "main" instance is not connected',
    );
  });

  it('delete uses DELETE /instance/delete/:instance', async () => {
    const ctx = createMockExecuteFunctions({ params: { instanceName: 'main' } });
    ctx.http.reply('DELETE', '/instance/delete/main', { status: 'SUCCESS', error: false });
    await expect(instanceExecute.delete.call(ctx, 0)).resolves.toMatchObject({ status: 'SUCCESS' });
  });

  it('setPresence posts { presence }', async () => {
    const ctx = createMockExecuteFunctions({
      params: { instanceName: 'main', presence: 'unavailable' },
    });
    ctx.http.reply('POST', '/instance/setPresence/main', { presence: 'unavailable' }, 201);
    await instanceExecute.setPresence.call(ctx, 0);
    expect(ctx.http.calls[0].body).toEqual({ presence: 'unavailable' });
  });

  it('uses the credential default instance when Instance Name is empty', async () => {
    const ctx = createMockExecuteFunctions({
      params: { instanceName: rl('', 'list') },
      credentials: { defaultInstance: 'fallback' },
    });
    ctx.http.reply('GET', '/instance/connectionState/fallback', { instance: { state: 'close' } });
    await instanceExecute.getConnectionState.call(ctx, 0);
    expect(ctx.http.calls[0].path).toBe('/instance/connectionState/fallback');
  });
});

describe('instance > Instance Name visibility', () => {
  it('hides the shared Instance Name only for create and getMany', () => {
    const variants = new EvolutionApi().description.properties.filter(
      (p) => p.name === 'instanceName' && p.displayOptions?.show?.resource?.includes('instance'),
    );
    expect(variants).toHaveLength(1);
    expect(variants[0].displayOptions?.show?.operation).toEqual([
      'connect',
      'delete',
      'getConnectionState',
      'logout',
      'restart',
      'setPresence',
    ]);
  });
});
