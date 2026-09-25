import { EvolutionApi } from '../../nodes/EvolutionApi/EvolutionApi.node';
import { resetRetryPolicy, setRetryPolicy } from '../../nodes/EvolutionApi/GenericFunctions';
import { createMockExecuteFunctions, rl } from '../helpers/mockExecuteFunctions';

// Tests of the template resource (Cloud API templates + WhatsApp Business catalog).

beforeEach(() => setRetryPolicy({ sleep: async () => undefined }));
afterEach(() => resetRetryPolicy());

/** Envelope of every /template/* and /business/* error (src/utils/errorResponse.ts). */
const META_ERROR = {
  status: 400,
  error: 'Bad Request',
  message: 'Invalid parameter',
  details: {
    whatsapp_error: 'Template name already exists in this language',
    whatsapp_code: 100,
    error_user_title: 'Invalid parameter',
    error_user_msg: 'Template name already exists in this language',
    error_type: 'OAuthException',
    error_subcode: 2388024,
    fbtrace_id: 'Axyz',
    context: 'template_creation',
    type: 'whatsapp_api_error',
  },
  timestamp: '2026-09-25T10:00:00.000Z',
};

const TEMPLATES = [
  { id: '1', name: 'hello_world', language: 'en_US', status: 'APPROVED', category: 'UTILITY' },
  { id: '2', name: 'order_update', language: 'es_MX', status: 'PENDING', category: 'UTILITY' },
  { id: '3', name: 'promo_hello', language: 'en_US', status: 'APPROVED', category: 'MARKETING' },
];

describe('template > getMany', () => {
  it('GET /template/find/:instance', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        ...{ resource: 'template', operation: 'getMany' },
        instanceName: rl('main', 'list'),
      },
    });
    ctx.http.reply('GET', '/template/find/main', [{ name: 'hello_world', language: 'en_US' }]);

    const [output] = await new EvolutionApi().execute.call(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/template/find/main');
    expect(call.qs).toBeUndefined();
    expect(call.body).toBeUndefined();
    expect(output.map((item) => item.json)).toEqual([{ name: 'hello_world', language: 'en_US' }]);
    expect(output.every((item) => item.pairedItem !== undefined)).toBe(true);
  });

  it('filters client side and applies the limit', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'template',
        operation: 'getMany',
        instanceName: 'main',
        filters: { name: 'HELLO', status: 'APPROVED' },
        limit: 1,
      },
    });
    ctx.http.reply('GET', '/template/find/main', TEMPLATES);

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(output.map((item) => item.json.id)).toEqual(['1']);
  });

  it('returns all matching templates with Return All', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'template',
        operation: 'getMany',
        instanceName: 'main',
        returnAll: true,
        filters: { language: 'en_us' },
      },
    });
    ctx.http.reply('GET', '/template/find/main', TEMPLATES);
    const [output] = await new EvolutionApi().execute.call(ctx);
    expect(output.map((item) => item.json.id)).toEqual(['1', '3']);
  });

  it('turns the empty body of a failed Meta call into an error', async () => {
    const ctx = createMockExecuteFunctions({
      params: { resource: 'template', operation: 'getMany', instanceName: 'main' },
    });
    ctx.http.reply('GET', '/template/find/main', '');
    await expect(new EvolutionApi().execute.call(ctx)).rejects.toThrow(
      'Meta did not return the message templates',
    );
  });

  it('returns no items for an empty template list', async () => {
    const ctx = createMockExecuteFunctions({
      params: { resource: 'template', operation: 'getMany', instanceName: 'main' },
    });
    ctx.http.reply('GET', '/template/find/main', []);
    const [output] = await new EvolutionApi().execute.call(ctx);
    expect(output).toEqual([]);
  });
});

describe('template > create', () => {
  it('POST /template/create/:instance { name, category, language, components, … }', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'template',
        operation: 'create',
        instanceName: 'main',
        templateName: ' order_update ',
        templateCategory: 'UTILITY',
        templateLanguage: 'es_MX',
        templateComponents: '[{"type": "BODY", "text": "Hola {{1}}"}]',
        additionalFields: {
          allowCategoryChange: true,
          webhookUrl: 'https://n8n.test/template-status',
        },
      },
    });
    ctx.http.reply(
      'POST',
      '/template/create/main',
      { id: 'row1', templateId: '99', name: 'order_update', template: { status: 'PENDING' } },
      201,
    );

    const [output] = await new EvolutionApi().execute.call(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/template/create/main');
    expect(call.body).toEqual({
      name: 'order_update',
      category: 'UTILITY',
      language: 'es_MX',
      components: [{ type: 'BODY', text: 'Hola {{1}}' }],
      allowCategoryChange: true,
      webhookUrl: 'https://n8n.test/template-status',
    });
    expect(output[0].json.templateId).toBe('99');
  });

  it('accepts components given as an array (expression) and rejects a non-array', async () => {
    const ok = createMockExecuteFunctions({
      params: {
        resource: 'template',
        operation: 'create',
        instanceName: 'main',
        templateName: 'x',
        templateComponents: [{ type: 'BODY', text: 'Hi' }],
      },
    });
    ok.http.reply('POST', '/template/create/main', { id: 'r' }, 201);
    await new EvolutionApi().execute.call(ok);
    expect((ok.http.calls[0].body as Record<string, unknown>).components).toEqual([
      { type: 'BODY', text: 'Hi' },
    ]);

    const bad = createMockExecuteFunctions({
      params: {
        resource: 'template',
        operation: 'create',
        instanceName: 'main',
        templateName: 'x',
        templateComponents: '{"type": "BODY"}',
      },
    });
    await expect(new EvolutionApi().execute.call(bad)).rejects.toThrow(
      'Components must be a JSON array',
    );
    expect(bad.http.calls).toEqual([]);
  });

  it('shows the Meta error of the 400 envelope', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'template',
        operation: 'create',
        instanceName: 'main',
        templateName: 'hello_world',
      },
    });
    ctx.http.reply('POST', '/template/create/main', META_ERROR, 400);
    await expect(new EvolutionApi().execute.call(ctx)).rejects.toMatchObject({
      httpCode: '400',
      message: 'Bad request: Invalid parameter; Template name already exists in this language',
    });
  });
});

describe('template > update', () => {
  it('POST /template/edit/:instance with only the added fields', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'template',
        operation: 'update',
        instanceName: 'main',
        templateId: '1234',
        updateFields: {
          category: 'MARKETING',
          ttl: 3600,
          components: '[{"type": "BODY", "text": "New"}]',
        },
      },
    });
    ctx.http.reply('POST', '/template/edit/main', { success: true });

    const [output] = await new EvolutionApi().execute.call(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/template/edit/main');
    expect(call.body).toEqual({
      templateId: '1234',
      category: 'MARKETING',
      ttl: 3600,
      components: [{ type: 'BODY', text: 'New' }],
    });
    expect(output[0].json).toEqual({ success: true });
  });

  it('requires at least one field to update', async () => {
    const ctx = createMockExecuteFunctions({
      params: { resource: 'template', operation: 'update', instanceName: 'main', templateId: '1' },
    });
    await expect(new EvolutionApi().execute.call(ctx)).rejects.toThrow(
      'Add at least one field to update',
    );
    expect(ctx.http.calls).toEqual([]);
  });

  // Regression: Evolution forwards any array (even []) and Meta rejects empty components.
  it('does not send the default empty Components array', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'template',
        operation: 'update',
        instanceName: 'main',
        templateId: '1234',
        updateFields: { components: '[]', allowCategoryChange: true },
      },
    });
    ctx.http.reply('POST', '/template/edit/main', { success: true });
    await new EvolutionApi().execute.call(ctx);
    expect(ctx.http.calls[0].body).toEqual({ templateId: '1234', allowCategoryChange: true });

    const onlyEmpty = createMockExecuteFunctions({
      params: {
        resource: 'template',
        operation: 'update',
        instanceName: 'main',
        templateId: '1234',
        updateFields: { components: '[]' },
      },
    });
    await expect(new EvolutionApi().execute.call(onlyEmpty)).rejects.toThrow(
      'Add at least one field to update',
    );
    expect(onlyEmpty.http.calls).toEqual([]);
  });
});

describe('template > delete', () => {
  it('DELETE /template/delete/:instance with a JSON body { name, hsmId }', async () => {
    const ctx = createMockExecuteFunctions({
      params: { resource: 'template', operation: 'delete', instanceName: 'main' },
      items: [{ json: {} }, { json: {} }],
      itemParams: [
        { templateName: 'order_update' },
        { templateName: 'promo', additionalFields: { hsmId: '777' } },
      ],
    });
    ctx.http.reply('DELETE', '/template/delete/main', { success: true });
    ctx.http.reply('DELETE', '/template/delete/main', { success: true });

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls.map((call) => call.method)).toEqual(['DELETE', 'DELETE']);
    expect(ctx.http.calls.map((call) => call.body)).toEqual([
      { name: 'order_update' },
      { name: 'promo', hsmId: '777' },
    ]);
    expect(ctx.http.calls[0].headers['Content-Type']).toBe('application/json');
    expect(output.map((item) => item.pairedItem)).toEqual([{ item: 0 }, { item: 1 }]);
  });
});

describe('template > getCatalog', () => {
  it('POST /business/getCatalog/:instance { number, limit }', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'template',
        operation: 'getCatalog',
        instanceName: 'main',
        number: '+52 1 55 1234 5678',
        options: { pageSize: 20 },
      },
    });
    const catalog = {
      wuid: '525512345678@s.whatsapp.net',
      numberExists: true,
      isBusiness: true,
      catalogLength: 1,
      catalog: [{ id: 'p1', name: 'Shirt' }],
    };
    ctx.http.reply('POST', '/business/getCatalog/main', catalog);

    const [output] = await new EvolutionApi().execute.call(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/business/getCatalog/main');
    expect(call.body).toEqual({ number: '5215512345678', limit: 20 });
    expect(output[0].json).toEqual(catalog);
  });

  it('reads the own catalog without a body and retries a 503 (read route)', async () => {
    const ctx = createMockExecuteFunctions({
      params: { resource: 'template', operation: 'getCatalog', instanceName: 'main' },
    });
    ctx.http.queue(
      'POST',
      '/business/getCatalog/main',
      { statusCode: 503, body: 'Service Unavailable' },
      { statusCode: 200, body: { wuid: 'me', name: null, isBusiness: false } },
    );

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls).toHaveLength(2);
    expect(ctx.http.calls[1].body).toBeUndefined();
    expect(output[0].json).toEqual({ wuid: 'me', name: null, isBusiness: false });
  });

  it('shows "not on WhatsApp" from the 400 envelope', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'template',
        operation: 'getCatalog',
        instanceName: 'main',
        number: '5511999999999',
      },
    });
    ctx.http.reply(
      'POST',
      '/business/getCatalog/main',
      {
        status: 400,
        error: 'Bad Request',
        message: [{ jid: '5511999999999@s.whatsapp.net', exists: false, number: '5511999999999' }],
        details: {},
      },
      400,
    );
    await expect(new EvolutionApi().execute.call(ctx)).rejects.toMatchObject({
      message: expect.stringContaining('is not on WhatsApp'),
    });
  });
});

describe('template > getCollections', () => {
  it('POST /business/getCollections/:instance { number, limit ≤ 20 }', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'template',
        operation: 'getCollections',
        instanceName: 'main',
        number: '5215512345678@s.whatsapp.net',
        options: { maxCollections: 50 },
      },
    });
    ctx.http.reply('POST', '/business/getCollections/main', {
      wuid: '5215512345678@s.whatsapp.net',
      collectionsLength: 0,
      collections: [],
    });

    const [output] = await new EvolutionApi().execute.call(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/business/getCollections/main');
    expect(call.body).toEqual({ number: '5215512345678@s.whatsapp.net', limit: 20 });
    expect(output[0].json.collectionsLength).toBe(0);
  });
});
