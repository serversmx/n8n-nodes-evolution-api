import type { IDataObject } from 'n8n-workflow';

import { EvolutionApi } from '../../nodes/EvolutionApi/EvolutionApi.node';
import { resetRetryPolicy, setRetryPolicy } from '../../nodes/EvolutionApi/GenericFunctions';
import { fields, methods } from '../../nodes/EvolutionApi/resources/chatbot';
import {
  collectBotFields,
  parseMessageList,
  redactBotSecrets,
} from '../../nodes/EvolutionApi/resources/chatbot/helpers';
import {
  buildSettingsBody,
  planSettingsRequests,
} from '../../nodes/EvolutionApi/resources/chatbot/setSettings.operation';
import {
  createMockExecuteFunctions,
  createMockLoadOptionsFunctions,
  rl,
} from '../helpers/mockExecuteFunctions';

// Tests of the chatbot resource.

beforeEach(() => setRetryPolicy({ sleep: async () => undefined }));
afterEach(() => resetRetryPolicy());

const base = (operation: string, extra: IDataObject = {}) => ({
  resource: 'chatbot',
  operation,
  instanceName: rl('main', 'list'),
  ...extra,
});

const bodyOf = (call: { body?: unknown }) => call.body as IDataObject;

const N8N_BOT = {
  id: 'bot1',
  enabled: true,
  description: 'Sales',
  webhookUrl: 'https://n8n.test/webhook/bot',
  basicAuthUser: 'evo',
  basicAuthPass: 'pass',
  expire: null,
  keywordFinish: 'bye',
  delayMessage: 1000,
  unknownMessage: null,
  listeningFromMe: false,
  stopBotFromMe: true,
  keepOpen: false,
  debounceTime: 10,
  ignoreJids: ['@g.us'],
  splitMessages: false,
  timePerChar: 0,
  triggerType: 'keyword',
  triggerOperator: 'equals',
  triggerValue: 'hi',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  instanceId: 'inst1',
};

/** GET /:botType/fetchSettings when nothing was saved yet (no "id"). */
const EVOLUTION_DEFAULT_SETTINGS: IDataObject = {
  expire: 300,
  keywordFinish: 'bye',
  delayMessage: 1000,
  unknownMessage: 'Sorry, I dont understand',
  listeningFromMe: true,
  stopBotFromMe: true,
  keepOpen: false,
  debounceTime: 1,
  ignoreJids: [],
  splitMessages: false,
  timePerChar: 0,
  fallbackId: '',
  fallback: null,
};

describe('chatbot > getMany', () => {
  it('GET /:botType/find/:instance', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        ...{ resource: 'chatbot', operation: 'getMany', botType: 'evolutionBot' },
        instanceName: rl('main', 'list'),
      },
    });
    ctx.http.reply('GET', '/evolutionBot/find/main', [{ id: 'bot1' }]);

    const [output] = await new EvolutionApi().execute.call(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/evolutionBot/find/main');
    expect(call.qs).toBeUndefined();
    expect(call.body).toBeUndefined();
    expect(output.map((item) => item.json)).toEqual([{ id: 'bot1' }]);
    expect(output.every((item) => item.pairedItem !== undefined)).toBe(true);
  });

  it('removes API keys and Basic Auth passwords unless Include Secrets is on', async () => {
    const ctx = createMockExecuteFunctions({
      params: base('getMany', { botType: 'n8n' }),
      items: [{ json: {} }, { json: {} }],
      itemParams: [{}, { options: { includeSecrets: true } }],
    });
    ctx.http.reply('GET', '/n8n/find/main', [N8N_BOT]);
    ctx.http.reply('GET', '/n8n/find/main', [N8N_BOT]);

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(output[0].json.basicAuthPass).toBeUndefined();
    expect(output[0].json.basicAuthUser).toBe('evo');
    expect(output[1].json.basicAuthPass).toBe('pass');
  });

  it('rejects an unknown bot type from an expression', async () => {
    const ctx = createMockExecuteFunctions({ params: base('getMany', { botType: 'chatwoot' }) });
    await expect(new EvolutionApi().execute.call(ctx)).rejects.toThrow(
      'Unknown bot type "chatwoot"',
    );
    expect(ctx.http.calls).toEqual([]);
  });
});

it('chatbot > getMany uses the default bot type (n8n) when none is given', async () => {
  // The mock falls back to the node description defaults, as n8n does.
  const ctx = createMockExecuteFunctions({
    params: { resource: 'chatbot', operation: 'getMany', instanceName: 'main' },
  });
  ctx.http.reply('GET', '/n8n/find/main', []);
  await new EvolutionApi().execute.call(ctx);
  expect(ctx.http.calls[0].path).toBe('/n8n/find/main');
});

describe('chatbot > get', () => {
  it('GET /:botType/fetch/:botId/:instance (bot ID first, then instance)', async () => {
    const ctx = createMockExecuteFunctions({
      params: base('get', { botType: 'flowise', botId: rl('bot/1', 'name') }),
    });
    ctx.http.reply('GET', '/flowise/fetch/bot%2F1/main', { id: 'bot/1', apiKey: 'k' });

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls[0].method).toBe('GET');
    expect(ctx.http.calls[0].path).toBe('/flowise/fetch/bot%2F1/main');
    expect(output[0].json).toEqual({ id: 'bot/1' });
  });

  it('turns the null of an unknown ID into "not found"', async () => {
    const ctx = createMockExecuteFunctions({ params: base('get', { botType: 'n8n', botId: 'x' }) });
    ctx.http.reply('GET', '/n8n/fetch/x/main', null);
    await expect(new EvolutionApi().execute.call(ctx)).rejects.toThrow('n8n bot "x" not found');
  });

  it('never sends "." or ".." as a bot ID', async () => {
    const ctx = createMockExecuteFunctions({
      params: base('get', { botType: 'n8n', botId: '..' }),
    });
    await expect(new EvolutionApi().execute.call(ctx)).rejects.toThrow(
      'Bot ID ".." is not allowed in a URL path',
    );
    expect(ctx.http.calls).toEqual([]);
  });
});

describe('chatbot > create', () => {
  const cases: Array<[string, IDataObject, IDataObject]> = [
    [
      'n8n',
      {
        n8nWebhookUrl: 'https://n8n.test/webhook/bot',
        additionalFields: { basicAuthUser: 'evo', basicAuthPass: 'pw' },
      },
      {
        webhookUrl: 'https://n8n.test/webhook/bot',
        basicAuthUser: 'evo',
        basicAuthPass: 'pw',
      },
    ],
    [
      'typebot',
      { typebotUrl: 'https://typebot.test', typebotPublicId: 'lead-flow' },
      { url: 'https://typebot.test', typebot: 'lead-flow' },
    ],
    [
      'dify',
      { difyBotType: 'agent', botApiUrl: 'https://api.dify.test/v1', botApiKey: 'app-key' },
      { botType: 'agent', apiUrl: 'https://api.dify.test/v1', apiKey: 'app-key' },
    ],
    [
      'flowise',
      { botApiUrl: 'https://flowise.test/api/v1/prediction/1' },
      { apiUrl: 'https://flowise.test/api/v1/prediction/1' },
    ],
    [
      'evolutionBot',
      { botApiUrl: 'https://bot.test', botApiKey: 'k' },
      { apiUrl: 'https://bot.test', apiKey: 'k' },
    ],
    [
      'evoai',
      { evoaiAgentUrl: 'https://evoai.test/agent' },
      { agentUrl: 'https://evoai.test/agent' },
    ],
    [
      'openai',
      {
        openaiCredsId: 'cred1',
        openaiBotType: 'chatCompletion',
        openaiModel: 'gpt-4o-mini',
        openaiMaxTokens: 300,
        additionalFields: { systemMessages: '["Be brief", "Answer in Spanish"]' },
      },
      {
        openaiCredsId: 'cred1',
        botType: 'chatCompletion',
        model: 'gpt-4o-mini',
        maxTokens: 300,
        systemMessages: ['Be brief', 'Answer in Spanish'],
      },
    ],
  ];

  it.each(cases)(
    'POST /%s/create/:instance with the specific fields',
    async (botType, params, specific) => {
      const ctx = createMockExecuteFunctions({
        params: base('create', {
          botType,
          triggerType: 'keyword',
          triggerOperator: 'startsWith',
          triggerValue: 'hi',
          ...params,
        }),
      });
      ctx.http.reply(
        'POST',
        `/${botType}/create/main`,
        { id: 'new', apiKey: 'k', basicAuthPass: 'pw' },
        201,
      );

      const [output] = await new EvolutionApi().execute.call(ctx);

      const [call] = ctx.http.calls;
      expect(call.method).toBe('POST');
      expect(call.path).toBe(`/${botType}/create/main`);
      expect(call.body).toEqual({
        enabled: true,
        triggerType: 'keyword',
        triggerOperator: 'startsWith',
        triggerValue: 'hi',
        ...specific,
      });
      expect(output[0].json).toEqual({ id: 'new' });
    },
  );

  it('sends the behavior fields with their API names and types', async () => {
    const ctx = createMockExecuteFunctions({
      params: base('create', {
        botType: 'n8n',
        triggerType: 'all',
        n8nWebhookUrl: 'https://n8n.test/w',
        botEnabled: false,
        additionalFields: {
          description: 'Support bot',
          expire: 20.4,
          keywordFinish: '#exit',
          delayMessage: '1500',
          unknownMessage: 'Text only, please',
          listeningFromMe: false,
          stopBotFromMe: true,
          keepOpen: true,
          debounceTime: 5,
          ignoreJids: '@g.us, 5215512345678',
          splitMessages: true,
          timePerChar: 50,
          // Not an n8n field: ignored.
          apiKey: 'nope',
        },
      }),
    });
    ctx.http.reply('POST', '/n8n/create/main', { id: 'b' }, 201);

    await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls[0].body).toEqual({
      enabled: false,
      triggerType: 'all',
      webhookUrl: 'https://n8n.test/w',
      description: 'Support bot',
      expire: 20,
      keywordFinish: '#exit',
      delayMessage: 1500,
      unknownMessage: 'Text only, please',
      listeningFromMe: false,
      stopBotFromMe: true,
      keepOpen: true,
      debounceTime: 5,
      ignoreJids: ['@g.us', '5215512345678@s.whatsapp.net'],
      splitMessages: true,
      timePerChar: 50,
    });
  });

  it('checks the trigger and the required bot fields before calling the API', async () => {
    const noValue = createMockExecuteFunctions({
      params: base('create', { botType: 'n8n', triggerType: 'advanced', n8nWebhookUrl: 'x' }),
    });
    await expect(new EvolutionApi().execute.call(noValue)).rejects.toThrow(
      'Missing bot fields: Trigger Value',
    );

    const noAssistant = createMockExecuteFunctions({
      params: base('create', {
        botType: 'openai',
        triggerType: 'none',
        openaiCredsId: 'c',
        openaiBotType: 'assistant',
      }),
    });
    await expect(new EvolutionApi().execute.call(noAssistant)).rejects.toThrow(
      'Missing bot fields: Assistant ID',
    );

    const noUrl = createMockExecuteFunctions({
      params: base('create', { botType: 'flowise', triggerType: 'all' }),
    });
    await expect(new EvolutionApi().execute.call(noUrl)).rejects.toThrow(
      'Missing bot fields: API URL',
    );
    expect([...noValue.http.calls, ...noAssistant.http.calls, ...noUrl.http.calls]).toEqual([]);
  });

  it('explains the HTTP 500 of a duplicate trigger', async () => {
    const ctx = createMockExecuteFunctions({
      params: base('create', {
        botType: 'n8n',
        triggerType: 'all',
        n8nWebhookUrl: 'https://n8n.test/w',
      }),
    });
    ctx.http.reply(
      'POST',
      '/n8n/create/main',
      {
        status: 500,
        error: 'Internal Server Error',
        response: {
          message: [
            'You already have a N8n with an "All" trigger, you cannot have more bots while it is active',
          ],
        },
      },
      500,
    );
    await expect(new EvolutionApi().execute.call(ctx)).rejects.toMatchObject({
      httpCode: '500',
      message: expect.stringContaining('"All" trigger'),
      description: expect.stringContaining('second enabled "All" n8n bot'),
    });
  });
});

describe('chatbot > update', () => {
  it('reads the bot, merges the changes and PUTs every create field', async () => {
    const ctx = createMockExecuteFunctions({
      params: base('update', {
        botType: 'n8n',
        botId: rl('bot1', 'list'),
        updateFields: { enabled: false, keywordFinish: 'stop', basicAuthPass: 'new-pass' },
      }),
    });
    ctx.http.reply('GET', '/n8n/fetch/bot1/main', N8N_BOT);
    ctx.http.reply('PUT', '/n8n/update/bot1/main', { ...N8N_BOT, enabled: false });

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /n8n/fetch/bot1/main',
      'PUT /n8n/update/bot1/main',
    ]);
    // Null columns (expire, unknownMessage) and row metadata are not sent.
    expect(ctx.http.calls[1].body).toEqual({
      enabled: false,
      description: 'Sales',
      triggerType: 'keyword',
      triggerOperator: 'equals',
      triggerValue: 'hi',
      keywordFinish: 'stop',
      delayMessage: 1000,
      listeningFromMe: false,
      stopBotFromMe: true,
      keepOpen: false,
      debounceTime: 10,
      ignoreJids: ['@g.us'],
      splitMessages: false,
      timePerChar: 0,
      webhookUrl: 'https://n8n.test/webhook/bot',
      basicAuthUser: 'evo',
      basicAuthPass: 'new-pass',
    });
    expect(output[0].json.enabled).toBe(false);
    expect(output[0].json.basicAuthPass).toBeUndefined();
  });

  it('maps the OpenAI and Dify bot type fields to "botType"', () => {
    expect(collectBotFields({ openaiBotType: 'assistant', assistantId: 'a' }, 'openai')).toEqual({
      botType: 'assistant',
      assistantId: 'a',
    });
    expect(collectBotFields({ difyBotType: 'workflow', openaiBotType: 'x' }, 'dify')).toEqual({
      botType: 'workflow',
    });
  });

  it('validates a trigger switched to keyword without an operator', async () => {
    const ctx = createMockExecuteFunctions({
      params: base('update', {
        botType: 'n8n',
        botId: 'bot1',
        updateFields: { triggerType: 'keyword' },
      }),
    });
    ctx.http.reply('GET', '/n8n/fetch/bot1/main', {
      ...N8N_BOT,
      triggerType: 'all',
      triggerOperator: null,
      triggerValue: null,
    });
    await expect(new EvolutionApi().execute.call(ctx)).rejects.toThrow(
      'Missing bot fields: Trigger Operator, Trigger Value',
    );
    expect(ctx.http.calls).toHaveLength(1);
  });

  it('requires at least one field', async () => {
    const ctx = createMockExecuteFunctions({ params: base('update', { botId: 'bot1' }) });
    await expect(new EvolutionApi().execute.call(ctx)).rejects.toThrow(
      'Add at least one field to update',
    );
    expect(ctx.http.calls).toEqual([]);
  });
});

describe('chatbot > delete', () => {
  it('DELETE /:botType/delete/:botId/:instance for every item', async () => {
    const ctx = createMockExecuteFunctions({
      params: base('delete', { botType: 'evoai' }),
      items: [{ json: {} }, { json: {} }],
      itemParams: [{ botId: 'a' }, { botId: 'b' }],
    });
    ctx.http.reply('DELETE', '/evoai/delete/a/main', { bot: { id: 'a' } });
    ctx.http.reply('DELETE', '/evoai/delete/b/main', { bot: { id: 'b' } });

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'DELETE /evoai/delete/a/main',
      'DELETE /evoai/delete/b/main',
    ]);
    expect(output.map((item) => item.json)).toEqual([{ bot: { id: 'a' } }, { bot: { id: 'b' } }]);
    expect(output.map((item) => item.pairedItem)).toEqual([{ item: 0 }, { item: 1 }]);
  });

  it('explains the HTTP 500 of an unknown bot', async () => {
    const ctx = createMockExecuteFunctions({ params: base('delete', { botId: 'zzz' }) });
    ctx.http.reply(
      'DELETE',
      '/n8n/delete/zzz/main',
      {
        status: 500,
        error: 'Internal Server Error',
        response: { message: ['Error deleting N8n bot'] },
      },
      500,
    );
    await expect(new EvolutionApi().execute.call(ctx)).rejects.toMatchObject({
      description: expect.stringContaining('Check that the n8n bot "zzz" exists'),
    });
  });
});

describe('chatbot > getSettings', () => {
  it('GET /:botType/fetchSettings/:instance and removes the fallback API key', async () => {
    const ctx = createMockExecuteFunctions({ params: base('getSettings', { botType: 'flowise' }) });
    ctx.http.reply('GET', '/flowise/fetchSettings/main', {
      id: 's1',
      expire: 300,
      fallbackId: 'bot1',
      fallback: { id: 'bot1', apiKey: 'secret', apiUrl: 'https://flowise.test' },
    });

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls[0].method).toBe('GET');
    expect(ctx.http.calls[0].path).toBe('/flowise/fetchSettings/main');
    expect(output[0].json).toEqual({
      id: 's1',
      expire: 300,
      fallbackId: 'bot1',
      fallback: { id: 'bot1', apiUrl: 'https://flowise.test' },
    });
  });
});

describe('chatbot > setSettings', () => {
  it('merges with the stored settings, sends fallbackId and POSTs every required field', async () => {
    const ctx = createMockExecuteFunctions({
      params: base('setSettings', {
        botType: 'n8n',
        updateFields: { keepOpen: true, ignoreJids: '@g.us', fallbackId: 'bot2' },
      }),
    });
    ctx.http.reply('GET', '/n8n/fetchSettings/main', {
      id: 's1',
      expire: 60,
      keywordFinish: 'salir',
      delayMessage: null,
      unknownMessage: 'No entiendo',
      listeningFromMe: false,
      stopBotFromMe: false,
      keepOpen: false,
      debounceTime: 3,
      ignoreJids: [],
      splitMessages: true,
      timePerChar: 10,
      n8nIdFallback: null,
      fallbackId: null,
      fallback: null,
      instanceId: 'inst1',
    });
    ctx.http.reply('POST', '/n8n/settings/main', { id: 's1', keepOpen: true, fallbackId: 'bot2' });

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /n8n/fetchSettings/main',
      'POST /n8n/settings/main',
    ]);
    expect(ctx.http.calls[1].body).toEqual({
      expire: 60,
      keywordFinish: 'salir',
      delayMessage: 1000,
      unknownMessage: 'No entiendo',
      listeningFromMe: false,
      stopBotFromMe: false,
      keepOpen: true,
      debounceTime: 3,
      ignoreJids: ['@g.us'],
      splitMessages: true,
      timePerChar: 10,
      fallbackId: 'bot2',
    });
    expect(output[0].json).toEqual({ id: 's1', keepOpen: true, fallbackId: 'bot2' });
  });

  it('removes the stored fallback with "None" (null on an update)', () => {
    const plan = planSettingsRequests(
      { ...EVOLUTION_DEFAULT_SETTINGS, id: 's1', fallbackId: 'old' },
      { fallbackId: '' },
      'typebot',
    );
    expect(plan).toHaveLength(1);
    expect(plan[0].fallbackId).toBeNull();
    expect(plan[0].expire).toBe(300);
    expect(buildSettingsBody(EVOLUTION_DEFAULT_SETTINGS, {}, 'n8n')).not.toHaveProperty(
      'fallbackId',
    );
  });

  // Regression: the first save creates the row with Instance.connect, and Prisma rejects the
  // <bot>IdFallback column in that write (HTTP 500 "Error setting default settings").
  it('first save: creates the settings without fallbackId, then stores the fallback', async () => {
    const ctx = createMockExecuteFunctions({
      params: base('setSettings', { botType: 'n8n', updateFields: { fallbackId: 'bot2' } }),
    });
    ctx.http.reply('GET', '/n8n/fetchSettings/main', EVOLUTION_DEFAULT_SETTINGS);
    ctx.http.queue(
      'POST',
      '/n8n/settings/main',
      { body: { id: 's1', fallbackId: null } },
      { body: { id: 's1', n8nIdFallback: 'bot2', fallbackId: 'bot2' } },
    );

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /n8n/fetchSettings/main',
      'POST /n8n/settings/main',
      'POST /n8n/settings/main',
    ]);
    const stored = {
      expire: 300,
      keywordFinish: 'bye',
      delayMessage: 1000,
      unknownMessage: 'Sorry, I dont understand',
      listeningFromMe: true,
      stopBotFromMe: true,
      keepOpen: false,
      debounceTime: 1,
      ignoreJids: [],
      splitMessages: false,
      timePerChar: 0,
    };
    expect(bodyOf(ctx.http.calls[1])).toEqual(stored);
    expect(bodyOf(ctx.http.calls[2])).toEqual({ ...stored, fallbackId: 'bot2' });
    expect(output).toHaveLength(1);
    expect(output[0].json).toEqual({ id: 's1', n8nIdFallback: 'bot2', fallbackId: 'bot2' });
    expect(ctx.http.pending).toEqual([]);
  });

  it('first save without a fallback is a single POST with no fallbackId key', async () => {
    const ctx = createMockExecuteFunctions({
      params: base('setSettings', { botType: 'dify', updateFields: { expire: 30 } }),
    });
    ctx.http.reply('GET', '/dify/fetchSettings/main', EVOLUTION_DEFAULT_SETTINGS);
    ctx.http.reply('POST', '/dify/settings/main', { id: 's9', expire: 30 });

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls).toHaveLength(2);
    expect(bodyOf(ctx.http.calls[1])).not.toHaveProperty('fallbackId');
    expect(bodyOf(ctx.http.calls[1]).expire).toBe(30);
    expect(output[0].json).toEqual({ id: 's9', expire: 30 });
  });

  it('first save with an empty Keyword Finish: defaults first, the real values second', () => {
    // Without fallbackId the n8n/Dify/EvoAI/Evolution Bot schemas reject an empty keywordFinish.
    const plan = planSettingsRequests(
      EVOLUTION_DEFAULT_SETTINGS,
      { keywordFinish: '', unknownMessage: '' },
      'evolutionBot',
    );
    expect(plan).toHaveLength(2);
    expect(plan[0]).not.toHaveProperty('fallbackId');
    expect(plan[0]).toMatchObject({
      keywordFinish: 'bye',
      unknownMessage: 'Sorry, I dont understand',
    });
    expect(plan[1]).toMatchObject({ keywordFinish: '', unknownMessage: '', fallbackId: null });
  });

  it('requires an OpenAI credential and sends speechToText for OpenAI', async () => {
    const missing = createMockExecuteFunctions({
      params: base('setSettings', { botType: 'openai', updateFields: { expire: 10 } }),
    });
    missing.http.reply('GET', '/openai/fetchSettings/main', { expire: 300 });
    await expect(new EvolutionApi().execute.call(missing)).rejects.toThrow(
      'OpenAI Credential is required for OpenAI settings',
    );
    expect(missing.http.calls).toHaveLength(1);

    const ctx = createMockExecuteFunctions({
      params: base('setSettings', {
        botType: 'openai',
        updateFields: { speechToText: true },
      }),
    });
    ctx.http.reply('GET', '/openai/fetchSettings/main', {
      id: 's',
      expire: 300,
      openaiCredsId: 'cred1',
      fallbackId: 'ai1',
    });
    ctx.http.reply('POST', '/openai/settings/main', { id: 's', speechToText: true });
    const [output] = await new EvolutionApi().execute.call(ctx);
    expect(ctx.http.calls).toHaveLength(2);
    expect(bodyOf(ctx.http.calls[1])).toMatchObject({
      openaiCredsId: 'cred1',
      speechToText: true,
    });
    // Regression: OpenAI writes connect the credential, so fallbackId (a scalar column) would
    // make Prisma reject every OpenAI settings update. The stored fallback is left untouched.
    expect(bodyOf(ctx.http.calls[1])).not.toHaveProperty('fallbackId');
    expect(output[0].json).toEqual({ id: 's', speechToText: true });
  });

  it('stores an OpenAI fallback in a second write without the credential', async () => {
    const ctx = createMockExecuteFunctions({
      params: base('setSettings', {
        botType: 'openai',
        updateFields: { openaiCredsId: 'cred2', fallbackId: 'ai9' },
      }),
    });
    ctx.http.reply('GET', '/openai/fetchSettings/main', EVOLUTION_DEFAULT_SETTINGS);
    ctx.http.queue(
      'POST',
      '/openai/settings/main',
      { body: { id: 's', openaiCredsId: 'cred2', fallbackId: null } },
      { body: { id: 's', openaiCredsId: 'cred2', openaiIdFallback: 'ai9', fallbackId: 'ai9' } },
    );

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls).toHaveLength(3);
    expect(bodyOf(ctx.http.calls[1])).toMatchObject({ openaiCredsId: 'cred2' });
    expect(bodyOf(ctx.http.calls[1])).not.toHaveProperty('fallbackId');
    // An empty openaiCredsId makes Evolution skip OpenaiCreds.connect and keep the credential.
    expect(bodyOf(ctx.http.calls[2])).toMatchObject({ openaiCredsId: '', fallbackId: 'ai9' });
    expect(output[0].json).toMatchObject({ openaiCredsId: 'cred2', fallbackId: 'ai9' });
  });

  it('explains the HTTP 500 of a fallback bot of another type', async () => {
    const ctx = createMockExecuteFunctions({
      params: base('setSettings', { botType: 'flowise', updateFields: { fallbackId: 'n8nBot' } }),
    });
    ctx.http.reply('GET', '/flowise/fetchSettings/main', { ...EVOLUTION_DEFAULT_SETTINGS, id: 's' });
    ctx.http.reply(
      'POST',
      '/flowise/settings/main',
      { status: 500, error: 'Internal Server Error', response: { message: ['Error setting default settings'] } },
      500,
    );
    await expect(new EvolutionApi().execute.call(ctx)).rejects.toMatchObject({
      httpCode: '500',
      description: expect.stringContaining('fallback bot is a Flowise bot of this instance'),
    });
  });

  it('reloads the fallback and credential lists when the bot type or instance changes', () => {
    const settingsFields = fields.find(
      (field) =>
        field.name === 'updateFields' &&
        field.displayOptions?.show?.operation?.includes('setSettings'),
    );
    const updateFields = fields.find(
      (field) =>
        field.name === 'updateFields' && field.displayOptions?.show?.operation?.includes('update'),
    );
    const option = (field: typeof settingsFields, name: string) =>
      (field?.options as Array<{ name: string; typeOptions?: IDataObject }>).find(
        (entry) => entry.name === name,
      );
    expect(option(settingsFields, 'fallbackId')?.typeOptions?.loadOptionsDependsOn).toEqual([
      'botType',
      'instanceName.value',
    ]);
    expect(option(settingsFields, 'openaiCredsId')?.typeOptions?.loadOptionsDependsOn).toEqual([
      'instanceName.value',
    ]);
    expect(option(updateFields, 'openaiCredsId')?.typeOptions?.loadOptionsDependsOn).toEqual([
      'instanceName.value',
    ]);
  });

  it('requires at least one setting', async () => {
    const ctx = createMockExecuteFunctions({ params: base('setSettings') });
    await expect(new EvolutionApi().execute.call(ctx)).rejects.toThrow(
      'Add at least one setting to change',
    );
  });
});

describe('chatbot > changeStatus', () => {
  it('POST /:botType/changeStatus/:instance { remoteJid (full JID), status }', async () => {
    const ctx = createMockExecuteFunctions({
      params: base('changeStatus', { botType: 'typebot' }),
      items: [{ json: {} }, { json: {} }],
      itemParams: [
        { remoteJid: '+52 1 55 1234 5678', sessionStatus: 'paused' },
        { remoteJid: '123456789@lid', sessionStatus: 'opened' },
      ],
    });
    ctx.http.reply('POST', '/typebot/changeStatus/main', { bot: { status: 'paused' } });
    ctx.http.reply('POST', '/typebot/changeStatus/main', { bot: { status: 'opened' } });

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls.map((call) => call.body)).toEqual([
      { remoteJid: '5215512345678@s.whatsapp.net', status: 'paused' },
      { remoteJid: '123456789@lid', status: 'opened' },
    ]);
    expect(output.map((item) => item.json.bot)).toEqual([
      { status: 'paused' },
      { status: 'opened' },
    ]);
  });

  it('defaults to "paused" (the safe handoff status)', async () => {
    const ctx = createMockExecuteFunctions({
      params: base('changeStatus', { remoteJid: '5215512345678@s.whatsapp.net' }),
    });
    ctx.http.reply('POST', '/n8n/changeStatus/main', { bot: {} });
    await new EvolutionApi().execute.call(ctx);
    expect(bodyOf(ctx.http.calls[0]).status).toBe('paused');
  });

  it('requires a Remote JID', async () => {
    const ctx = createMockExecuteFunctions({ params: base('changeStatus') });
    await expect(new EvolutionApi().execute.call(ctx)).rejects.toThrow('Remote JID is required');
  });
});

describe('chatbot > getSessions', () => {
  it('GET /:botType/fetchSessions/:botId/:instance and filters client side', async () => {
    const ctx = createMockExecuteFunctions({
      params: base('getSessions', {
        botType: 'dify',
        botId: 'bot1',
        filters: { remoteJid: '5215512345678', status: 'paused' },
      }),
    });
    ctx.http.reply('GET', '/dify/fetchSessions/bot1/main', [
      { id: 's1', remoteJid: '5215512345678@s.whatsapp.net', status: 'paused' },
      { id: 's2', remoteJid: '5215512345678@s.whatsapp.net', status: 'opened' },
      { id: 's3', remoteJid: '1@s.whatsapp.net', status: 'paused' },
    ]);

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls[0].method).toBe('GET');
    expect(ctx.http.calls[0].path).toBe('/dify/fetchSessions/bot1/main');
    expect(output.map((item) => item.json.id)).toEqual(['s1']);
  });

  // Regression: typebot.service.ts stores AUTHENTICATION_API_KEY (the global key) in
  // session.parameters.apiKey, and fetchSessions returns it.
  it('removes the global API key Typebot stores in the session parameters', async () => {
    const session = {
      id: 's1',
      sessionId: '123-abc',
      remoteJid: '5215512345678@s.whatsapp.net',
      pushName: 'Ana',
      status: 'opened',
      awaitUser: true,
      type: 'typebot',
      parameters: {
        plan: 'pro',
        remoteJid: '5215512345678@s.whatsapp.net',
        instanceName: 'main',
        serverUrl: 'https://evo.test',
        apiKey: 'GLOBAL-KEY',
        ownerJid: '5215500000000',
      },
      botId: 'tb1',
    };
    const ctx = createMockExecuteFunctions({
      params: base('getSessions', { botType: 'typebot', botId: 'tb1' }),
    });
    ctx.http.reply('GET', '/typebot/fetchSessions/tb1/main', [session]);

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls[0].path).toBe('/typebot/fetchSessions/tb1/main');
    const { apiKey, ...parameters } = session.parameters;
    expect(apiKey).toBe('GLOBAL-KEY');
    expect(output).toHaveLength(1);
    expect(output[0].json).toEqual({ ...session, parameters });
    expect(JSON.stringify(output)).not.toContain('GLOBAL-KEY');

    const withSecrets = createMockExecuteFunctions({
      params: base('getSessions', {
        botType: 'typebot',
        botId: 'tb1',
        options: { includeSecrets: true },
      }),
    });
    withSecrets.http.reply('GET', '/typebot/fetchSessions/tb1/main', [session]);
    const [kept] = await new EvolutionApi().execute.call(withSecrets);
    expect(kept[0].json).toEqual(session);
  });
});

describe('chatbot > ignoreJid', () => {
  it('POST /:botType/ignoreJid/:instance { remoteJid, action }', async () => {
    const ctx = createMockExecuteFunctions({
      params: base('ignoreJid', {
        botType: 'evolutionBot',
        remoteJid: '@g.us',
        ignoreJidAction: 'remove',
      }),
    });
    ctx.http.reply('POST', '/evolutionBot/ignoreJid/main', { ignoreJids: [] });

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls[0].body).toEqual({ remoteJid: '@g.us', action: 'remove' });
    expect(output[0].json).toEqual({ ignoreJids: [] });
  });

  it('explains the HTTP 500 when the default settings were never saved', async () => {
    const ctx = createMockExecuteFunctions({
      params: base('ignoreJid', { remoteJid: '5215512345678@s.whatsapp.net' }),
    });
    ctx.http.reply(
      'POST',
      '/n8n/ignoreJid/main',
      {
        status: 500,
        error: 'Internal Server Error',
        response: { message: ['Error setting default settings'] },
      },
      500,
    );
    await expect(new EvolutionApi().execute.call(ctx)).rejects.toMatchObject({
      description: expect.stringContaining('save them first with Set Settings'),
    });
  });
});

describe('chatbot > start (Typebot)', () => {
  it('POST /typebot/start/:instance with variables', async () => {
    const ctx = createMockExecuteFunctions({
      params: base('start', {
        remoteJid: '5215512345678',
        typebotUrl: 'https://typebot.test',
        typebotPublicId: 'lead-flow',
        typebotStartSession: true,
        typebotVariables: {
          variable: [
            { name: 'name', value: 'Ana' },
            { name: '', value: 'ignored' },
          ],
        },
      }),
    });
    ctx.http.reply('POST', '/typebot/start/main', {
      typebot: { instanceName: 'main', typebot: { remoteJid: '5215512345678@s.whatsapp.net' } },
    });

    const [output] = await new EvolutionApi().execute.call(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/typebot/start/main');
    expect(call.body).toEqual({
      remoteJid: '5215512345678@s.whatsapp.net',
      url: 'https://typebot.test',
      typebot: 'lead-flow',
      startSession: true,
      variables: [{ name: 'name', value: 'Ana' }],
    });
    expect((output[0].json.typebot as IDataObject).instanceName).toBe('main');
  });

  it('turns the empty body of a failed Typebot call into an error', async () => {
    const ctx = createMockExecuteFunctions({
      params: base('start', {
        remoteJid: '5215512345678@s.whatsapp.net',
        typebotUrl: 'https://typebot.test',
        typebotPublicId: 'x',
      }),
    });
    ctx.http.reply('POST', '/typebot/start/main', '');
    await expect(new EvolutionApi().execute.call(ctx)).rejects.toThrow(
      'Evolution API could not start the Typebot flow',
    );
  });
});

describe('chatbot > OpenAI credentials and models', () => {
  it('createCredential: POST /openai/creds/:instance { name, apiKey } (key removed from output)', async () => {
    const ctx = createMockExecuteFunctions({
      params: base('createCredential', { openaiCredentialName: 'main', openaiApiKey: 'sk-1' }),
    });
    ctx.http.reply('POST', '/openai/creds/main', { id: 'c1', name: 'main', apiKey: 'sk-1' }, 201);

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls[0].method).toBe('POST');
    expect(ctx.http.calls[0].path).toBe('/openai/creds/main');
    expect(ctx.http.calls[0].body).toEqual({ name: 'main', apiKey: 'sk-1' });
    expect(output[0].json).toEqual({ id: 'c1', name: 'main' });
  });

  it('getCredentials: GET /openai/creds/:instance, one item per credential', async () => {
    const ctx = createMockExecuteFunctions({ params: base('getCredentials') });
    ctx.http.reply('GET', '/openai/creds/main', [
      { id: 'c1', name: 'a', apiKey: 'sk-1', OpenaiAssistant: [{ id: 'b1' }] },
      { id: 'c2', name: 'b', apiKey: 'sk-2', OpenaiAssistant: [] },
    ]);

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls[0].method).toBe('GET');
    expect(output.map((item) => item.json)).toEqual([
      { id: 'c1', name: 'a', OpenaiAssistant: [{ id: 'b1' }] },
      { id: 'c2', name: 'b', OpenaiAssistant: [] },
    ]);
  });

  it('deleteCredential: DELETE /openai/creds/:credsId/:instance', async () => {
    const ctx = createMockExecuteFunctions({
      params: base('deleteCredential', { openaiCredsId: 'c1' }),
    });
    ctx.http.reply('DELETE', '/openai/creds/c1/main', { openaiCreds: { id: 'c1' } });

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls[0].method).toBe('DELETE');
    expect(ctx.http.calls[0].path).toBe('/openai/creds/c1/main');
    expect(output[0].json).toEqual({ openaiCreds: { id: 'c1' } });
  });

  it('getModels: GET /openai/getModels/:instance?openaiCredsId= (only that query param)', async () => {
    const ctx = createMockExecuteFunctions({
      params: base('getModels'),
      items: [{ json: {} }, { json: {} }],
      itemParams: [{ options: { openaiCredsId: 'c1' } }, {}],
    });
    ctx.http.reply('GET', '/openai/getModels/main', [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }]);
    ctx.http.reply('GET', '/openai/getModels/main', [{ id: 'gpt-4o' }]);

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls.map((call) => call.qs)).toEqual([{ openaiCredsId: 'c1' }, undefined]);
    expect(output.map((item) => [item.json.id, item.pairedItem])).toEqual([
      ['gpt-4o', { item: 0 }],
      ['gpt-4o-mini', { item: 0 }],
      ['gpt-4o', { item: 1 }],
    ]);
  });
});

describe('chatbot > every bot type reaches its routes (EVONODE-2)', () => {
  const BOT_TYPES = ['dify', 'evoai', 'evolutionBot', 'flowise', 'n8n', 'openai', 'typebot'];
  const SETTINGS = { openaiCredsId: 'cred1', fallbackId: null };

  it.each(BOT_TYPES)('%s', async (botType) => {
    const operations: Array<[string, IDataObject, string, string, unknown]> = [
      ['getMany', {}, 'GET', `/${botType}/find/main`, []],
      ['get', { botId: 'b1' }, 'GET', `/${botType}/fetch/b1/main`, { id: 'b1' }],
      ['delete', { botId: 'b1' }, 'DELETE', `/${botType}/delete/b1/main`, { bot: { id: 'b1' } }],
      ['getSettings', {}, 'GET', `/${botType}/fetchSettings/main`, SETTINGS],
      ['getSessions', { botId: 'b1' }, 'GET', `/${botType}/fetchSessions/b1/main`, []],
      [
        'changeStatus',
        { remoteJid: '1@s.whatsapp.net', sessionStatus: 'delete' },
        'POST',
        `/${botType}/changeStatus/main`,
        { bot: {} },
      ],
      [
        'ignoreJid',
        { remoteJid: '@g.us', ignoreJidAction: 'add' },
        'POST',
        `/${botType}/ignoreJid/main`,
        { ignoreJids: ['@g.us'] },
      ],
    ];
    for (const [operation, params, method, path, response] of operations) {
      const ctx = createMockExecuteFunctions({ params: base(operation, { botType, ...params }) });
      ctx.http.reply(method, path, response);
      await new EvolutionApi().execute.call(ctx);
      expect(`${operation}: ${ctx.http.calls[0].method} ${ctx.http.calls[0].path}`).toBe(
        `${operation}: ${method} ${path}`,
      );
    }

    const settings = createMockExecuteFunctions({
      params: base('setSettings', { botType, updateFields: { expire: 5 } }),
    });
    settings.http.reply('GET', `/${botType}/fetchSettings/main`, SETTINGS);
    settings.http.reply('POST', `/${botType}/settings/main`, { id: 's' });
    await new EvolutionApi().execute.call(settings);
    expect(settings.http.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      `GET /${botType}/fetchSettings/main`,
      `POST /${botType}/settings/main`,
    ]);
    expect(bodyOf(settings.http.calls[1]).expire).toBe(5);

    const update = createMockExecuteFunctions({
      params: base('update', { botType, botId: 'b1', updateFields: { description: 'x' } }),
    });
    update.http.reply('GET', `/${botType}/fetch/b1/main`, {
      id: 'b1',
      enabled: true,
      triggerType: 'all',
      url: 'https://typebot.test',
      typebot: 't',
      openaiCredsId: 'cred1',
      botType: botType === 'dify' ? 'chatBot' : 'chatCompletion',
      model: 'gpt-4o-mini',
      maxTokens: 100,
      apiUrl: 'https://bot.test',
      agentUrl: 'https://evoai.test',
      webhookUrl: 'https://n8n.test/w',
    });
    update.http.reply('PUT', `/${botType}/update/b1/main`, { id: 'b1' });
    await new EvolutionApi().execute.call(update);
    expect(`${update.http.calls[1].method} ${update.http.calls[1].path}`).toBe(
      `PUT /${botType}/update/b1/main`,
    );
    expect(bodyOf(update.http.calls[1]).description).toBe('x');
  });
});

describe('chatbot methods', () => {
  it('chatbotSearchBots lists the bots of the selected type and filters them', async () => {
    const ctx = createMockLoadOptionsFunctions({
      params: {
        resource: 'chatbot',
        operation: 'get',
        botType: 'n8n',
        instanceName: rl('main', 'list'),
      },
    });
    ctx.http.reply('GET', '/n8n/find/main', [
      N8N_BOT,
      { id: 'bot2', description: null, triggerType: 'all', enabled: false },
    ]);

    const result = await methods.listSearch!.chatbotSearchBots.call(ctx, 'sales');

    expect(ctx.http.calls[0].path).toBe('/n8n/find/main');
    expect(result).toEqual({ results: [{ name: 'Sales (keyword: hi)', value: 'bot1' }] });
  });

  it('chatbotGetBots adds "None" for removing the fallback', async () => {
    const ctx = createMockLoadOptionsFunctions({
      params: {
        resource: 'chatbot',
        operation: 'setSettings',
        botType: 'typebot',
        instanceName: 'main',
      },
    });
    ctx.http.reply('GET', '/typebot/find/main', [
      { id: 't1', description: 'Leads', triggerType: 'all', enabled: false },
    ]);

    const options = await methods.loadOptions!.chatbotGetBots.call(ctx);

    expect(options).toEqual([
      { name: 'None', value: '', description: 'No fallback bot' },
      { name: 'Leads (all, disabled)', value: 't1' },
    ]);
  });

  it('chatbotGetOpenaiCredentials never exposes the keys', async () => {
    const ctx = createMockLoadOptionsFunctions({
      params: { resource: 'chatbot', operation: 'create', instanceName: 'main' },
    });
    ctx.http.reply('GET', '/openai/creds/main', [
      { id: 'c2', name: 'zeta', apiKey: 'sk-2' },
      { id: 'c1', name: 'alpha', apiKey: 'sk-1' },
    ]);

    const options = await methods.loadOptions!.chatbotGetOpenaiCredentials.call(ctx);

    expect(options).toEqual([
      { name: 'alpha', value: 'c1' },
      { name: 'zeta', value: 'c2' },
    ]);
  });
});

describe('chatbot helpers', () => {
  it('redacts secrets at any depth without touching other values', () => {
    expect(
      redactBotSecrets([
        { apiKey: 'x', nested: { basicAuthPass: 'y', keep: 1 }, list: [{ apiKey: 'z' }] },
      ]),
    ).toEqual([{ nested: { keep: 1 }, list: [{}] }]);
  });

  it('parses seed messages from text or a JSON array', () => {
    expect(parseMessageList('Be brief', 'systemMessages')).toEqual(['Be brief']);
    expect(parseMessageList('["a", "b"]', 'systemMessages')).toEqual(['a', 'b']);
    expect(parseMessageList(['a', 1], 'systemMessages')).toEqual(['a', '1']);
    expect(() => parseMessageList('[oops', 'systemMessages')).toThrow('Invalid JSON');
  });

  it('rejects a non-numeric integer field', () => {
    expect(() => collectBotFields({ expire: 'soon' }, 'n8n')).toThrow('expire must be a number');
  });
});
