import { createHmac } from 'crypto';
import type {
  IDataObject,
  IHookFunctions,
  INodeProperties,
  INodePropertyOptions,
  IWebhookFunctions,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { EVOLUTION_EVENT_OPTIONS, REQUIRES_24 } from '../nodes/EvolutionApi/constants';
import { EvolutionApiTrigger } from '../nodes/EvolutionApi/EvolutionApiTrigger.node';
import {
  CREDENTIAL_TYPE,
  resetRetryPolicy,
  searchInstances,
  setRetryPolicy,
} from '../nodes/EvolutionApi/GenericFunctions';
import {
  getBearerToken,
  safeEqual,
  verifyEvolutionJwt,
  verifyWebhookRequest,
} from '../nodes/EvolutionApi/trigger/auth';
import {
  DEDUPE_MAX_STATIC_ENTRIES,
  DEDUPE_TTL_MS,
  MESSAGE_TYPE_OPTIONS,
  NEVER_DELIVERED_EVENTS,
  SECRET_HEADER_NAME,
  TRIGGER_EVENT_OPTIONS,
} from '../nodes/EvolutionApi/trigger/constants';
import {
  getDeliveryKey,
  isDuplicateDelivery,
  rememberDelivery,
  resetDeliveryMemory,
} from '../nodes/EvolutionApi/trigger/dedupe';
import {
  extractText,
  getMessageFields,
  normalizeEventName,
  normalizeMessageType,
} from '../nodes/EvolutionApi/trigger/payload';
import {
  buildRestoreBody,
  isOtherEndpointOfNode,
  isVersionBelow,
  resetRegistrationMemory,
  snapshotWebhook,
} from '../nodes/EvolutionApi/trigger/registration';
import type { WebhookRegistration } from '../nodes/EvolutionApi/trigger/registration';
import { createMockExecuteFunctions, rl, TEST_NODE } from './helpers/mockExecuteFunctions';

// Tests of the trigger node (owned by the trigger agent).

const WEBHOOK_URL = 'https://n8n.test/webhook/2f9c/webhook';
const TEST_WEBHOOK_URL = 'https://n8n.test/webhook-test/2f9c/webhook';
const JWT_SECRET = 'a'.repeat(64);
const HEADER_SECRET = 'b'.repeat(64);

const trigger = new EvolutionApiTrigger();
const { properties } = trigger.description;

/** Top-level defaults of the trigger description (n8n returns them for unset parameters). */
const TRIGGER_DEFAULTS: IDataObject = Object.fromEntries(
  properties
    .filter((property) => property.type !== 'notice')
    .map((property) => [property.name, property.default]),
);

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

/** HS256 JWT exactly as jsonwebtoken.sign(payload, secret, { algorithm: 'HS256' }) builds it. */
function signJwt(
  payload: IDataObject,
  secret: string,
  header: IDataObject = { alg: 'HS256', typ: 'JWT' },
): string {
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createHmac('sha256', secret).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

/** Token as Evolution's WebhookController.generateJwtToken signs it. */
function evolutionJwt(secret = JWT_SECRET, issuedAt = Math.floor(Date.now() / 1000)): string {
  return signJwt(
    { iat: issuedAt, exp: issuedAt + 600, app: 'evolution', action: 'webhook' },
    secret,
  );
}

interface MockResponse {
  statusCode?: number;
  body?: unknown;
  status: jest.Mock;
  json: jest.Mock;
  setHeader: jest.Mock;
}

function createResponse(): MockResponse {
  const res: MockResponse = { status: jest.fn(), json: jest.fn(), setHeader: jest.fn() };
  res.status.mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json.mockImplementation((body: unknown) => {
    res.body = body;
    return res;
  });
  return res;
}

interface TriggerContextOptions {
  params?: IDataObject;
  staticData?: IDataObject;
  /**
   * URL returned by getNodeWebhookUrl. Hooks get the URL of the endpoint being registered;
   * n8n's webhook() context ALWAYS gets the production URL, also for test deliveries.
   */
  webhookUrl?: string;
  /** Execution mode: 'manual' for "Listen for test event" (hooks and deliveries). */
  executionMode?: string;
  /** When set, the context has getWebhookResourceUrl (newer n8n) returning this URL. */
  servedUrl?: string;
  headers?: IDataObject;
  body?: unknown;
  credentials?: IDataObject;
}

/** The trigger node; n8n gives webhook nodes a webhookId (the UUID in their URLs). */
const TRIGGER_NODE = { ...TEST_NODE, name: 'Evolution API Trigger', webhookId: '2f9c' };

/**
 * IHookFunctions / IWebhookFunctions built on the shared harness (HTTP mock, credentials,
 * logger, prepareBinaryData) plus the hook/webhook methods the trigger uses.
 */
function createTriggerContext(options: TriggerContextOptions = {}) {
  const base = createMockExecuteFunctions({
    credentials: options.credentials,
    useDescriptionDefaults: false,
  });
  const params: IDataObject = { ...TRIGGER_DEFAULTS, ...(options.params ?? {}) };
  const staticData = options.staticData ?? {};
  const res = createResponse();
  if (options.servedUrl !== undefined) {
    Object.assign(base, { getWebhookResourceUrl: jest.fn(() => options.servedUrl) });
  }
  const ctx = Object.assign(base, {
    getNode: jest.fn(() => TRIGGER_NODE),
    getNodeParameter: jest.fn(
      (name: string, fallback?: unknown, parameterOptions?: { extractValue?: boolean }) => {
        const value = params[name];
        if (value === undefined) return fallback;
        if (
          parameterOptions?.extractValue &&
          value !== null &&
          typeof value === 'object' &&
          '__rl' in (value as IDataObject)
        ) {
          return (value as IDataObject).value;
        }
        return value;
      },
    ),
    getWorkflowStaticData: jest.fn(() => staticData),
    getNodeWebhookUrl: jest.fn(() => options.webhookUrl ?? WEBHOOK_URL),
    getWebhookName: jest.fn(() => 'default'),
    getMode: jest.fn(() => options.executionMode ?? 'trigger'),
    getActivationMode: jest.fn(() => 'activate'),
    getWorkflow: jest.fn(() => ({ id: 'workflow-1', active: true })),
    getBodyData: jest.fn(() => options.body ?? {}),
    getHeaderData: jest.fn(() => options.headers ?? {}),
    getResponseObject: jest.fn(() => res),
  });
  return {
    ctx,
    hook: ctx as unknown as IHookFunctions,
    webhook: ctx as unknown as IWebhookFunctions,
    res,
    staticData,
    http: base.http,
    logger: base.logger as unknown as Record<'debug' | 'info' | 'warn' | 'error', jest.Mock>,
  };
}

const methods = trigger.webhookMethods.default;

function registration(overrides: Partial<WebhookRegistration> = {}): WebhookRegistration {
  return {
    instanceName: 'main',
    auth: 'jwtAndHeader',
    jwtSecret: JWT_SECRET,
    headerSecret: HEADER_SECRET,
    previous: null,
    registeredAt: '2026-09-25T00:00:00.000Z',
    ...overrides,
  };
}

function registeredStaticData(overrides: Partial<WebhookRegistration> = {}): IDataObject {
  return { registrations: { [WEBHOOK_URL]: registration(overrides) } };
}

function validHeaders(extra: IDataObject = {}): IDataObject {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${evolutionJwt()}`,
    [SECRET_HEADER_NAME]: HEADER_SECRET,
    ...extra,
  };
}

/** A previous webhook configuration as /webhook/find returns it. */
const PREVIOUS_ROW: IDataObject = {
  id: 'wh-1',
  url: 'https://crm.example.com/hooks/evolution',
  headers: { authorization: 'Bearer crm-token', jwt_key: 'crm-jwt' },
  enabled: true,
  events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
  webhookByEvents: true,
  webhookBase64: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  instanceId: 'instance-uuid',
};

/** messages.upsert as Evolution 2.4 sends it (remoteJid = phone JID, remoteJidAlt = @lid). */
function upsertBody(overrides: IDataObject = {}, dataOverrides: IDataObject = {}): IDataObject {
  return {
    event: 'messages.upsert',
    instance: 'main',
    data: {
      key: {
        remoteJid: '5215512345678@s.whatsapp.net',
        remoteJidAlt: '123456789012345@lid',
        fromMe: false,
        id: '3EB0C767D26A1D8E',
        addressingMode: 'pn',
      },
      pushName: 'Ana',
      status: 'DELIVERY_ACK',
      message: { conversation: 'Hola' },
      contextInfo: null,
      messageType: 'conversation',
      messageTimestamp: 1758793500,
      instanceId: 'instance-uuid',
      source: 'android',
      ...dataOverrides,
    },
    destination: WEBHOOK_URL,
    date_time: '2026-09-25T10:15:00.000Z',
    sender: '5215500000000@s.whatsapp.net',
    server_url: 'https://evo.test',
    apikey: 'INSTANCE-TOKEN',
    ...overrides,
  };
}

async function runWebhook(options: TriggerContextOptions) {
  const context = createTriggerContext({
    staticData: registeredStaticData(),
    headers: validHeaders(),
    ...options,
  });
  const result = await trigger.webhook.call(context.webhook);
  return { ...context, result };
}

beforeEach(() => {
  setRetryPolicy({ sleep: async () => undefined });
  resetDeliveryMemory();
  resetRegistrationMemory();
});
afterEach(() => resetRetryPolicy());

// ============================================================================
// Description
// ============================================================================

describe('EvolutionApiTrigger description', () => {
  it('is a webhook trigger with the package credential', () => {
    const { description } = trigger;
    expect(description.name).toBe('evolutionApiTrigger');
    expect(description.displayName).toContain('Trigger');
    expect(description.group).toEqual(['trigger']);
    expect(description.inputs).toEqual([]);
    expect(description.outputs).toEqual(['main']);
    expect(description.webhooks).toEqual([
      { name: 'default', httpMethod: 'POST', responseMode: 'onReceived', path: 'webhook' },
    ]);
    expect(description.credentials).toEqual([
      { name: CREDENTIAL_TYPE, required: true, displayOptions: { show: { mode: ['automatic'] } } },
    ]);
    expect(description.usableAsTool).toBeUndefined();
  });

  it('implements the complete webhook lifecycle and the instance list', () => {
    expect(typeof methods.checkExists).toBe('function');
    expect(typeof methods.create).toBe('function');
    expect(typeof methods.delete).toBe('function');
    expect(trigger.methods.listSearch.searchInstances).toBe(searchInstances);
    const instance = properties.find((property) => property.name === 'instanceName');
    expect(instance?.modes?.[0].typeOptions?.searchListMethod).toBe('searchInstances');
    expect(instance?.displayOptions).toEqual({ show: { mode: ['automatic'] } });
  });

  it('defaults to Automatic mode, MESSAGES_UPSERT and JWT + secret header', () => {
    expect(TRIGGER_DEFAULTS.mode).toBe('automatic');
    expect(TRIGGER_DEFAULTS.events).toEqual(['MESSAGES_UPSERT']);
    expect(TRIGGER_DEFAULTS.autoAuth).toBe('jwtAndHeader');
    expect(TRIGGER_DEFAULTS.manualAuth).toBe('jwt');
    expect(TRIGGER_DEFAULTS.options).toEqual({});
  });

  it('warns that the instance has a single webhook and that the global webhook is unauthenticated', () => {
    const notices = properties.filter((property) => property.type === 'notice');
    const automatic = notices.find((notice) => notice.name === 'automaticNotice');
    const manual = notices.find((notice) => notice.name === 'manualNotice');
    expect(automatic?.displayName).toMatch(/ONE webhook per instance/);
    expect(automatic?.displayName).toMatch(/restored/);
    expect(manual?.displayName).toMatch(/global webhook cannot send headers or a JWT/);
  });

  it('offers every deliverable event, sorted, with 2.4-only events marked', () => {
    const values = TRIGGER_EVENT_OPTIONS.map((option) => option.value);
    const accepted = EVOLUTION_EVENT_OPTIONS.map((option) => option.value);
    expect(values.every((value) => accepted.includes(value))).toBe(true);
    expect(values).toHaveLength(accepted.length - NEVER_DELIVERED_EVENTS.length);
    for (const never of NEVER_DELIVERED_EVENTS) expect(values).not.toContain(never);
    const names = TRIGGER_EVENT_OPTIONS.map((option) => option.name);
    expect(names).toEqual([...names].sort());
    const history = TRIGGER_EVENT_OPTIONS.find(
      (option) => option.value === 'MESSAGING_HISTORY_SET',
    );
    expect(history?.description).toContain(REQUIRES_24);
    const events = properties.find((property) => property.name === 'events');
    expect(events?.options).toBe(TRIGGER_EVENT_OPTIONS);
    expect(events?.description).toContain(REQUIRES_24);
  });

  it('keeps options, message types and choices sorted, and boolean descriptions start with "Whether"', () => {
    const options = properties.find((property) => property.name === 'options')
      ?.options as INodeProperties[];
    const names = options.map((option) => option.displayName);
    expect(names).toEqual([...names].sort());
    for (const option of options.filter((candidate) => candidate.type === 'boolean')) {
      expect(option.description).toMatch(/^Whether /);
    }
    const typeNames = MESSAGE_TYPE_OPTIONS.map((option) => option.name);
    expect(typeNames).toEqual([...typeNames].sort());
    for (const name of ['mode', 'autoAuth', 'manualAuth']) {
      const choices = (properties.find((property) => property.name === name)?.options ??
        []) as INodePropertyOptions[];
      const choiceNames = choices.map((choice) => choice.name);
      expect(choiceNames).toEqual([...choiceNames].sort());
      expect(choices.every((choice) => choice.description)).toBe(true);
    }
  });

  it('stores manual secrets as password fields', () => {
    for (const name of ['headerValue', 'jwtSecret']) {
      const property = properties.find((candidate) => candidate.name === name);
      expect(property?.typeOptions?.password).toBe(true);
      expect(property?.displayOptions?.show?.mode).toEqual(['manual']);
    }
  });

  it('has a codex file for the trigger', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const codex = require('../nodes/EvolutionApi/EvolutionApiTrigger.node.json');
    expect(codex.node).toBe('@renatoascencio/n8n-nodes-evolution-api.evolutionApiTrigger');
    expect(codex.categories).toContain('Communication');
  });
});

// ============================================================================
// Lifecycle: Automatic mode
// ============================================================================

describe('webhookMethods.create (Automatic)', () => {
  it('saves the current webhook and registers the n8n URL with JWT + secret header', async () => {
    const { hook, http, staticData } = createTriggerContext({
      params: { instanceName: rl('main', 'list') },
    });
    http.reply('GET', '/webhook/find/main', PREVIOUS_ROW);
    http.reply('POST', '/webhook/set/main', { id: 'wh-1' }, 201);

    await expect(methods.create.call(hook)).resolves.toBe(true);

    expect(http.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /webhook/find/main',
      'POST /webhook/set/main',
    ]);
    const body = http.calls[1].body as IDataObject;
    const webhook = body.webhook as IDataObject;
    expect(Object.keys(body)).toEqual(['webhook']);
    expect(webhook).toMatchObject({
      url: WEBHOOK_URL,
      enabled: true,
      events: ['MESSAGES_UPSERT'],
      byEvents: false,
      base64: false,
    });
    expect(Object.keys(webhook).sort()).toEqual(
      ['base64', 'byEvents', 'enabled', 'events', 'headers', 'url'].sort(),
    );
    const headers = webhook.headers as IDataObject;
    expect(Object.keys(headers).sort()).toEqual(['jwt_key', SECRET_HEADER_NAME].sort());
    expect(headers.jwt_key).toMatch(/^[0-9a-f]{64}$/);
    expect(headers[SECRET_HEADER_NAME]).toMatch(/^[0-9a-f]{64}$/);
    expect(headers.jwt_key).not.toBe(headers[SECRET_HEADER_NAME]);

    const saved = (staticData.registrations as IDataObject)[WEBHOOK_URL] as WebhookRegistration;
    expect(saved).toMatchObject({
      instanceName: 'main',
      auth: 'jwtAndHeader',
      jwtSecret: headers.jwt_key,
      headerSecret: headers[SECRET_HEADER_NAME],
      previous: {
        url: PREVIOUS_ROW.url,
        enabled: true,
        events: PREVIOUS_ROW.events,
        headers: PREVIOUS_ROW.headers,
        webhookByEvents: true,
        webhookBase64: true,
      },
    });
    expect(http.pending).toEqual([]);
  });

  it('sends every selected event, [] for all events, and the base64 option', async () => {
    const { hook, http } = createTriggerContext({
      params: { instanceName: rl('main'), events: [], options: { webhookBase64: true } },
    });
    http.reply('GET', '/webhook/find/main', null);
    http.reply('POST', '/webhook/set/main', {}, 201);

    await methods.create.call(hook);

    const webhook = (http.calls[1].body as IDataObject).webhook as IDataObject;
    expect(webhook.events).toEqual([]);
    expect(webhook.base64).toBe(true);
  });

  it.each([
    ['jwt', ['jwt_key']],
    ['header', [SECRET_HEADER_NAME]],
  ])('registers only the secrets of the "%s" method', async (autoAuth, expectedHeaders) => {
    const { hook, http, staticData } = createTriggerContext({
      params: { instanceName: rl('main'), autoAuth },
    });
    http.reply('GET', '/webhook/find/main', null);
    http.reply('POST', '/webhook/set/main', {}, 201);

    await methods.create.call(hook);

    const webhook = (http.calls[1].body as IDataObject).webhook as IDataObject;
    expect(Object.keys(webhook.headers as IDataObject)).toEqual(expectedHeaders);
    const saved = (staticData.registrations as IDataObject)[WEBHOOK_URL] as IDataObject;
    expect(saved.auth).toBe(autoAuth);
    expect('jwtSecret' in saved).toBe(autoAuth === 'jwt');
    expect('headerSecret' in saved).toBe(autoAuth === 'header');
  });

  it('records "no previous webhook" when the instance has none (find answers null)', async () => {
    const { hook, http, staticData } = createTriggerContext({
      params: { instanceName: rl('main') },
    });
    http.reply('GET', '/webhook/find/main', null);
    http.reply('POST', '/webhook/set/main', {}, 201);

    await methods.create.call(hook);

    const saved = (staticData.registrations as IDataObject)[WEBHOOK_URL] as IDataObject;
    expect(saved.previous).toBeNull();
  });

  it('uses the default instance of the credential and URL-encodes the name', async () => {
    const { hook, http, staticData } = createTriggerContext({
      params: { instanceName: rl('', 'list') },
      credentials: { defaultInstance: 'Sales Team' },
    });
    http.reply('GET', '/webhook/find/Sales%20Team', null);
    http.reply('POST', '/webhook/set/Sales%20Team', {}, 201);

    await methods.create.call(hook);

    expect(http.calls.map((call) => call.path)).toEqual([
      '/webhook/find/Sales%20Team',
      '/webhook/set/Sales%20Team',
    ]);
    const saved = (staticData.registrations as IDataObject)[WEBHOOK_URL] as IDataObject;
    expect(saved.instanceName).toBe('Sales Team');
  });

  it('fails clearly when no instance is selected', async () => {
    const { hook, http } = createTriggerContext({ params: { instanceName: rl('') } });
    await expect(methods.create.call(hook)).rejects.toThrow('No instance selected');
    expect(http.calls).toEqual([]);
  });

  it('never saves its own webhook as the previous one (earlier restore failed)', async () => {
    const staticData = registeredStaticData({
      previous: { url: 'https://crm.example.com/hooks', enabled: true, events: [] },
    });
    const { hook, http } = createTriggerContext({
      params: { instanceName: rl('main') },
      staticData,
    });
    http.reply('GET', '/webhook/find/main', { url: WEBHOOK_URL, enabled: false, headers: {} });
    http.reply('POST', '/webhook/set/main', {}, 201);

    await methods.create.call(hook);

    const saved = (staticData.registrations as IDataObject)[WEBHOOK_URL] as IDataObject;
    expect(saved.previous).toEqual({
      url: 'https://crm.example.com/hooks',
      enabled: true,
      events: [],
    });
    expect(saved.jwtSecret).not.toBe(JWT_SECRET);
  });

  it('refuses MESSAGING_HISTORY_SET on Evolution API 2.3.x before touching the webhook', async () => {
    const { hook, http } = createTriggerContext({
      params: { instanceName: rl('main'), events: ['MESSAGES_UPSERT', 'MESSAGING_HISTORY_SET'] },
    });
    http.reply('GET', '/', { status: 200, version: '2.3.7' });

    const error = await methods.create.call(hook).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NodeOperationError);
    expect((error as Error).message).toBe(
      'Event MESSAGING_HISTORY_SET requires Evolution API 2.4+ (this server runs 2.3.7)',
    );
    expect(http.calls.map((call) => call.path)).toEqual(['/']);
  });

  it('registers MESSAGING_HISTORY_SET on Evolution API 2.4', async () => {
    const { hook, http } = createTriggerContext({
      params: { instanceName: rl('main'), events: ['MESSAGING_HISTORY_SET'] },
    });
    http.reply('GET', '/', { status: 200, version: '2.4.0' });
    http.reply('GET', '/webhook/find/main', null);
    http.reply('POST', '/webhook/set/main', {}, 201);

    await methods.create.call(hook);

    const webhook = (http.calls[2].body as IDataObject).webhook as IDataObject;
    expect(webhook.events).toEqual(['MESSAGING_HISTORY_SET']);
  });

  it('shows the Evolution error when /webhook/set fails', async () => {
    const { hook, http } = createTriggerContext({ params: { instanceName: rl('main') } });
    http.reply('GET', '/webhook/find/main', null);
    http.reply(
      'POST',
      '/webhook/set/main',
      { status: 400, error: 'Bad Request', response: { message: ['Invalid "url" property'] } },
      400,
    );

    await expect(methods.create.call(hook)).rejects.toMatchObject({
      message: 'Bad request: Invalid "url" property',
      httpCode: '400',
    });
  });

  it('does nothing in Manual mode', async () => {
    const { hook, http } = createTriggerContext({ params: { mode: 'manual' } });
    await expect(methods.create.call(hook)).resolves.toBe(true);
    expect(http.calls).toEqual([]);
  });
});

describe('webhookMethods.checkExists', () => {
  const ours = {
    url: WEBHOOK_URL,
    enabled: true,
    events: ['MESSAGES_UPSERT'],
    headers: { jwt_key: JWT_SECRET, [SECRET_HEADER_NAME]: HEADER_SECRET },
  };

  it('is true when the instance webhook is ours, enabled and still carries our secrets', async () => {
    const { hook, http } = createTriggerContext({
      params: { instanceName: rl('main') },
      staticData: registeredStaticData(),
    });
    http.reply('GET', '/webhook/find/main', ours);

    await expect(methods.checkExists.call(hook)).resolves.toBe(true);
    expect(http.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /webhook/find/main',
    ]);
  });

  it.each([
    ['another URL', { ...ours, url: 'https://crm.example.com/hooks' }],
    ['disabled', { ...ours, enabled: false }],
    ['"Webhook by Events" on (deliveries go to <url>/<event>)', { ...ours, webhookByEvents: true }],
    ['other headers', { ...ours, headers: { jwt_key: 'changed' } }],
    ['no webhook', null],
  ])('is false when the webhook has %s', async (_label, found) => {
    const { hook, http } = createTriggerContext({
      params: { instanceName: rl('main') },
      staticData: registeredStaticData(),
    });
    http.reply('GET', '/webhook/find/main', found);
    await expect(methods.checkExists.call(hook)).resolves.toBe(false);
  });

  it('is false without a registration for this URL, the instance or the method', async () => {
    const cases: Array<[IDataObject, IDataObject]> = [
      [{ instanceName: rl('main') }, {}],
      [{ instanceName: rl('other') }, registeredStaticData()],
      [{ instanceName: rl('main'), autoAuth: 'jwt' }, registeredStaticData()],
    ];
    for (const [params, staticData] of cases) {
      const { hook, http } = createTriggerContext({ params, staticData });
      await expect(methods.checkExists.call(hook)).resolves.toBe(false);
      expect(http.calls).toEqual([]);
    }
  });

  it('keeps the production and test registrations apart', async () => {
    const { hook, http } = createTriggerContext({
      params: { instanceName: rl('main') },
      staticData: registeredStaticData(),
      webhookUrl: TEST_WEBHOOK_URL,
    });
    await expect(methods.checkExists.call(hook)).resolves.toBe(false);
    expect(http.calls).toEqual([]);
  });

  it('Manual mode: nothing to register, but the configured secrets are validated', async () => {
    const valid = createTriggerContext({ params: { mode: 'manual', manualAuth: 'none' } });
    await expect(methods.checkExists.call(valid.hook)).resolves.toBe(true);
    expect(valid.http.calls).toEqual([]);
    expect(valid.logger.warn).toHaveBeenCalledTimes(1);
    expect(valid.logger.warn).toHaveBeenCalledWith(
      `Evolution API Trigger: Manual mode without authentication accepts any request to ${WEBHOOK_URL}`,
    );

    const secureDefault = createTriggerContext({ params: { mode: 'manual' } });
    await expect(methods.checkExists.call(secureDefault.hook)).rejects.toThrow('Set "JWT Secret"');
    const authenticated = createTriggerContext({
      params: { mode: 'manual', jwtSecret: JWT_SECRET },
    });
    await expect(methods.checkExists.call(authenticated.hook)).resolves.toBe(true);
    expect(authenticated.logger.warn).not.toHaveBeenCalled();

    const missingHeader = createTriggerContext({
      params: { mode: 'manual', manualAuth: 'header', headerValue: '' },
    });
    await expect(methods.checkExists.call(missingHeader.hook)).rejects.toThrow(
      'Set "Header Value" (the secret header Evolution sends)',
    );

    const missingJwt = createTriggerContext({
      params: { mode: 'manual', manualAuth: 'jwtAndHeader', headerValue: 'x', jwtSecret: '' },
    });
    await expect(methods.checkExists.call(missingJwt.hook)).rejects.toThrow(
      'Set "JWT Secret" (the jwt_key of the Evolution webhook)',
    );
  });
});

describe('webhookMethods.delete', () => {
  const previous = snapshotWebhook(PREVIOUS_ROW) as IDataObject;

  it('restores a takeover during activation rollback with reloaded empty static data', async () => {
    const activation = createTriggerContext({ params: { instanceName: rl('main') } });
    activation.http.reply('GET', '/webhook/find/main', PREVIOUS_ROW);
    activation.http.reply('POST', '/webhook/set/main', {}, 201);
    await methods.create.call(activation.hook);
    const takeover = (activation.http.calls[1].body as IDataObject).webhook as IDataObject;

    const rollback = createTriggerContext({ params: { instanceName: rl('main') }, staticData: {} });
    rollback.http.reply('GET', '/webhook/find/main', takeover);
    rollback.http.reply('POST', '/webhook/set/main', {}, 201);
    await expect(methods.delete.call(rollback.hook)).resolves.toBe(true);
    expect(rollback.http.calls[1].body).toEqual(buildRestoreBody(previous));
  });

  it('does not restore process recovery state over changed secrets at the same URL', async () => {
    const activation = createTriggerContext({ params: { instanceName: rl('main') } });
    activation.http.reply('GET', '/webhook/find/main', PREVIOUS_ROW);
    activation.http.reply('POST', '/webhook/set/main', {}, 201);
    await methods.create.call(activation.hook);

    const rollback = createTriggerContext({ params: { instanceName: rl('main') }, staticData: {} });
    rollback.http.reply('GET', '/webhook/find/main', {
      url: WEBHOOK_URL,
      enabled: true,
      headers: { jwt_key: 'another-owner' },
    });
    await expect(methods.delete.call(rollback.hook)).resolves.toBe(true);
    expect(rollback.http.calls).toHaveLength(1);
  });

  it('disables an orphaned exact endpoint after process loss and logs the missing snapshot', async () => {
    const activation = createTriggerContext({ params: { instanceName: rl('main') } });
    activation.http.reply('GET', '/webhook/find/main', PREVIOUS_ROW);
    activation.http.reply('POST', '/webhook/set/main', {}, 201);
    await methods.create.call(activation.hook);
    const takeover = (activation.http.calls[1].body as IDataObject).webhook as IDataObject;
    resetRegistrationMemory();

    const rollback = createTriggerContext({ params: { instanceName: rl('main') }, staticData: {} });
    rollback.http.reply('GET', '/webhook/find/main', takeover);
    rollback.http.reply('POST', '/webhook/set/main', {}, 201);
    await expect(methods.delete.call(rollback.hook)).resolves.toBe(true);
    expect((rollback.http.calls[1].body as IDataObject).webhook).toMatchObject({
      url: WEBHOOK_URL,
      enabled: false,
      headers: {},
    });
    expect(rollback.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('could not be recovered'),
    );
  });

  it.each([
    [WEBHOOK_URL, { jwt_key: 'manually-configured' }],
    [TEST_WEBHOOK_URL, { jwt_key: JWT_SECRET, [SECRET_HEADER_NAME]: HEADER_SECRET }],
  ])('orphan cleanup leaves unowned configuration untouched: %s', async (url, headers) => {
    const rollback = createTriggerContext({ params: { instanceName: rl('main') }, staticData: {} });
    rollback.http.reply('GET', '/webhook/find/main', { url, enabled: true, headers });
    await expect(methods.delete.call(rollback.hook)).resolves.toBe(true);
    expect(rollback.http.calls).toHaveLength(1);
  });

  it('orphan test cleanup never disables a production registration', async () => {
    const rollback = createTriggerContext({
      params: { instanceName: rl('main') },
      staticData: {},
      webhookUrl: TEST_WEBHOOK_URL,
      executionMode: 'internal',
    });
    rollback.http.reply('GET', '/webhook/find/main', {
      url: WEBHOOK_URL,
      enabled: true,
      headers: { jwt_key: JWT_SECRET },
    });
    await expect(methods.delete.call(rollback.hook)).resolves.toBe(true);
    expect(rollback.http.calls).toHaveLength(1);
  });

  it('restores the saved configuration and forgets the registration', async () => {
    const staticData = registeredStaticData({ previous });
    const { hook, http } = createTriggerContext({ staticData });
    http.reply('GET', '/webhook/find/main', { url: WEBHOOK_URL, enabled: true });
    http.reply('POST', '/webhook/set/main', {}, 201);

    await expect(methods.delete.call(hook)).resolves.toBe(true);

    expect(http.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /webhook/find/main',
      'POST /webhook/set/main',
    ]);
    expect(http.calls[1].body).toEqual({
      webhook: {
        url: PREVIOUS_ROW.url,
        enabled: true,
        events: PREVIOUS_ROW.events,
        headers: PREVIOUS_ROW.headers,
        byEvents: true,
        base64: true,
      },
    });
    expect(staticData.registrations).toEqual({});
  });

  it('disables the webhook and removes the secrets when the instance had none', async () => {
    const staticData = registeredStaticData({ previous: null });
    const { hook, http } = createTriggerContext({ staticData });
    http.reply('GET', '/webhook/find/main', { url: WEBHOOK_URL, enabled: true });
    http.reply('POST', '/webhook/set/main', {}, 201);

    await methods.delete.call(hook);

    expect(http.calls[1].body).toEqual({
      webhook: {
        url: WEBHOOK_URL,
        enabled: false,
        events: [],
        headers: {},
        byEvents: false,
        base64: false,
      },
    });
    expect(staticData.registrations).toEqual({});
  });

  it('leaves a webhook that someone else configured meanwhile untouched', async () => {
    const staticData = registeredStaticData({ previous });
    const { hook, http, logger } = createTriggerContext({ staticData });
    http.reply('GET', '/webhook/find/main', {
      url: 'https://other.example.com/new',
      enabled: true,
    });

    await expect(methods.delete.call(hook)).resolves.toBe(true);

    expect(http.calls).toHaveLength(1);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('left untouched'));
    expect(staticData.registrations).toEqual({});
  });

  it('uses the instance it registered on, not the current parameter', async () => {
    const staticData = registeredStaticData({ instanceName: 'Old Name', previous: null });
    const { hook, http } = createTriggerContext({
      params: { instanceName: rl('new') },
      staticData,
    });
    http.reply('GET', '/webhook/find/Old%20Name', { url: WEBHOOK_URL });
    http.reply('POST', '/webhook/set/Old%20Name', {}, 201);

    await methods.delete.call(hook);

    expect(http.calls.map((call) => call.path)).toEqual([
      '/webhook/find/Old%20Name',
      '/webhook/set/Old%20Name',
    ]);
  });

  it('logs a failed restore, disables the webhook and keeps the registration', async () => {
    const staticData = registeredStaticData({ previous });
    const { hook, http, logger } = createTriggerContext({ staticData });
    http.reply('GET', '/webhook/find/main', { url: WEBHOOK_URL, enabled: true });
    http.reply(
      'POST',
      '/webhook/set/main',
      { status: 400, error: 'Bad Request', response: { message: ['bad events'] } },
      400,
    );
    http.reply('POST', '/webhook/set/main', {}, 201);

    await expect(methods.delete.call(hook)).resolves.toBe(false);

    expect(logger.error).toHaveBeenCalledWith(
      'Evolution API Trigger: could not restore the webhook of instance "main"',
      { error: 'Bad request: bad events' },
    );
    expect((http.calls[2].body as IDataObject).webhook).toMatchObject({
      enabled: false,
      headers: {},
    });
    const saved = (staticData.registrations as IDataObject)[WEBHOOK_URL] as IDataObject;
    expect(saved.previous).toEqual(previous);
    expect(http.pending).toEqual([]);
  });

  it('never throws when Evolution is unreachable', async () => {
    const staticData = registeredStaticData({ previous: null });
    const { hook, http, logger } = createTriggerContext({ staticData });
    http.queueError(
      'GET',
      '/webhook/find/main',
      Object.assign(new Error('connect ECONNREFUSED'), {
        code: 'ECONNREFUSED',
      }),
    );

    await expect(methods.delete.call(hook)).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(staticData.registrations).toEqual(
      registeredStaticData({ previous: null }).registrations,
    );
  });

  it('does nothing without a registration (Manual mode or never activated)', async () => {
    const { hook, http } = createTriggerContext({ params: { mode: 'manual' } });
    await expect(methods.delete.call(hook)).resolves.toBe(true);
    expect(http.calls).toEqual([]);
  });

  it('round trip: activation then deactivation puts the original webhook back', async () => {
    const staticData: IDataObject = {};
    const activation = createTriggerContext({
      params: { instanceName: rl('main', 'list') },
      staticData,
    });
    activation.http.reply('GET', '/webhook/find/main', PREVIOUS_ROW);
    activation.http.reply('POST', '/webhook/set/main', {}, 201);
    await methods.create.call(activation.hook);
    const registered = (activation.http.calls[1].body as IDataObject).webhook as IDataObject;

    const running = createTriggerContext({ params: { instanceName: rl('main') }, staticData });
    running.http.reply('GET', '/webhook/find/main', registered);
    await expect(methods.checkExists.call(running.hook)).resolves.toBe(true);

    const deactivation = createTriggerContext({ staticData });
    deactivation.http.reply('GET', '/webhook/find/main', registered);
    deactivation.http.reply('POST', '/webhook/set/main', {}, 201);
    await methods.delete.call(deactivation.hook);

    expect(deactivation.http.calls[1].body).toEqual({
      webhook: {
        url: PREVIOUS_ROW.url,
        enabled: PREVIOUS_ROW.enabled,
        events: PREVIOUS_ROW.events,
        headers: PREVIOUS_ROW.headers,
        byEvents: PREVIOUS_ROW.webhookByEvents,
        base64: PREVIOUS_ROW.webhookBase64,
      },
    });
    expect(staticData.registrations).toEqual({});
  });

  it('"Listen for test event" on an active workflow saves and restores the production webhook', async () => {
    // Production registration is active; n8n builds test workflows with their own static data.
    const productionWebhook = {
      url: WEBHOOK_URL,
      enabled: true,
      events: ['MESSAGES_UPSERT'],
      headers: { jwt_key: JWT_SECRET, [SECRET_HEADER_NAME]: HEADER_SECRET },
      webhookByEvents: false,
      webhookBase64: false,
    };
    const testStaticData: IDataObject = {};
    const listen = createTriggerContext({
      params: { instanceName: rl('main') },
      staticData: testStaticData,
      webhookUrl: TEST_WEBHOOK_URL,
      executionMode: 'manual',
    });
    listen.http.reply('GET', '/webhook/find/main', productionWebhook);
    listen.http.reply('POST', '/webhook/set/main', {}, 201);
    await methods.create.call(listen.hook);
    const testWebhook = (listen.http.calls[1].body as IDataObject).webhook as IDataObject;
    expect(testWebhook.url).toBe(TEST_WEBHOOK_URL);
    const saved = (testStaticData.registrations as IDataObject)[TEST_WEBHOOK_URL] as IDataObject;
    expect(saved.test).toBe(true);

    // n8n deletes test webhooks in mode 'internal'.
    const stop = createTriggerContext({
      staticData: testStaticData,
      webhookUrl: TEST_WEBHOOK_URL,
      executionMode: 'internal',
    });
    stop.http.reply('GET', '/webhook/find/main', testWebhook);
    stop.http.reply('POST', '/webhook/set/main', {}, 201);
    await methods.delete.call(stop.hook);

    expect(stop.http.calls[1].body).toEqual({
      webhook: {
        url: WEBHOOK_URL,
        enabled: true,
        events: ['MESSAGES_UPSERT'],
        headers: productionWebhook.headers,
        byEvents: false,
        base64: false,
      },
    });
  });
});

describe('lifecycle with the production and test URLs of the same node', () => {
  const crm = snapshotWebhook(PREVIOUS_ROW) as IDataObject;
  const crmRestoreBody = {
    webhook: {
      url: PREVIOUS_ROW.url,
      enabled: true,
      events: PREVIOUS_ROW.events,
      headers: PREVIOUS_ROW.headers,
      byEvents: true,
      base64: true,
    },
  };
  /** A test listener's webhook as /webhook/find returns it. */
  const testListenerRow = {
    url: TEST_WEBHOOK_URL,
    enabled: true,
    events: ['MESSAGES_UPSERT'],
    headers: { jwt_key: 'e'.repeat(64), [SECRET_HEADER_NAME]: 'f'.repeat(64) },
    webhookByEvents: false,
    webhookBase64: false,
  };

  it('activation after an interrupted test listener keeps the saved original webhook', async () => {
    // Regression: n8n restarted while "Listen for test event" held the instance webhook, so it
    // never ran the test delete. The production activation saved the dead test URL as the
    // "previous" webhook and lost the original one.
    const staticData = registeredStaticData({ previous: crm });
    const { hook, http } = createTriggerContext({
      params: { instanceName: rl('main') },
      staticData,
    });
    http.reply('GET', '/webhook/find/main', testListenerRow);
    http.reply('POST', '/webhook/set/main', {}, 201);

    await methods.create.call(hook);

    expect(((http.calls[1].body as IDataObject).webhook as IDataObject).url).toBe(WEBHOOK_URL);
    const saved = (staticData.registrations as IDataObject)[WEBHOOK_URL] as IDataObject;
    expect(saved.previous).toEqual(crm);
    expect(saved).not.toHaveProperty('test');
  });

  it('a test listener still saves the live production webhook as the one to restore', async () => {
    const staticData: IDataObject = {};
    const { hook, http } = createTriggerContext({
      params: { instanceName: rl('main') },
      staticData,
      webhookUrl: TEST_WEBHOOK_URL,
      executionMode: 'manual',
    });
    http.reply('GET', '/webhook/find/main', { ...testListenerRow, url: WEBHOOK_URL });
    http.reply('POST', '/webhook/set/main', {}, 201);

    await methods.create.call(hook);

    const saved = (staticData.registrations as IDataObject)[TEST_WEBHOOK_URL] as IDataObject;
    expect((saved.previous as IDataObject).url).toBe(WEBHOOK_URL);
  });

  it('deactivation restores the original webhook while a test listener holds it', async () => {
    // Regression: the webhook pointed to the test URL, so it was "left untouched" and the
    // saved configuration was forgotten; the test listener then put back the production URL
    // of a workflow that was no longer active.
    const staticData = registeredStaticData({ previous: crm });
    const { hook, http } = createTriggerContext({ staticData, executionMode: 'internal' });
    http.reply('GET', '/webhook/find/main', testListenerRow);
    http.reply('POST', '/webhook/set/main', {}, 201);

    await expect(methods.delete.call(hook)).resolves.toBe(true);

    expect(http.calls[1].body).toEqual(crmRestoreBody);
    expect(staticData.registrations).toEqual({});
  });

  it('a test listener never restores over the production URL', async () => {
    const staticData: IDataObject = {
      registrations: {
        [TEST_WEBHOOK_URL]: registration({ previous: snapshotWebhook(PREVIOUS_ROW), test: true }),
      },
    };
    const { hook, http, logger } = createTriggerContext({
      staticData,
      webhookUrl: TEST_WEBHOOK_URL,
      executionMode: 'internal',
    });
    http.reply('GET', '/webhook/find/main', { ...testListenerRow, url: WEBHOOK_URL });

    await expect(methods.delete.call(hook)).resolves.toBe(true);

    expect(http.calls).toHaveLength(1);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('left untouched'));
  });

  it('never treats the URL of another trigger node as its own', async () => {
    const staticData = registeredStaticData({ previous: crm });
    const { hook, http } = createTriggerContext({ staticData });
    http.reply('GET', '/webhook/find/main', {
      ...testListenerRow,
      url: 'https://n8n.test/webhook-test/other-node/webhook',
    });

    await methods.delete.call(hook);

    expect(http.calls).toHaveLength(1);
  });

  it('deactivating the workflow while listening for a test event ends with the original webhook', async () => {
    // 1. The active workflow took the webhook over from the CRM.
    const production: IDataObject = {};
    const activate = createTriggerContext({
      params: { instanceName: rl('main') },
      staticData: production,
    });
    activate.http.reply('GET', '/webhook/find/main', PREVIOUS_ROW);
    activate.http.reply('POST', '/webhook/set/main', {}, 201);
    await methods.create.call(activate.hook);
    const productionRow = (activate.http.calls[1].body as IDataObject).webhook as IDataObject;

    // 2. "Listen for test event" takes it over from the production URL.
    const test: IDataObject = {};
    const listen = createTriggerContext({
      params: { instanceName: rl('main') },
      staticData: test,
      webhookUrl: TEST_WEBHOOK_URL,
      executionMode: 'manual',
    });
    listen.http.reply('GET', '/webhook/find/main', productionRow);
    listen.http.reply('POST', '/webhook/set/main', {}, 201);
    await methods.create.call(listen.hook);
    const testRow = (listen.http.calls[1].body as IDataObject).webhook as IDataObject;

    // 3. The workflow is deactivated while the test listener is running: the CRM comes back.
    const deactivate = createTriggerContext({ staticData: production, executionMode: 'internal' });
    deactivate.http.reply('GET', '/webhook/find/main', testRow);
    deactivate.http.reply('POST', '/webhook/set/main', {}, 201);
    await methods.delete.call(deactivate.hook);
    expect(deactivate.http.calls[1].body).toEqual(crmRestoreBody);

    // 4. The test listener stops and leaves the CRM webhook alone.
    const stop = createTriggerContext({
      staticData: test,
      webhookUrl: TEST_WEBHOOK_URL,
      executionMode: 'internal',
    });
    stop.http.reply('GET', '/webhook/find/main', PREVIOUS_ROW);
    await methods.delete.call(stop.hook);
    expect(stop.http.calls.map((call) => call.method)).toEqual(['GET']);
  });

  it('recognizes the other endpoint of the node by its webhookId', () => {
    expect(isOtherEndpointOfNode(TEST_WEBHOOK_URL, WEBHOOK_URL, '2f9c')).toBe(true);
    expect(isOtherEndpointOfNode(WEBHOOK_URL, TEST_WEBHOOK_URL, '2f9c')).toBe(true);
    expect(isOtherEndpointOfNode(WEBHOOK_URL, WEBHOOK_URL, '2f9c')).toBe(false);
    expect(
      isOtherEndpointOfNode('https://n8n.test/webhook-test/9999/webhook', WEBHOOK_URL, '2f9c'),
    ).toBe(false);
    expect(isOtherEndpointOfNode(TEST_WEBHOOK_URL, WEBHOOK_URL, undefined)).toBe(false);
    expect(isOtherEndpointOfNode(undefined, WEBHOOK_URL, '2f9c')).toBe(false);
  });

  it('rejects first activation during a test takeover, then restores the original through the full lifecycle', async () => {
    const testData: IDataObject = {};
    const listening = createTriggerContext({
      params: { instanceName: rl('main') },
      staticData: testData,
      webhookUrl: TEST_WEBHOOK_URL,
      executionMode: 'manual',
    });
    listening.http.reply('GET', '/webhook/find/main', PREVIOUS_ROW);
    listening.http.reply('POST', '/webhook/set/main', {}, 201);
    await methods.create.call(listening.hook);
    const testRow = (listening.http.calls[1].body as IDataObject).webhook as IDataObject;

    const failed = createTriggerContext({ params: { instanceName: rl('main') } });
    failed.http.reply('GET', '/webhook/find/main', testRow);
    await expect(methods.create.call(failed.hook)).rejects.toThrow('stop it and activate again');
    expect(failed.http.calls).toHaveLength(1);
    expect(failed.staticData.registrations).toBeUndefined();

    const stop = createTriggerContext({
      staticData: testData,
      webhookUrl: TEST_WEBHOOK_URL,
      executionMode: 'internal',
    });
    stop.http.reply('GET', '/webhook/find/main', testRow);
    stop.http.reply('POST', '/webhook/set/main', {}, 201);
    await methods.delete.call(stop.hook);
    expect(stop.http.calls[1].body).toEqual(crmRestoreBody);

    const active = createTriggerContext({ params: { instanceName: rl('main') } });
    active.http.reply('GET', '/webhook/find/main', PREVIOUS_ROW);
    active.http.reply('POST', '/webhook/set/main', {}, 201);
    await methods.create.call(active.hook);
    const productionRow = (active.http.calls[1].body as IDataObject).webhook as IDataObject;
    const deactivate = createTriggerContext({ staticData: active.staticData });
    deactivate.http.reply('GET', '/webhook/find/main', productionRow);
    deactivate.http.reply('POST', '/webhook/set/main', {}, 201);
    await methods.delete.call(deactivate.hook);
    expect(deactivate.http.calls[1].body).toEqual(crmRestoreBody);
  });
});

describe('registration helpers', () => {
  it('drops event names that /webhook/set would reject when restoring', () => {
    expect(
      buildRestoreBody({
        url: 'https://x.test',
        enabled: true,
        events: ['MESSAGES_UPSERT', 'FOO'],
      }),
    ).toEqual({
      webhook: {
        url: 'https://x.test',
        enabled: true,
        events: ['MESSAGES_UPSERT'],
        headers: {},
        byEvents: false,
        base64: false,
      },
    });
    // Never turn a list of unknown names into [] (= every event).
    const onlyUnknown = buildRestoreBody({ url: 'https://x.test', enabled: true, events: ['FOO'] });
    expect((onlyUnknown.webhook as IDataObject).events).toEqual(['FOO']);
  });

  it('snapshots only the fields needed to restore, or null without a webhook', () => {
    expect(snapshotWebhook({})).toBeNull();
    expect(snapshotWebhook(PREVIOUS_ROW)).toEqual({
      url: PREVIOUS_ROW.url,
      enabled: true,
      events: PREVIOUS_ROW.events,
      headers: PREVIOUS_ROW.headers,
      webhookByEvents: true,
      webhookBase64: true,
    });
  });

  it('treats a stored webhook without URL as "none" (its restore would always answer 400)', async () => {
    expect(snapshotWebhook({ url: '', enabled: false, events: [] })).toBeNull();

    const { hook, http, staticData } = createTriggerContext({
      params: { instanceName: rl('main') },
    });
    http.reply('GET', '/webhook/find/main', { id: 'wh-0', url: '', enabled: false, events: [] });
    http.reply('POST', '/webhook/set/main', {}, 201);
    await methods.create.call(hook);
    const saved = (staticData.registrations as IDataObject)[WEBHOOK_URL] as IDataObject;
    expect(saved.previous).toBeNull();
  });

  it('compares server versions', () => {
    expect(isVersionBelow('2.3.7', 2, 4)).toBe(true);
    expect(isVersionBelow('2.4.0', 2, 4)).toBe(false);
    expect(isVersionBelow('2.10.1', 2, 4)).toBe(false);
    expect(isVersionBelow('3.0.0', 2, 4)).toBe(false);
    expect(isVersionBelow('unknown', 2, 4)).toBe(false);
  });
});

// ============================================================================
// Verification
// ============================================================================

describe('JWT and secret verification (real crypto)', () => {
  const now = 1_800_000_000;
  const options = { nowSeconds: now, leewaySeconds: 1200 };

  it('accepts a token signed like Evolution signs it', () => {
    expect(verifyEvolutionJwt(evolutionJwt(JWT_SECRET, now), JWT_SECRET, options)).toEqual({
      valid: true,
    });
  });

  it('computes standard HS256 signatures (jwt.io test vector)', () => {
    const token =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    // Signature is valid; only the Evolution claims are missing.
    expect(verifyEvolutionJwt(token, 'your-256-bit-secret', options)).toEqual({
      valid: false,
      reason: 'unexpected JWT claims',
    });
    expect(verifyEvolutionJwt(token, 'another-secret', options)).toEqual({
      valid: false,
      reason: 'invalid JWT signature',
    });
  });

  it.each([
    ['a wrong secret', () => evolutionJwt('c'.repeat(64), now), 'invalid JWT signature'],
    [
      'alg none',
      () => {
        const [header, payload] = evolutionJwt(JWT_SECRET, now).split('.');
        return `${base64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${payload}.${header}`;
      },
      'unsupported JWT algorithm "none"',
    ],
    [
      'HS512',
      () =>
        signJwt({ iat: now, exp: now + 600, app: 'evolution', action: 'webhook' }, JWT_SECRET, {
          alg: 'HS512',
        }),
      'unsupported JWT algorithm "HS512"',
    ],
    [
      'a tampered payload',
      () => {
        const [header, , signature] = evolutionJwt(JWT_SECRET, now).split('.');
        const payload = base64url(
          JSON.stringify({ iat: now, exp: now + 99999, app: 'evolution', action: 'webhook' }),
        );
        return `${header}.${payload}.${signature}`;
      },
      'invalid JWT signature',
    ],
    [
      'other claims',
      () => signJwt({ iat: now, exp: now + 600, app: 'other', action: 'webhook' }, JWT_SECRET),
      'unexpected JWT claims',
    ],
    [
      'no expiry',
      () => signJwt({ iat: now, app: 'evolution', action: 'webhook' }, JWT_SECRET),
      'JWT without expiry',
    ],
    ['garbage', () => 'not-a-jwt', 'malformed JWT'],
    ['bad base64', () => 'a.b!.c', 'malformed JWT'],
  ])('rejects %s', (_label, makeToken, reason) => {
    expect(verifyEvolutionJwt(makeToken(), JWT_SECRET, options)).toEqual({ valid: false, reason });
  });

  it('accepts late retries within the leeway and rejects them after it', () => {
    const issuedAt = now - 600 - 1200; // exp passed exactly `leeway` seconds ago
    expect(verifyEvolutionJwt(evolutionJwt(JWT_SECRET, issuedAt), JWT_SECRET, options).valid).toBe(
      true,
    );
    expect(verifyEvolutionJwt(evolutionJwt(JWT_SECRET, issuedAt - 1), JWT_SECRET, options)).toEqual(
      { valid: false, reason: 'JWT expired' },
    );
    expect(
      verifyEvolutionJwt(evolutionJwt(JWT_SECRET, now - 601), JWT_SECRET, {
        nowSeconds: now,
        leewaySeconds: 0,
      }),
    ).toEqual({ valid: false, reason: 'JWT expired' });
  });

  it('compares secrets in constant time', () => {
    expect(safeEqual('secret', 'secret')).toBe(true);
    expect(safeEqual('secret', 'secreT')).toBe(false);
    expect(safeEqual('short', 'a much longer value')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });

  it('reads the bearer token and headers case-insensitively', () => {
    expect(getBearerToken({ authorization: 'Bearer abc.def.ghi' })).toBe('abc.def.ghi');
    expect(getBearerToken({ Authorization: 'bearer abc' })).toBe('abc');
    expect(getBearerToken({ authorization: 'Basic abc' })).toBeUndefined();
    expect(
      verifyWebhookRequest(
        { 'X-Evolution-Secret': ['s3cret', 'other'] },
        {
          secretHeader: { name: 'x-evolution-secret', value: 's3cret' },
          ...options,
          jwtLeewaySeconds: 0,
        },
      ),
    ).toEqual({ valid: true });
  });
});

// ============================================================================
// webhook(): authentication
// ============================================================================

describe('webhook() authentication', () => {
  it('accepts a delivery with a valid JWT and secret header', async () => {
    const { result, res } = await runWebhook({ body: upsertBody() });
    expect(result.workflowData).toHaveLength(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it.each([
    ['no credentials at all', { 'content-type': 'application/json' }, 'missing header'],
    ['no JWT', { [SECRET_HEADER_NAME]: HEADER_SECRET }, 'missing "Authorization: Bearer" JWT'],
    ['no secret header', { authorization: `Bearer ${evolutionJwt()}` }, 'missing header'],
    [
      'a wrong secret header',
      { authorization: `Bearer ${evolutionJwt()}`, [SECRET_HEADER_NAME]: 'x'.repeat(64) },
      'wrong value in header',
    ],
    [
      'a JWT signed with another secret',
      {
        authorization: `Bearer ${evolutionJwt('d'.repeat(64))}`,
        [SECRET_HEADER_NAME]: HEADER_SECRET,
      },
      'invalid JWT signature',
    ],
    [
      'an expired JWT beyond the leeway',
      {
        authorization: `Bearer ${evolutionJwt(JWT_SECRET, Math.floor(Date.now() / 1000) - 3600)}`,
        [SECRET_HEADER_NAME]: HEADER_SECRET,
      },
      'JWT expired',
    ],
  ])('rejects %s with 401 and does not start the workflow', async (_label, headers, reason) => {
    const { result, res, logger } = await runWebhook({ body: upsertBody(), headers });
    expect(result).toEqual({ noWebhookResponse: true });
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.body).toEqual({ message: 'Unauthorized' });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(reason));
  });

  it('accepts a JWT whose expiry passed within the configured leeway', async () => {
    const issuedAt = Math.floor(Date.now() / 1000) - 1500; // expired 900 s ago
    const headers = validHeaders({ authorization: `Bearer ${evolutionJwt(JWT_SECRET, issuedAt)}` });

    const accepted = await runWebhook({ body: upsertBody(), headers });
    expect(accepted.result.workflowData).toHaveLength(1);

    const strict = await runWebhook({
      body: upsertBody(
        { date_time: 'other' },
        { key: { id: 'OTHER', remoteJid: 'x@s.whatsapp.net' } },
      ),
      headers,
      params: { options: { jwtLeeway: 0 } },
    });
    expect(strict.res.status).toHaveBeenCalledWith(401);
  });

  it('verifies only the method chosen at activation', async () => {
    const jwtOnly = await runWebhook({
      body: upsertBody(),
      staticData: registeredStaticData({ auth: 'jwt', headerSecret: undefined }),
      headers: { authorization: `Bearer ${evolutionJwt()}` },
    });
    expect(jwtOnly.result.workflowData).toHaveLength(1);

    const headerOnly = await runWebhook({
      body: upsertBody({}, { key: { id: 'B', remoteJid: 'x@s.whatsapp.net' } }),
      staticData: registeredStaticData({ auth: 'header', jwtSecret: undefined }),
      headers: { [SECRET_HEADER_NAME]: HEADER_SECRET },
    });
    expect(headerOnly.result.workflowData).toHaveLength(1);
  });

  it('rejects deliveries to a URL this node never registered (e.g. static data lost)', async () => {
    const { result, res, logger } = await runWebhook({ body: upsertBody(), staticData: {} });
    expect(result).toEqual({ noWebhookResponse: true });
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '5');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('not registered'));
  });

  it('Manual mode, Authentication None: accepts unauthenticated deliveries (global webhook)', async () => {
    const { result } = await runWebhook({
      body: upsertBody(),
      params: { mode: 'manual', manualAuth: 'none' },
      staticData: {},
      headers: {},
    });
    expect(result.workflowData).toHaveLength(1);
  });

  it('Manual mode: verifies a custom secret header (name is case-insensitive)', async () => {
    const params = {
      mode: 'manual',
      manualAuth: 'header',
      headerName: 'X-My-Token',
      headerValue: 'manual-secret',
    };
    const ok = await runWebhook({
      body: upsertBody(),
      params,
      staticData: {},
      headers: { 'x-my-token': 'manual-secret' },
    });
    expect(ok.result.workflowData).toHaveLength(1);

    const wrong = await runWebhook({
      body: upsertBody(),
      params,
      staticData: {},
      headers: { 'x-my-token': 'nope' },
    });
    expect(wrong.res.status).toHaveBeenCalledWith(401);
  });

  it('Manual mode: verifies the JWT of a manually configured jwt_key', async () => {
    const params = { mode: 'manual', manualAuth: 'jwt', jwtSecret: 'manual-jwt-key' };
    const ok = await runWebhook({
      body: upsertBody(),
      params,
      staticData: {},
      headers: { authorization: `Bearer ${evolutionJwt('manual-jwt-key')}` },
    });
    expect(ok.result.workflowData).toHaveLength(1);

    const wrong = await runWebhook({
      body: upsertBody(),
      params,
      staticData: {},
      headers: { authorization: `Bearer ${evolutionJwt()}` },
    });
    expect(wrong.res.status).toHaveBeenCalledWith(401);
  });

  it('Manual mode: a missing secret rejects every delivery and logs why', async () => {
    const { res, logger } = await runWebhook({
      body: upsertBody(),
      params: { mode: 'manual', manualAuth: 'jwt', jwtSecret: '' },
      staticData: {},
      headers: {},
    });
    expect(res.status).toHaveBeenCalledWith(401);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('JWT Secret'));
  });

  it('answers 400 to authenticated requests that are not Evolution events', async () => {
    const { result, res } = await runWebhook({ body: { hello: 'world' } });
    expect(result).toEqual({ noWebhookResponse: true });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body).toEqual({ message: 'Not an Evolution API webhook event' });
  });
});

// ============================================================================
// webhook(): output
// ============================================================================

describe('webhook() output', () => {
  it('emits the envelope without the instance token, plus normalized fields', async () => {
    const body = upsertBody();
    const { result } = await runWebhook({
      body,
      headers: validHeaders({ 'x-timestamp': '1758795300123', 'x-event-type': 'messages.upsert' }),
    });

    expect(result.workflowData).toEqual([
      [
        {
          json: {
            event: 'messages.upsert',
            instance: 'main',
            data: body.data,
            destination: WEBHOOK_URL,
            date_time: '2026-09-25T10:15:00.000Z',
            sender: '5215500000000@s.whatsapp.net',
            server_url: 'https://evo.test',
            eventType: 'MESSAGES_UPSERT',
            timestamp: '2025-09-25T10:15:00.123Z',
            messageId: '3EB0C767D26A1D8E',
            remoteJid: '5215512345678@s.whatsapp.net',
            remoteJidAlt: '123456789012345@lid',
            phoneJid: '5215512345678@s.whatsapp.net',
            phoneNumber: '5215512345678',
            lid: '123456789012345@lid',
            isGroup: false,
            participant: null,
            participantPhoneJid: null,
            participantLid: null,
            fromMe: false,
            pushName: 'Ana',
            messageType: 'conversation',
            text: 'Hola',
            quotedMessageId: null,
          },
        },
      ],
    ]);
    expect(JSON.stringify(result.workflowData)).not.toContain('INSTANCE-TOKEN');
  });

  it('keeps the apikey field when asked to', async () => {
    const { result } = await runWebhook({
      body: upsertBody(),
      params: { options: { keepApiKey: true } },
    });
    expect(result.workflowData?.[0][0].json.apikey).toBe('INSTANCE-TOKEN');
  });

  it('falls back to the WhatsApp message timestamp without X-Timestamp (2.3.7)', async () => {
    const { result } = await runWebhook({ body: upsertBody() });
    expect(result.workflowData?.[0][0].json.timestamp).toBe(
      new Date(1758793500 * 1000).toISOString(),
    );
  });

  it('adds only eventType/timestamp to events without a chat, and keeps extra envelope fields', async () => {
    const body = {
      event: 'messages.set',
      instance: 'main',
      data: [{ key: { id: 'A' } }, { key: { id: 'B' } }],
      isLatest: true,
      progress: 100,
      date_time: '2026-09-25T10:15:00.000Z',
      apikey: null,
    };
    const { result } = await runWebhook({ body, params: { events: [] } });
    expect(result.workflowData).toEqual([
      [
        {
          json: {
            event: 'messages.set',
            instance: 'main',
            data: body.data,
            isLatest: true,
            progress: 100,
            date_time: '2026-09-25T10:15:00.000Z',
            eventType: 'MESSAGES_SET',
            timestamp: null,
          },
        },
      ],
    ]);
  });

  it('normalizes connection.update without message fields', async () => {
    const { result } = await runWebhook({
      body: {
        event: 'connection.update',
        instance: 'main',
        data: { instance: 'main', state: 'open', statusReason: 200 },
      },
      params: { events: ['CONNECTION_UPDATE'] },
    });
    const json = result.workflowData?.[0][0].json as IDataObject;
    expect(json.eventType).toBe('CONNECTION_UPDATE');
    expect(json).not.toHaveProperty('remoteJid');
    expect(json).not.toHaveProperty('text');
  });

  it('emits events whose data is null (logout.instance)', async () => {
    const { result } = await runWebhook({
      body: { event: 'logout.instance', instance: 'main', data: null, apikey: 'TOKEN' },
      params: { events: ['LOGOUT_INSTANCE'] },
    });
    expect(result.workflowData).toEqual([
      [
        {
          json: {
            event: 'logout.instance',
            instance: 'main',
            data: null,
            eventType: 'LOGOUT_INSTANCE',
            timestamp: null,
          },
        },
      ],
    ]);
  });
});

describe('webhook() on the test URL ("Listen for test event")', () => {
  const TEST_JWT_SECRET = 'c'.repeat(64);
  const TEST_HEADER_SECRET = 'd'.repeat(64);
  const testHeaders = () => ({
    authorization: `Bearer ${evolutionJwt(TEST_JWT_SECRET)}`,
    [SECRET_HEADER_NAME]: TEST_HEADER_SECRET,
  });
  /** Test static data as n8n hands it to the test delivery (setTestStaticData). */
  const testStaticData = (): IDataObject => ({
    registrations: {
      [TEST_WEBHOOK_URL]: registration({
        jwtSecret: TEST_JWT_SECRET,
        headerSecret: TEST_HEADER_SECRET,
        test: true,
      }),
    },
  });

  it('accepts a test delivery although n8n reports the production URL to webhook()', async () => {
    // Regression: the registration was looked up by getNodeWebhookUrl(), which is always the
    // production URL in webhook(), so every test delivery was rejected with 401.
    const { result, res } = await runWebhook({
      body: upsertBody(),
      staticData: testStaticData(),
      headers: testHeaders(),
      executionMode: 'manual',
    });
    expect(res.status).not.toHaveBeenCalled();
    expect(result.workflowData?.[0][0].json).toMatchObject({ messageId: '3EB0C767D26A1D8E' });
  });

  it('never accepts the test secrets on a production delivery', async () => {
    const { res } = await runWebhook({
      body: upsertBody(),
      staticData: testStaticData(),
      headers: testHeaders(),
      executionMode: 'webhook',
    });
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('never accepts the production secrets on a test delivery', async () => {
    const { res, logger } = await runWebhook({
      body: upsertBody(),
      staticData: registeredStaticData(),
      executionMode: 'manual',
    });
    expect(res.status).toHaveBeenCalledWith(503);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('not registered'));
  });

  it('uses getWebhookResourceUrl (the served endpoint) when n8n provides it', async () => {
    const staticData: IDataObject = {
      registrations: {
        ...(registeredStaticData().registrations as IDataObject),
        ...(testStaticData().registrations as IDataObject),
      },
    };
    const onTest = await runWebhook({
      body: upsertBody(),
      staticData,
      headers: testHeaders(),
      servedUrl: TEST_WEBHOOK_URL,
      executionMode: 'webhook',
    });
    expect(onTest.result.workflowData).toHaveLength(1);

    const productionSecretsOnTest = await runWebhook({
      body: upsertBody({}, { key: { remoteJid: '1@s.whatsapp.net', fromMe: false, id: 'P' } }),
      staticData,
      servedUrl: TEST_WEBHOOK_URL,
      executionMode: 'manual',
    });
    expect(productionSecretsOnTest.res.status).toHaveBeenCalledWith(401);

    const onProduction = await runWebhook({
      body: upsertBody({}, { key: { remoteJid: '1@s.whatsapp.net', fromMe: false, id: 'Q' } }),
      staticData,
      servedUrl: WEBHOOK_URL,
    });
    expect(onProduction.result.workflowData).toHaveLength(1);
  });
});

describe('LID normalization (EVOAPI-5)', () => {
  it.each([
    [
      '2.4 (phone JID + @lid in remoteJidAlt)',
      { remoteJid: '5215512345678@s.whatsapp.net', remoteJidAlt: '99887766@lid' },
      {
        phoneJid: '5215512345678@s.whatsapp.net',
        phoneNumber: '5215512345678',
        lid: '99887766@lid',
      },
    ],
    [
      '2.3.7 (remoteJid rewritten, remoteJidAlt = phone JID)',
      { remoteJid: '5215512345678@s.whatsapp.net', remoteJidAlt: '5215512345678@s.whatsapp.net' },
      { phoneJid: '5215512345678@s.whatsapp.net', phoneNumber: '5215512345678', lid: null },
    ],
    [
      'only a LID known',
      { remoteJid: '99887766@lid' },
      { phoneJid: null, phoneNumber: null, lid: '99887766@lid', remoteJidAlt: null },
    ],
    [
      'unswapped (LID first, phone JID in Alt)',
      { remoteJid: '99887766@lid', remoteJidAlt: '5215512345678@s.whatsapp.net' },
      { phoneJid: '5215512345678@s.whatsapp.net', lid: '99887766@lid' },
    ],
  ])('%s', (_label, key, expected) => {
    const fields = getMessageFields({ key: { ...key, fromMe: false, id: 'X' } });
    expect(fields).toMatchObject({ remoteJid: key.remoteJid, ...expected });
  });

  it('resolves group senders from participant / participantAlt', () => {
    const fields = getMessageFields({
      key: {
        remoteJid: '120363000000000000@g.us',
        fromMe: false,
        id: 'G1',
        participant: '4455@lid',
        participantAlt: '5215512345678:12@s.whatsapp.net',
      },
      message: { conversation: 'hi all' },
      messageType: 'conversation',
    });
    expect(fields).toMatchObject({
      isGroup: true,
      participant: '4455@lid',
      // Normalized without the device suffix (the raw participant fields keep it).
      participantPhoneJid: '5215512345678@s.whatsapp.net',
      participantLid: '4455@lid',
      phoneJid: null,
      text: 'hi all',
    });
  });

  it('strips device suffixes from the normalized JIDs only (2.3.7 keeps them in the key)', () => {
    const fields = getMessageFields({
      key: {
        remoteJid: '5215512345678:3@s.whatsapp.net',
        remoteJidAlt: '99887766:3@lid',
        fromMe: false,
        id: 'D',
      },
    });
    expect(fields).toMatchObject({
      remoteJid: '5215512345678:3@s.whatsapp.net',
      remoteJidAlt: '99887766:3@lid',
      phoneJid: '5215512345678@s.whatsapp.net',
      phoneNumber: '5215512345678',
      lid: '99887766@lid',
    });
  });

  it('reads messages.update and messages.delete payloads', () => {
    expect(
      getMessageFields({
        keyId: 'K1',
        remoteJid: '5215512345678@s.whatsapp.net',
        fromMe: true,
        participant: null,
        status: 'READ',
      }),
    ).toMatchObject({ messageId: 'K1', fromMe: true, remoteJid: '5215512345678@s.whatsapp.net' });
    expect(
      getMessageFields({
        id: 'D1',
        remoteJid: '1@s.whatsapp.net',
        fromMe: false,
        status: 'DELETED',
      }),
    ).toMatchObject({ messageId: 'D1', fromMe: false });
    expect(getMessageFields([{ remoteJid: 'x' }])).toBeUndefined();
    expect(getMessageFields({ state: 'open' })).toBeUndefined();
  });
});

describe('text extraction', () => {
  it.each([
    ['text', { conversation: 'hello' }, 'hello'],
    ['extended text', { extendedTextMessage: { text: 'link https://x' } }, 'link https://x'],
    ['image caption', { imageMessage: { caption: 'photo', mimetype: 'image/jpeg' } }, 'photo'],
    ['document caption', { documentMessage: { caption: 'invoice' } }, 'invoice'],
    [
      'button',
      { buttonsResponseMessage: { selectedButtonId: 'b1', selectedDisplayText: 'Yes' } },
      'Yes',
    ],
    ['button id only', { buttonsResponseMessage: { selectedButtonId: 'b1' } }, 'b1'],
    [
      'list row',
      { listResponseMessage: { title: 'Option A', singleSelectReply: { selectedRowId: 'a' } } },
      'Option A',
    ],
    ['reaction', { reactionMessage: { text: '👍', key: { id: 'X' } } }, '👍'],
    ['poll', { pollCreationMessageV3: { name: 'Lunch?' } }, 'Lunch?'],
    [
      'transcription',
      { audioMessage: { seconds: 3 }, speechToText: '[audio] hola' },
      '[audio] hola',
    ],
    [
      'ephemeral',
      { ephemeralMessage: { message: { extendedTextMessage: { text: 'wrapped' } } } },
      'wrapped',
    ],
    [
      'view once',
      { viewOnceMessageV2: { message: { imageMessage: { caption: 'once' } } } },
      'once',
    ],
    ['protocol edit', { protocolMessage: { editedMessage: { conversation: 'edited' } } }, 'edited'],
    ['audio without text', { audioMessage: { seconds: 3 } }, null],
  ])('%s', (_label, message, expected) => {
    expect(extractText(message)).toBe(expected);
  });

  it('finds the quoted message in the 2.3.7 and 2.4 contextInfo shapes (EVOAPI-4)', () => {
    const key = { remoteJid: '1@s.whatsapp.net', fromMe: false, id: 'R1' };
    // 2.3.7: data.contextInfo is the content message's contextInfo.
    expect(
      getMessageFields({
        key,
        message: { conversation: 'yes' },
        contextInfo: { stanzaId: 'Q237', participant: '2@s.whatsapp.net', quotedMessage: {} },
      })?.quotedMessageId,
    ).toBe('Q237');
    // 2.4: data.contextInfo is messageContextInfo; media keep the quote in their content.
    expect(
      getMessageFields({
        key,
        message: { imageMessage: { caption: 'this', contextInfo: { stanzaId: 'Q24' } } },
        contextInfo: { deviceListMetadata: {} },
      })?.quotedMessageId,
    ).toBe('Q24');
    expect(getMessageFields({ key, message: { conversation: 'x' } })?.quotedMessageId).toBeNull();
  });

  it('reads the new text of messages.edited (protocolMessage payload)', () => {
    const fields = getMessageFields({
      key: { remoteJid: '1@s.whatsapp.net', fromMe: false, id: 'E1' },
      type: 'MESSAGE_EDIT',
      editedMessage: { conversation: 'fixed typo' },
    });
    expect(fields?.text).toBe('fixed typo');
  });

  it('folds equivalent message types', () => {
    expect(normalizeMessageType('extendedTextMessage')).toBe('conversation');
    expect(normalizeMessageType('documentWithCaptionMessage')).toBe('documentMessage');
    expect(normalizeMessageType('pollCreationMessageV3')).toBe('pollCreationMessage');
    expect(normalizeMessageType('viewOnceMessageV2')).toBe('viewOnceMessage');
    expect(normalizeMessageType('imageMessage')).toBe('imageMessage');
    expect(normalizeEventName('group-participants.update')).toBe('GROUP_PARTICIPANTS_UPDATE');
  });
});

// ============================================================================
// webhook(): filters
// ============================================================================

describe('webhook() filters', () => {
  async function expectIgnored(options: TriggerContextOptions, reason: string) {
    const { result, res } = await runWebhook(options);
    expect(result).toEqual({ webhookResponse: { received: true, ignored: reason } });
    expect(res.status).not.toHaveBeenCalled();
  }

  it('answers 200 without starting the workflow for events that are not selected', async () => {
    await expectIgnored(
      { body: { event: 'presence.update', instance: 'main', data: { id: 'x' } } },
      'event PRESENCE_UPDATE is not selected',
    );
  });

  it('accepts every event when Events is empty', async () => {
    const { result } = await runWebhook({
      body: { event: 'presence.update', instance: 'main', data: { id: 'x' } },
      params: { events: [] },
    });
    expect(result.workflowData).toHaveLength(1);
  });

  it('filters by instance name (global webhook)', async () => {
    const params = {
      mode: 'manual',
      manualAuth: 'none',
      options: { instanceNames: 'sales, support' },
    };
    await expectIgnored(
      { body: upsertBody({ instance: 'main' }), params, staticData: {}, headers: {} },
      'instance "main" is not selected',
    );
    const { result } = await runWebhook({
      body: upsertBody({ instance: 'support' }),
      params,
      staticData: {},
      headers: {},
    });
    expect(result.workflowData).toHaveLength(1);
  });

  it('ignores messages sent by the instance itself', async () => {
    const fromMe = upsertBody(
      {},
      { key: { remoteJid: '1@s.whatsapp.net', fromMe: true, id: 'M' } },
    );
    await expectIgnored(
      { body: fromMe, params: { options: { ignoreFromMe: true } } },
      'message sent by the instance (fromMe)',
    );
    const { result } = await runWebhook({ body: fromMe });
    expect(result.workflowData).toHaveLength(1);
  });

  it.each([
    ['ignoreGroups', '120363000000000000@g.us', 'group chat'],
    ['ignoreNewsletters', '120363111111111111@newsletter', 'newsletter (channel)'],
    ['ignoreBroadcasts', 'status@broadcast', 'status or broadcast list'],
  ])('%s drops %s', async (option, remoteJid, reason) => {
    const body = upsertBody({}, { key: { remoteJid, fromMe: false, id: 'G' } });
    await expectIgnored({ body, params: { options: { [option]: true } } }, reason);
  });

  it('filters by message type, folding extendedTextMessage into Text', async () => {
    const options = { messageTypes: ['conversation', 'imageMessage'] };
    const extended = upsertBody({}, { messageType: 'extendedTextMessage' });
    const accepted = await runWebhook({ body: extended, params: { options } });
    expect(accepted.result.workflowData).toHaveLength(1);

    await expectIgnored(
      {
        body: upsertBody(
          {},
          { messageType: 'audioMessage', key: { remoteJid: 'a@s.whatsapp.net', id: 'Z' } },
        ),
        params: { options },
      },
      'message type audioMessage is not selected',
    );

    // Events without a message type are not affected.
    const receipt = await runWebhook({
      body: {
        event: 'messages.update',
        instance: 'main',
        data: { keyId: 'K', remoteJid: '1@s.whatsapp.net', fromMe: true, status: 'READ' },
        date_time: '2026-09-25T10:16:00.000Z',
      },
      params: { events: ['MESSAGES_UPDATE'], options },
    });
    expect(receipt.result.workflowData).toHaveLength(1);
  });
});

// ============================================================================
// webhook(): deduplication
// ============================================================================

describe('webhook() deduplication of retried deliveries', () => {
  it('starts the workflow once when Evolution retries the same delivery', async () => {
    const staticData = registeredStaticData();
    const first = await runWebhook({ body: upsertBody(), staticData });
    const retry = await runWebhook({ body: upsertBody(), staticData });

    expect(first.result.workflowData).toHaveLength(1);
    expect(retry.result).toEqual({
      webhookResponse: { received: true, ignored: 'duplicate delivery' },
    });
    expect(Object.keys(staticData.recentDeliveries as IDataObject)).toHaveLength(1);
  });

  it('also recognizes retries through the static data alone (other n8n process)', async () => {
    const staticData = registeredStaticData();
    await runWebhook({ body: upsertBody(), staticData });
    resetDeliveryMemory();
    const retry = await runWebhook({ body: upsertBody(), staticData });
    expect(retry.result).toEqual({
      webhookResponse: { received: true, ignored: 'duplicate delivery' },
    });
  });

  it('keeps distinct messages and distinct receipts of the same message', async () => {
    const staticData = registeredStaticData();
    const other = upsertBody(
      {},
      { key: { remoteJid: '1@s.whatsapp.net', fromMe: false, id: 'OTHER' } },
    );
    const receipt = (dateTime: string, status: string) => ({
      event: 'messages.update',
      instance: 'main',
      data: { keyId: 'K', remoteJid: '1@s.whatsapp.net', fromMe: true, status },
      date_time: dateTime,
    });
    const params = { events: [] };

    const results = [];
    for (const body of [
      upsertBody(),
      other,
      receipt('2026-09-25T10:16:00.000Z', 'DELIVERY_ACK'),
      receipt('2026-09-25T10:16:05.000Z', 'READ'),
    ]) {
      results.push((await runWebhook({ body, staticData, params })).result);
    }
    expect(results.every((result) => result.workflowData?.length === 1)).toBe(true);
    expect(Object.keys(staticData.recentDeliveries as IDataObject)).toHaveLength(4);
  });

  it('can be turned off', async () => {
    const staticData = registeredStaticData();
    const params = { options: { deduplicate: false } };
    await runWebhook({ body: upsertBody(), staticData, params });
    const retry = await runWebhook({ body: upsertBody(), staticData, params });
    expect(retry.result.workflowData).toHaveLength(1);
    expect(staticData.recentDeliveries).toBeUndefined();
  });

  it('forgets deliveries after the TTL and keeps the static cache bounded', () => {
    const staticData: IDataObject = {};
    const t0 = 1_000_000;
    expect(isDuplicateDelivery(staticData, 's', 'k', t0)).toBe(false);
    expect(staticData.recentDeliveries).toBeUndefined();
    expect(isDuplicateDelivery(staticData, 's', 'k', t0)).toBe(false);
    rememberDelivery(staticData, 's', 'k', t0);
    expect(isDuplicateDelivery(staticData, 's', 'k', t0 + 1000)).toBe(true);
    resetDeliveryMemory();
    expect(isDuplicateDelivery(staticData, 's', 'k', t0 + DEDUPE_TTL_MS + 1)).toBe(false);

    for (let i = 0; i < DEDUPE_MAX_STATIC_ENTRIES + 50; i++) {
      rememberDelivery(staticData, 's', `key-${i}`, t0 + DEDUPE_TTL_MS + 10 + i);
    }
    const log = staticData.recentDeliveries as IDataObject;
    expect(Object.keys(log)).toHaveLength(DEDUPE_MAX_STATIC_ENTRIES);
    expect(log).toHaveProperty(`key-${DEDUPE_MAX_STATIC_ENTRIES + 49}`);
    expect(log).not.toHaveProperty('key-0');
  });

  it('keys messages by message key and other events by their content', () => {
    const body = upsertBody();
    expect(getDeliveryKey(body)).toBe(getDeliveryKey(upsertBody({ date_time: 'later' })));
    expect(getDeliveryKey(body)).not.toBe(getDeliveryKey(upsertBody({ instance: 'other' })));
    expect(getDeliveryKey(body)).toMatch(/^[0-9a-f]{32}$/);
    // Stable when 2.4 + Chatwoot rewrites key.remoteJid between retries (EVOCW-10).
    const rewritten = upsertBody();
    ((rewritten.data as IDataObject).key as IDataObject).remoteJid = '99887766@lid';
    expect(getDeliveryKey(rewritten)).toBe(getDeliveryKey(body));
    const sent = upsertBody({ event: 'send.message' });
    expect(getDeliveryKey(sent)).not.toBe(getDeliveryKey(body));
    const update = { event: 'messages.update', instance: 'main', data: { keyId: 'K' } };
    expect(getDeliveryKey({ ...update, date_time: 'a' })).not.toBe(
      getDeliveryKey({ ...update, date_time: 'b' }),
    );
  });
});

// ============================================================================
// webhook(): media (Webhook Base64)
// ============================================================================

describe('webhook() media as binary', () => {
  const imageBase64 = Buffer.from('JPEGDATA').toString('base64');

  function imageBody(): IDataObject {
    return upsertBody(
      {},
      {
        key: { remoteJid: '1@s.whatsapp.net', fromMe: false, id: 'IMG1' },
        messageType: 'imageMessage',
        message: {
          imageMessage: { mimetype: 'image/jpeg', caption: 'look', fileLength: '8' },
          base64: imageBase64,
        },
      },
    );
  }

  it('moves data.message.base64 into a binary property', async () => {
    const body = imageBody();
    const { result, ctx } = await runWebhook({ body });

    const [item] = result.workflowData?.[0] ?? [];
    expect(item.binary?.data).toMatchObject({
      data: imageBase64,
      mimeType: 'image/jpeg',
      fileName: 'IMG1.jpg',
    });
    expect(ctx.helpers.prepareBinaryData).toHaveBeenCalledWith(
      Buffer.from('JPEGDATA'),
      'IMG1.jpg',
      'image/jpeg',
    );
    const message = (item.json.data as IDataObject).message as IDataObject;
    expect(message).toEqual({
      imageMessage: { mimetype: 'image/jpeg', caption: 'look', fileLength: '8' },
    });
    expect(item.json.text).toBe('look');
    // The request body is not mutated.
    expect(((body.data as IDataObject).message as IDataObject).base64).toBe(imageBase64);
  });

  it('accepts a retry after binary storage failed without marking the failed delivery seen', async () => {
    const staticData = registeredStaticData();
    const failed = createTriggerContext({ body: imageBody(), staticData, headers: validHeaders() });
    jest.mocked(failed.ctx.helpers.prepareBinaryData).mockRejectedValueOnce(new Error('ENOSPC'));
    await expect(trigger.webhook.call(failed.webhook)).rejects.toThrow('ENOSPC');
    expect(staticData.recentDeliveries).toBeUndefined();

    const retry = await runWebhook({ body: imageBody(), staticData });
    expect(retry.result.workflowData?.[0][0].binary?.data).toBeDefined();
    const duplicate = await runWebhook({ body: imageBody(), staticData });
    expect(duplicate.result).toEqual({
      webhookResponse: { received: true, ignored: 'duplicate delivery' },
    });
  });

  it('deduplicates simultaneous deliveries after asynchronous binary preparation', async () => {
    const staticData = registeredStaticData();
    const first = createTriggerContext({ body: imageBody(), staticData, headers: validHeaders() });
    const second = createTriggerContext({ body: imageBody(), staticData, headers: validHeaders() });
    const results = await Promise.all([
      trigger.webhook.call(first.webhook),
      trigger.webhook.call(second.webhook),
    ]);
    expect(results.filter((result) => result.workflowData)).toHaveLength(1);
    expect(results.filter((result) => result.webhookResponse)).toHaveLength(1);
  });

  it('keeps the document file name and honours a custom binary property', async () => {
    const body = upsertBody(
      {},
      {
        key: { remoteJid: '1@s.whatsapp.net', fromMe: false, id: 'DOC1' },
        messageType: 'documentMessage',
        message: {
          documentMessage: { mimetype: 'application/pdf', fileName: 'invoice.pdf' },
          base64: Buffer.from('%PDF').toString('base64'),
        },
      },
    );
    const { result } = await runWebhook({
      body,
      params: { options: { binaryPropertyName: 'file' } },
    });
    const [item] = result.workflowData?.[0] ?? [];
    expect(item.binary?.file).toMatchObject({
      fileName: 'invoice.pdf',
      mimeType: 'application/pdf',
    });
    expect(item.binary?.data).toBeUndefined();
  });

  it('derives an extension from mime types with parameters (voice notes)', async () => {
    const body = upsertBody(
      {},
      {
        key: { remoteJid: '1@s.whatsapp.net', fromMe: false, id: 'AUD1' },
        messageType: 'audioMessage',
        message: {
          audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true },
          base64: Buffer.from('OGG').toString('base64'),
        },
      },
    );
    const { result } = await runWebhook({ body });
    expect(result.workflowData?.[0][0].binary?.data).toMatchObject({
      fileName: 'AUD1.ogg',
      mimeType: 'audio/ogg; codecs=opus',
    });
  });

  it('leaves the base64 in the JSON when binary output is off', async () => {
    const { result, ctx } = await runWebhook({
      body: imageBody(),
      params: { options: { binaryOutput: false } },
    });
    const [item] = result.workflowData?.[0] ?? [];
    expect(item.binary).toBeUndefined();
    expect(((item.json.data as IDataObject).message as IDataObject).base64).toBe(imageBase64);
    expect(ctx.helpers.prepareBinaryData).not.toHaveBeenCalled();
  });

  it('ignores invalid base64 and messages without media', async () => {
    const invalid = imageBody();
    ((invalid.data as IDataObject).message as IDataObject).base64 = 'not base64!';
    const { result } = await runWebhook({ body: invalid });
    expect(result.workflowData?.[0][0].binary).toBeUndefined();

    const text = await runWebhook({
      body: upsertBody({}, { key: { remoteJid: '2@s.whatsapp.net', id: 'T' } }),
    });
    expect(text.result.workflowData?.[0][0].binary).toBeUndefined();
  });
});
