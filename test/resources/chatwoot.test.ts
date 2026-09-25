import { EvolutionApi } from '../../nodes/EvolutionApi/EvolutionApi.node';
import { resetRetryPolicy, setRetryPolicy } from '../../nodes/EvolutionApi/GenericFunctions';
import { buildChatwootBody } from '../../nodes/EvolutionApi/resources/chatwoot/set.operation';
import { createMockExecuteFunctions, rl } from '../helpers/mockExecuteFunctions';

// Tests of the chatwoot resource.

beforeEach(() => setRetryPolicy({ sleep: async () => undefined }));
afterEach(() => resetRetryPolicy());

const NOT_CONFIGURED = {
  enabled: false,
  url: '',
  accountId: '',
  token: '',
  signMsg: false,
  nameInbox: '',
  webhook_url: '',
};

/** GET /chatwoot/find of an instance in production (groups ignored, custom inbox). */
const STORED = {
  enabled: true,
  accountId: '7',
  token: 'cw-token',
  url: 'https://chatwoot.test',
  nameInbox: 'Sales WhatsApp',
  signMsg: true,
  signDelimiter: '\\n--\\n',
  reopenConversation: true,
  conversationPending: false,
  mergeBrazilContacts: false,
  importContacts: true,
  importMessages: false,
  daysLimitImportMessages: 3,
  organization: 'Acme',
  logo: 'https://acme.test/logo.png',
  ignoreJids: ['@g.us', '5215512345678@s.whatsapp.net'],
  webhook_url: 'https://evo.test/chatwoot/webhook/main',
};

describe('chatwoot > get', () => {
  it('GET /chatwoot/find/:instance and removes the token', async () => {
    const ctx = createMockExecuteFunctions({
      params: { resource: 'chatwoot', operation: 'get', instanceName: rl('main', 'list') },
    });
    ctx.http.reply('GET', '/chatwoot/find/main', {
      enabled: false,
      url: '',
      accountId: '',
      token: '',
      signMsg: false,
    });

    const [output] = await new EvolutionApi().execute.call(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/chatwoot/find/main');
    expect(call.qs).toBeUndefined();
    expect(call.body).toBeUndefined();
    expect(output.map((item) => item.json)).toEqual([
      { enabled: false, url: '', accountId: '', signMsg: false },
    ]);
    expect(output.every((item) => item.pairedItem !== undefined)).toBe(true);
  });

  it('keeps the token with Include Secrets', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'chatwoot',
        operation: 'get',
        instanceName: 'main',
        options: { includeSecrets: true },
      },
    });
    ctx.http.reply('GET', '/chatwoot/find/main', STORED);
    const [output] = await new EvolutionApi().execute.call(ctx);
    expect(output[0].json).toEqual(STORED);
  });

  it('shows "Chatwoot is disabled" (CHATWOOT_ENABLED=false)', async () => {
    const ctx = createMockExecuteFunctions({
      params: { resource: 'chatwoot', operation: 'get', instanceName: 'main' },
    });
    ctx.http.reply(
      'GET',
      '/chatwoot/find/main',
      { status: 400, error: 'Bad Request', response: { message: ['Chatwoot is disabled'] } },
      400,
    );
    await expect(new EvolutionApi().execute.call(ctx)).rejects.toMatchObject({
      message: 'Bad request: Chatwoot is disabled',
    });
  });
});

describe('chatwoot > set', () => {
  it('disabling keeps ignoreJids, signDelimiter, nameInbox and the rest (EVONODE-4/EVOCW-11)', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'chatwoot',
        operation: 'set',
        instanceName: rl('main'),
        updateFields: { enabled: false },
      },
    });
    ctx.http.reply('GET', '/chatwoot/find/main', STORED);
    ctx.http.reply('POST', '/chatwoot/set/main', { ...STORED, enabled: false }, 201);

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /chatwoot/find/main',
      'POST /chatwoot/set/main',
    ]);
    expect(ctx.http.calls[1].body).toEqual({
      enabled: false,
      accountId: '7',
      token: 'cw-token',
      url: 'https://chatwoot.test',
      signMsg: true,
      reopenConversation: true,
      conversationPending: false,
      importContacts: true,
      importMessages: false,
      mergeBrazilContacts: false,
      nameInbox: 'Sales WhatsApp',
      organization: 'Acme',
      logo: 'https://acme.test/logo.png',
      daysLimitImportMessages: 3,
      signDelimiter: '\\n--\\n',
      ignoreJids: ['@g.us', '5215512345678@s.whatsapp.net'],
    });
    expect(output[0].json.token).toBeUndefined();
    expect(output[0].json.enabled).toBe(false);
  });

  it('replaces ignoreJids with the parsed list and sends number/autoCreate only when added', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'chatwoot',
        operation: 'set',
        instanceName: 'main',
        updateFields: {
          ignoreJids: '@g.us\n+52 1 55 9999 0000, 123456789@lid',
          number: '+52 1 55 1234 5678',
          autoCreate: true,
        },
      },
    });
    ctx.http.reply('GET', '/chatwoot/find/main', STORED);
    ctx.http.reply('POST', '/chatwoot/set/main', STORED, 201);

    await new EvolutionApi().execute.call(ctx);

    const body = ctx.http.calls[1].body as Record<string, unknown>;
    expect(body.ignoreJids).toEqual(['@g.us', '5215599990000@s.whatsapp.net', '123456789@lid']);
    expect(body.number).toBe('5215512345678');
    expect(body.autoCreate).toBe(true);
    expect(body.enabled).toBe(true);
  });

  it('configures a new integration: enabled by default, required booleans false', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'chatwoot',
        operation: 'set',
        instanceName: 'main',
        updateFields: {
          accountId: '1',
          token: 'tok',
          url: 'https://chatwoot.test/',
          nameInbox: 'Support',
        },
      },
    });
    ctx.http.reply('GET', '/chatwoot/find/main', NOT_CONFIGURED);
    ctx.http.reply(
      'POST',
      '/chatwoot/set/main',
      { enabled: true, token: 'tok', webhook_url: 'https://evo.test/chatwoot/webhook/main' },
      201,
    );

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls[1].body).toEqual({
      enabled: true,
      accountId: '1',
      token: 'tok',
      url: 'https://chatwoot.test',
      signMsg: false,
      reopenConversation: false,
      conversationPending: false,
      nameInbox: 'Support',
    });
    expect(output[0].json).toEqual({
      enabled: true,
      webhook_url: 'https://evo.test/chatwoot/webhook/main',
    });
  });

  it('refuses to enable an integration without Account ID, token and URL', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'chatwoot',
        operation: 'set',
        instanceName: 'main',
        updateFields: { signMsg: true },
      },
    });
    ctx.http.reply('GET', '/chatwoot/find/main', NOT_CONFIGURED);
    await expect(new EvolutionApi().execute.call(ctx)).rejects.toThrow(
      'Missing Chatwoot fields: Account ID, API Access Token, URL',
    );
    expect(ctx.http.calls).toHaveLength(1);
  });

  it('rejects a Chatwoot URL without http(s)', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'chatwoot',
        operation: 'set',
        instanceName: 'main',
        updateFields: { url: 'chatwoot.test' },
      },
    });
    ctx.http.reply('GET', '/chatwoot/find/main', STORED);
    await expect(new EvolutionApi().execute.call(ctx)).rejects.toThrow(
      'Invalid Chatwoot URL "chatwoot.test"',
    );
  });

  it('fails without any field, before calling the API', async () => {
    const ctx = createMockExecuteFunctions({
      params: { resource: 'chatwoot', operation: 'set', instanceName: 'main' },
    });
    await expect(new EvolutionApi().execute.call(ctx)).rejects.toThrow(
      'Add at least one field to set',
    );
    expect(ctx.http.calls).toEqual([]);
  });

  it('updates every item against its own instance', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'chatwoot',
        operation: 'set',
        updateFields: { reopenConversation: false },
      },
      items: [{ json: {} }, { json: {} }],
      itemParams: [{ instanceName: 'a' }, { instanceName: 'b' }],
    });
    ctx.http.reply('GET', '/chatwoot/find/a', STORED);
    ctx.http.reply('POST', '/chatwoot/set/a', { url: 'a' }, 201);
    ctx.http.reply('GET', '/chatwoot/find/b', STORED);
    ctx.http.reply('POST', '/chatwoot/set/b', { url: 'b' }, 201);

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls.map((call) => call.path)).toEqual([
      '/chatwoot/find/a',
      '/chatwoot/set/a',
      '/chatwoot/find/b',
      '/chatwoot/set/b',
    ]);
    expect(output.map((item) => item.json.url)).toEqual(['a', 'b']);
    expect(output.map((item) => item.pairedItem)).toEqual([{ item: 0 }, { item: 1 }]);
  });
});

describe('chatwoot > buildChatwootBody', () => {
  it('resets the delimiter with an empty value and never sends null optional columns', () => {
    const body = buildChatwootBody(
      { ...STORED, organization: null, logo: null, daysLimitImportMessages: null },
      { signDelimiter: '' },
    );
    expect(body.signDelimiter).toBeNull();
    expect(body).not.toHaveProperty('organization');
    expect(body).not.toHaveProperty('logo');
    expect(body).not.toHaveProperty('daysLimitImportMessages');
  });

  it('keeps a stored integration disabled when "Enabled" is not added', () => {
    expect(buildChatwootBody({ ...STORED, enabled: false }, { signMsg: false }).enabled).toBe(
      false,
    );
    expect(buildChatwootBody({ ...STORED, enabled: null }, { signMsg: false }).enabled).toBe(false);
  });
});
