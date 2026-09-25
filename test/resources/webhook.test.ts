import type { IDataObject } from 'n8n-workflow';

import { EVOLUTION_EVENT_OPTIONS } from '../../nodes/EvolutionApi/constants';
import { EvolutionApi } from '../../nodes/EvolutionApi/EvolutionApi.node';
import { resetRetryPolicy, setRetryPolicy } from '../../nodes/EvolutionApi/GenericFunctions';
import {
  normalizeEvents,
  redactWebhookSecrets,
  WEBHOOK_EVENT_OPTIONS,
} from '../../nodes/EvolutionApi/resources/webhook/helpers';
import { createMockExecuteFunctions, rl } from '../helpers/mockExecuteFunctions';

// Tests of the webhook resource.

beforeEach(() => setRetryPolicy({ sleep: async () => undefined }));
afterEach(() => resetRetryPolicy());

const STORED_WEBHOOK = {
  id: 'w1',
  url: 'https://n8n.test/old',
  headers: { jwt_key: 'jwt-secret', 'x-tenant': 'acme', Authorization: 'Bearer abc' },
  enabled: true,
  events: ['MESSAGES_UPSERT'],
  webhookByEvents: false,
  webhookBase64: true,
};

const bodyOf = (call: { body?: unknown }) => (call.body as IDataObject).webhook as IDataObject;

describe('webhook > get', () => {
  it('GET /webhook/find/:instance', async () => {
    const ctx = createMockExecuteFunctions({
      params: { resource: 'webhook', operation: 'get', instanceName: rl('main', 'list') },
    });
    ctx.http.reply('GET', '/webhook/find/main', {
      enabled: true,
      url: 'https://n8n.test/w',
      events: ['MESSAGES_UPSERT'],
    });

    const [output] = await new EvolutionApi().execute.call(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/webhook/find/main');
    expect(call.qs).toBeUndefined();
    expect(call.body).toBeUndefined();
    expect(output.map((item) => item.json)).toEqual([
      { enabled: true, url: 'https://n8n.test/w', events: ['MESSAGES_UPSERT'] },
    ]);
    expect(output.every((item) => item.pairedItem !== undefined)).toBe(true);
  });

  it('removes jwt_key and credential headers unless Include Secrets is on', async () => {
    const ctx = createMockExecuteFunctions({
      params: { resource: 'webhook', operation: 'get', instanceName: 'main' },
      items: [{ json: {} }, { json: {} }],
      itemParams: [{}, { options: { includeSecrets: true } }],
    });
    ctx.http.reply('GET', '/webhook/find/main', STORED_WEBHOOK);
    ctx.http.reply('GET', '/webhook/find/main', STORED_WEBHOOK);

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(output[0].json.headers).toEqual({ 'x-tenant': 'acme' });
    expect(output[1].json.headers).toEqual(STORED_WEBHOOK.headers);
  });
});

describe('webhook > set', () => {
  it('sends byEvents/base64 (not webhookByEvents/webhookBase64), headers and the events list', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'webhook',
        operation: 'set',
        instanceName: rl('main'),
        webhookUrl: 'https://n8n.test/webhook/evo',
        webhookEvents: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
        additionalFields: {
          byEvents: true,
          base64: false,
          headers: '{"x-tenant": "acme"}',
          jwtKey: 'my-jwt-secret',
        },
      },
    });
    ctx.http.reply('POST', '/webhook/set/main', { ...STORED_WEBHOOK, id: 'w2' }, 201);

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls).toHaveLength(1);
    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/webhook/set/main');
    expect(call.body).toEqual({
      webhook: {
        enabled: true,
        url: 'https://n8n.test/webhook/evo',
        events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
        byEvents: true,
        base64: false,
        headers: { 'x-tenant': 'acme', jwt_key: 'my-jwt-secret' },
      },
    });
    expect(bodyOf(call)).not.toHaveProperty('webhookByEvents');
    expect(bodyOf(call)).not.toHaveProperty('webhookBase64');
    expect(output[0].json.headers).toEqual({ 'x-tenant': 'acme' });
  });

  it('always sends events: [] means every event, and untouched options are not sent', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'webhook',
        operation: 'set',
        instanceName: 'main',
        webhookUrl: 'https://n8n.test/w',
      },
    });
    ctx.http.reply('POST', '/webhook/set/main', STORED_WEBHOOK, 201);

    await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls[0].body).toEqual({
      webhook: { enabled: true, url: 'https://n8n.test/w', events: [] },
    });
  });

  it('keeps the stored URL and headers when only the JWT key changes', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'webhook',
        operation: 'set',
        instanceName: 'main',
        webhookEvents: 'messages.upsert, group-participants.update',
        additionalFields: { jwtKey: 'rotated' },
      },
    });
    ctx.http.reply('GET', '/webhook/find/main', STORED_WEBHOOK);
    ctx.http.reply('POST', '/webhook/set/main', STORED_WEBHOOK, 201);

    await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /webhook/find/main',
      'POST /webhook/set/main',
    ]);
    expect(bodyOf(ctx.http.calls[1])).toEqual({
      enabled: true,
      url: 'https://n8n.test/old',
      events: ['MESSAGES_UPSERT', 'GROUP_PARTICIPANTS_UPDATE'],
      headers: { jwt_key: 'rotated', 'x-tenant': 'acme', Authorization: 'Bearer abc' },
    });
  });

  it('disables the webhook, keeping its URL and sending events: []', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'webhook',
        operation: 'set',
        instanceName: 'main',
        webhookEnabled: false,
      },
    });
    ctx.http.reply('GET', '/webhook/find/main', STORED_WEBHOOK);
    ctx.http.reply('POST', '/webhook/set/main', { ...STORED_WEBHOOK, enabled: false }, 201);

    await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls[1].body).toEqual({
      webhook: { enabled: false, url: 'https://n8n.test/old', events: [] },
    });
  });

  it('rejects a missing or non-http URL before calling /webhook/set', async () => {
    const missing = createMockExecuteFunctions({
      params: { resource: 'webhook', operation: 'set', instanceName: 'main' },
    });
    missing.http.reply('GET', '/webhook/find/main', null);
    await expect(new EvolutionApi().execute.call(missing)).rejects.toThrow(
      'Webhook URL is required',
    );

    const invalid = createMockExecuteFunctions({
      params: {
        resource: 'webhook',
        operation: 'set',
        instanceName: 'main',
        webhookUrl: 'ftp://x',
      },
    });
    await expect(new EvolutionApi().execute.call(invalid)).rejects.toThrow(
      'Invalid webhook URL "ftp://x"',
    );
    expect(invalid.http.calls).toEqual([]);
  });

  it('rejects headers that are not a JSON object', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'webhook',
        operation: 'set',
        instanceName: 'main',
        webhookUrl: 'https://n8n.test/w',
        additionalFields: { headers: '["a"]' },
      },
    });
    await expect(new EvolutionApi().execute.call(ctx)).rejects.toThrow(
      'Headers (JSON) must be a JSON object',
    );
  });

  it('explains the 400 for MESSAGING_HISTORY_SET on 2.3.x', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'webhook',
        operation: 'set',
        instanceName: 'main',
        webhookUrl: 'https://n8n.test/w',
        webhookEvents: ['MESSAGING_HISTORY_SET'],
      },
    });
    ctx.http.reply(
      'POST',
      '/webhook/set/main',
      {
        status: 400,
        error: 'Bad Request',
        response: { message: ['webhook.events[0] is not one of enum values'] },
      },
      400,
    );
    await expect(new EvolutionApi().execute.call(ctx)).rejects.toMatchObject({
      httpCode: '400',
      description: expect.stringContaining('MESSAGING_HISTORY_SET: Requires Evolution API 2.4+.'),
    });
  });

  it('sets one webhook per item', async () => {
    const ctx = createMockExecuteFunctions({
      params: { resource: 'webhook', operation: 'set' },
      items: [{ json: {} }, { json: {} }],
      itemParams: [
        { instanceName: 'a', webhookUrl: 'https://n8n.test/a' },
        { instanceName: 'b', webhookUrl: 'https://n8n.test/b' },
      ],
    });
    ctx.http.reply('POST', '/webhook/set/a', { url: 'https://n8n.test/a' }, 201);
    ctx.http.reply('POST', '/webhook/set/b', { url: 'https://n8n.test/b' }, 201);

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(output.map((item) => item.json.url)).toEqual([
      'https://n8n.test/a',
      'https://n8n.test/b',
    ]);
    expect(output.map((item) => item.pairedItem)).toEqual([{ item: 0 }, { item: 1 }]);
  });
});

describe('webhook > getTransport', () => {
  it.each(['websocket', 'rabbitmq', 'sqs', 'nats', 'kafka', 'pusher'])(
    'GET /%s/find/:instance',
    async (transport) => {
      const ctx = createMockExecuteFunctions({
        params: {
          resource: 'webhook',
          operation: 'getTransport',
          instanceName: 'main',
          eventTransport: transport,
        },
      });
      ctx.http.reply('GET', `/${transport}/find/main`, { enabled: true, events: [] });
      const [output] = await new EvolutionApi().execute.call(ctx);
      expect(ctx.http.calls[0].method).toBe('GET');
      expect(ctx.http.calls[0].path).toBe(`/${transport}/find/main`);
      expect(output[0].json).toEqual({ enabled: true, events: [] });
    },
  );

  it('removes the Pusher secret and returns {} when the transport is off', async () => {
    const ctx = createMockExecuteFunctions({
      params: { resource: 'webhook', operation: 'getTransport', instanceName: 'main' },
      items: [{ json: {} }, { json: {} }],
      itemParams: [{ eventTransport: 'pusher' }, { eventTransport: 'kafka' }],
    });
    ctx.http.reply('GET', '/pusher/find/main', { enabled: true, key: 'k', secret: 's' });
    ctx.http.reply('GET', '/kafka/find/main', '');

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(output.map((item) => item.json)).toEqual([{ enabled: true, key: 'k' }, {}]);
  });

  it('rejects an unknown transport from an expression', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'webhook',
        operation: 'getTransport',
        instanceName: 'main',
        eventTransport: 'webhook',
      },
    });
    await expect(new EvolutionApi().execute.call(ctx)).rejects.toThrow('Unknown transport');
  });
});

describe('webhook > setTransport', () => {
  it.each(['websocket', 'rabbitmq', 'sqs', 'nats', 'kafka'])(
    'POST /%s/set/:instance { <transport>: { enabled, events } }',
    async (transport) => {
      const ctx = createMockExecuteFunctions({
        params: {
          resource: 'webhook',
          operation: 'setTransport',
          instanceName: 'main',
          eventTransport: transport,
          transportEvents: ['MESSAGES_UPSERT'],
        },
      });
      ctx.http.reply('POST', `/${transport}/set/main`, { id: 't1', enabled: true }, 201);

      const [output] = await new EvolutionApi().execute.call(ctx);

      expect(ctx.http.calls).toHaveLength(1);
      expect(ctx.http.calls[0].method).toBe('POST');
      expect(ctx.http.calls[0].path).toBe(`/${transport}/set/main`);
      expect(ctx.http.calls[0].body).toEqual({
        [transport]: { enabled: true, events: ['MESSAGES_UPSERT'] },
      });
      expect(output[0].json).toEqual({ id: 't1', enabled: true });
    },
  );

  it('disables a transport with events: []', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'webhook',
        operation: 'setTransport',
        instanceName: 'main',
        eventTransport: 'rabbitmq',
        transportEnabled: false,
        transportEvents: ['CALL'],
      },
    });
    ctx.http.reply('POST', '/rabbitmq/set/main', { enabled: false, events: [] }, 201);
    await new EvolutionApi().execute.call(ctx);
    expect(ctx.http.calls[0].body).toEqual({ rabbitmq: { enabled: false, events: [] } });
  });

  it('turns the empty 201 of a transport that is off on the server into an error', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'webhook',
        operation: 'setTransport',
        instanceName: 'main',
        eventTransport: 'sqs',
      },
    });
    ctx.http.reply('POST', '/sqs/set/main', '', 201);
    await expect(new EvolutionApi().execute.call(ctx)).rejects.toMatchObject({
      message: 'Evolution API did not save the Amazon SQS configuration',
      description: expect.stringContaining('SQS_ENABLED=true'),
    });
  });

  it('merges Pusher settings with the stored ones and removes the secret from the output', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'webhook',
        operation: 'setTransport',
        instanceName: 'main',
        eventTransport: 'pusher',
        pusherConfig: { cluster: 'eu' },
      },
    });
    ctx.http.reply('GET', '/pusher/find/main', {
      enabled: true,
      appId: '123',
      key: 'key',
      secret: 'secret',
      cluster: 'us2',
      useTLS: false,
    });
    ctx.http.reply(
      'POST',
      '/pusher/set/main',
      { enabled: true, appId: '123', cluster: 'eu', secret: 'secret' },
      201,
    );

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /pusher/find/main',
      'POST /pusher/set/main',
    ]);
    expect(ctx.http.calls[1].body).toEqual({
      pusher: {
        enabled: true,
        events: [],
        appId: '123',
        key: 'key',
        secret: 'secret',
        cluster: 'eu',
        useTLS: false,
      },
    });
    expect(output[0].json).toEqual({ enabled: true, appId: '123', cluster: 'eu' });
  });

  it('requires the Pusher app settings to enable it', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'webhook',
        operation: 'setTransport',
        instanceName: 'main',
        eventTransport: 'pusher',
        pusherConfig: { appId: '1' },
      },
    });
    ctx.http.reply('GET', '/pusher/find/main', '');
    await expect(new EvolutionApi().execute.call(ctx)).rejects.toThrow(
      'Missing Pusher settings: key, secret, cluster',
    );
    expect(ctx.http.calls).toHaveLength(1);
  });
});

describe('webhook helpers', () => {
  it('lists every accepted event (31 on 2.3.7 + MESSAGING_HISTORY_SET) with a description', () => {
    expect(WEBHOOK_EVENT_OPTIONS.map((o) => o.value)).toEqual(
      EVOLUTION_EVENT_OPTIONS.map((o) => o.value),
    );
    expect(WEBHOOK_EVENT_OPTIONS).toHaveLength(32);
    for (const option of WEBHOOK_EVENT_OPTIONS) expect(option.description).toBeTruthy();
    const history = WEBHOOK_EVENT_OPTIONS.find((o) => o.value === 'MESSAGING_HISTORY_SET');
    expect(history?.description).toContain('Requires Evolution API 2.4+');
    const groupUpdate = WEBHOOK_EVENT_OPTIONS.find((o) => o.value === 'GROUP_UPDATE');
    expect(groupUpdate?.description).toContain('never delivered');
  });

  it('normalizes event names from arrays, strings and dotted payload names', () => {
    expect(normalizeEvents(['MESSAGES_UPSERT', 'messages.upsert', ' call '])).toEqual([
      'MESSAGES_UPSERT',
      'CALL',
    ]);
    expect(normalizeEvents('messaging-history.set\nsend.message.update')).toEqual([
      'MESSAGING_HISTORY_SET',
      'SEND_MESSAGE_UPDATE',
    ]);
    expect(normalizeEvents(undefined)).toEqual([]);
  });

  it('leaves rows without headers untouched', () => {
    expect(redactWebhookSecrets({ url: 'x', headers: null })).toEqual({ url: 'x', headers: null });
  });
});
