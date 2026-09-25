import type { IDataObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import {
  assertNoSoftError,
  buildEvolutionApiError,
  buildMediaRequestBody,
  buildMultipartBody,
  base64ToBinary,
  cleanBase64,
  compactObject,
  computeRetryDelay,
  CREDENTIAL_TYPE,
  encodePathSegment,
  evolutionApiRawRequest,
  evolutionApiRequest,
  extractEvolutionMessages,
  extractHttpErrorDetails,
  isGroupJid,
  isLicenseRequiredError,
  isLidJid,
  isMultipartSafe,
  normalizeBaseUrl,
  normalizeNumber,
  normalizeNumberList,
  parseDataUri,
  parseJsonParameter,
  parseRetryAfter,
  resetRetryPolicy,
  resolveInstanceName,
  resolveInstanceNameFromValue,
  resolveMedia,
  searchInstances,
  setRetryPolicy,
  shouldRetry,
  toArray,
  toJid,
} from '../nodes/EvolutionApi/GenericFunctions';
import {
  binaryItem,
  createMockExecuteFunctions,
  createMockLoadOptionsFunctions,
  createN8nHttpError,
  createNetworkError,
  rl,
  TEST_API_KEY,
  TEST_BASE_URL,
  TEST_NODE,
} from './helpers/mockExecuteFunctions';

const LICENSE_BODY = {
  error: 'service not activated',
  code: 'LICENSE_REQUIRED',
  register_url: 'https://evo.test/manager/login',
  instance_id: 'abc-123',
  docs_url: 'https://docs.evolutionfoundation.com.br/licensing',
  message: 'This Evolution API instance is not activated.',
};

let sleeps: number[];

beforeEach(() => {
  sleeps = [];
  setRetryPolicy({
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
  });
});

afterEach(() => {
  resetRetryPolicy();
});

describe('normalizeBaseUrl', () => {
  it('trims whitespace and trailing slashes', () => {
    expect(normalizeBaseUrl('  https://evo.test///  ')).toBe('https://evo.test');
    expect(normalizeBaseUrl('http://localhost:8080/')).toBe('http://localhost:8080');
  });

  it('rejects URLs without http(s)', () => {
    expect(() => normalizeBaseUrl('evo.test')).toThrow('Base URL must start with http://');
    expect(() => normalizeBaseUrl('')).toThrow('Base URL must start with http://');
  });
});

describe('numbers and JIDs', () => {
  it.each([
    ['123456789@lid', '123456789@lid'],
    ['120363041234567890@g.us', '120363041234567890@g.us'],
    ['5215512345678@s.whatsapp.net', '5215512345678@s.whatsapp.net'],
    ['status@broadcast', 'status@broadcast'],
    ['120363400000000000@newsletter', '120363400000000000@newsletter'],
    ['  987654321@lid  ', '987654321@lid'],
  ])('preserves the JID %s', (input, expected) => {
    expect(normalizeNumber(input)).toBe(expected);
    expect(toJid(input)).toBe(expected);
  });

  it('reduces formatted phone numbers to digits', () => {
    expect(normalizeNumber('+52 1 (55) 1234-5678')).toBe('5215512345678');
    expect(normalizeNumber('55.11.99999.9999')).toBe('5511999999999');
    expect(normalizeNumber(5511999999999)).toBe('5511999999999');
  });

  it('keeps legacy group ids and unknown formats', () => {
    expect(normalizeNumber('5511999999999-1600000000')).toBe('5511999999999-1600000000');
    expect(normalizeNumber('abc')).toBe('abc');
    expect(normalizeNumber('')).toBe('');
    expect(normalizeNumber(undefined)).toBe('');
  });

  it('builds JIDs for plain numbers and group ids', () => {
    expect(toJid('+52 1 55 1234 5678')).toBe('5215512345678@s.whatsapp.net');
    expect(toJid('120363041234567890')).toBe('120363041234567890@g.us');
    expect(toJid('5511999999999-1600000000')).toBe('5511999999999-1600000000@g.us');
    expect(toJid('')).toBe('');
  });

  it('splits, normalizes and dedupes number lists', () => {
    expect(normalizeNumberList('+52 1 55 1234 5678, 5215512345678\n123@lid;;')).toEqual([
      '5215512345678',
      '123@lid',
    ]);
    expect(normalizeNumberList(['1@g.us', ' 1@g.us '])).toEqual(['1@g.us']);
  });

  it('detects group and LID JIDs', () => {
    expect(isGroupJid('1203@g.us')).toBe(true);
    expect(isGroupJid('1203@s.whatsapp.net')).toBe(false);
    expect(isLidJid('99@LID')).toBe(true);
    expect(isLidJid('99@g.us')).toBe(false);
  });
});

describe('small utilities', () => {
  it('compactObject drops empty values recursively', () => {
    expect(
      compactObject({ a: 1, b: '', c: null, d: undefined, e: false, f: { g: '', h: 0 } }),
    ).toEqual({ a: 1, e: false, f: { h: 0 } });
  });

  it('toArray wraps values', () => {
    expect(toArray(null)).toEqual([]);
    expect(toArray({ a: 1 })).toEqual([{ a: 1 }]);
    expect(toArray([{ a: 1 }, 'x'])).toEqual([{ a: 1 }, { value: 'x' }]);
  });

  it('parseJsonParameter parses strings and passes objects through', () => {
    expect(parseJsonParameter('{"a":1}', 'X')).toEqual({ a: 1 });
    expect(parseJsonParameter({ a: 1 }, 'X')).toEqual({ a: 1 });
    expect(parseJsonParameter('  ', 'X')).toBeUndefined();
    expect(() => parseJsonParameter('{nope', 'Headers')).toThrow('Invalid JSON in "Headers"');
  });
});

describe('extractEvolutionMessages', () => {
  it('reads the global error handler shape', () => {
    expect(
      extractEvolutionMessages({
        status: 400,
        error: 'Bad Request',
        response: {
          message: ['instance requires property "number"', 'Owned media must be a url or base64'],
        },
      }),
    ).toEqual(['instance requires property "number"', 'Owned media must be a url or base64']);
  });

  it('reads nested message arrays and {property, message} entries', () => {
    expect(
      extractEvolutionMessages({
        status: 400,
        error: 'Bad Request',
        response: {
          message: [[{ property: 'groupJid', message: 'The "groupJid" cannot be empty' }]],
        },
      }),
    ).toEqual(['groupJid: The "groupJid" cannot be empty']);
  });

  it('reads raw exceptions returned without the response wrapper', () => {
    expect(
      extractEvolutionMessages({ status: 400, error: 'Bad Request', message: ['Invalid number'] }),
    ).toEqual(['Invalid number']);
  });

  it('explains numbers that are not on WhatsApp (send routes, fetchProfile)', () => {
    const messages = extractEvolutionMessages({
      status: 400,
      error: 'Bad Request',
      response: { message: [{ exists: false, jid: '123@s.whatsapp.net', number: '123' }] },
    });
    expect(messages).toEqual(['The number 123 (123@s.whatsapp.net) is not on WhatsApp']);
    expect(
      extractEvolutionMessages({
        response: { message: [{ exists: false, jid: '99@lid', number: '99@lid' }] },
      }),
    ).toEqual(['The number 99@lid is not on WhatsApp']);
  });

  it('serializes other unknown objects inside messages', () => {
    const messages = extractEvolutionMessages({
      status: 400,
      error: 'Bad Request',
      response: { message: [{ exists: true, jid: '123@s.whatsapp.net', reason: 'x' }] },
    });
    expect(messages[0]).toContain('"reason":"x"');
  });

  it('reads Meta template errors', () => {
    expect(
      extractEvolutionMessages({
        status: 400,
        error: 'Bad Request',
        message: 'Invalid parameter',
        details: { whatsapp_error: 'Template name already exists', whatsapp_code: 100 },
      }),
    ).toEqual(['Invalid parameter', 'Template name already exists']);
  });

  it('falls back to the error title and ignores "[object Object]"', () => {
    expect(extractEvolutionMessages({ status: 500, error: 'Internal Server Error' })).toEqual([
      'Internal Server Error',
    ]);
    expect(extractEvolutionMessages({ error: true, message: '[object Object]' })).toEqual([]);
    expect(extractEvolutionMessages('Bad Gateway')).toEqual(['Bad Gateway']);
    expect(extractEvolutionMessages(undefined)).toEqual([]);
  });
});

describe('buildEvolutionApiError', () => {
  it('maps 400 with the API messages', () => {
    const error = buildEvolutionApiError(TEST_NODE, {
      statusCode: 400,
      body: { status: 400, error: 'Bad Request', response: { message: ['Text is required'] } },
      method: 'POST',
      endpoint: '/message/sendText/x',
      itemIndex: 2,
    });
    expect(error).toBeInstanceOf(NodeApiError);
    expect(error.message).toBe('Bad request: Text is required');
    expect(error.description).toContain('(POST /message/sendText/x)');
    expect(error.httpCode).toBe('400');
    expect(error.context.itemIndex).toBe(2);
  });

  it('maps 401 to a credential hint', () => {
    const error = buildEvolutionApiError(TEST_NODE, {
      statusCode: 401,
      body: { status: 401, error: 'Unauthorized', response: { message: 'Unauthorized' } },
    });
    expect(error.message).toBe('Unauthorized: Unauthorized');
    expect(error.description).toContain('AUTHENTICATION_API_KEY');
    expect(error.httpCode).toBe('401');
  });

  it('maps 403 and 404 with their hints', () => {
    const forbidden = buildEvolutionApiError(TEST_NODE, {
      statusCode: 403,
      body: {
        status: 403,
        error: 'Forbidden',
        response: { message: ['This name "a" is already in use.'] },
      },
    });
    expect(forbidden.message).toBe('Forbidden: This name "a" is already in use.');

    const notFound = buildEvolutionApiError(TEST_NODE, {
      statusCode: 404,
      body: {
        status: 404,
        error: 'Not Found',
        response: { message: ['Cannot POST /message/sendCarousel/a'] },
      },
    });
    expect(notFound.message).toBe('Not found: Cannot POST /message/sendCarousel/a');
    expect(notFound.description).toContain('2.4');
  });

  it('builds a dedicated LICENSE_REQUIRED error with register_url', () => {
    const error = buildEvolutionApiError(TEST_NODE, {
      statusCode: 503,
      body: LICENSE_BODY,
      method: 'GET',
      endpoint: '/instance/fetchInstances',
      baseUrl: TEST_BASE_URL,
    });
    expect(error.message).toContain('LICENSE_REQUIRED');
    expect(error.message).toContain('https://evo.test/manager/login');
    expect(error.description).toContain('https://evo.test/license/status');
    expect(error.description).toContain('docs.evolutionfoundation.com.br');
    expect(error.httpCode).toBe('503');
  });

  it('falls back to <Base URL>/manager/login when register_url is missing', () => {
    const error = buildEvolutionApiError(TEST_NODE, {
      statusCode: 503,
      body: { code: 'LICENSE_REQUIRED' },
      baseUrl: 'https://x.test',
    });
    expect(error.message).toContain('https://x.test/manager/login');
  });

  it('handles non-JSON bodies and unknown statuses', () => {
    const error = buildEvolutionApiError(TEST_NODE, {
      statusCode: 502,
      body: '<html>Bad Gateway</html>',
    });
    expect(error.message).toBe('Bad gateway: <html>Bad Gateway</html>');
    const teapot = buildEvolutionApiError(TEST_NODE, { statusCode: 418, body: {} });
    expect(teapot.message).toBe('Evolution API request failed (HTTP 418)');
  });

  it('detects the license body only for 503', () => {
    expect(isLicenseRequiredError(503, LICENSE_BODY)).toBe(true);
    expect(isLicenseRequiredError(500, LICENSE_BODY)).toBe(false);
    expect(isLicenseRequiredError(503, { code: 'OTHER' })).toBe(false);
  });
});

describe('assertNoSoftError', () => {
  it('ignores normal responses', () => {
    expect(() =>
      assertNoSoftError(TEST_NODE, { status: 'SUCCESS', error: false }, 0, 'x'),
    ).not.toThrow();
    expect(() => assertNoSoftError(TEST_NODE, [], 0, 'x')).not.toThrow();
  });

  it('throws for { error: true } with the API message or the fallback', () => {
    expect(() =>
      assertNoSoftError(TEST_NODE, { error: true, message: 'Connection Closed' }, 0, 'fallback'),
    ).toThrow('Evolution API reported an error: Connection Closed');
    expect(() =>
      assertNoSoftError(TEST_NODE, { error: true, message: '[object Object]' }, 0, 'fallback'),
    ).toThrow('fallback');
  });
});

describe('extractHttpErrorDetails', () => {
  it('reads NodeApiError(AxiosError) thrown by n8n', () => {
    const details = extractHttpErrorDetails(
      createN8nHttpError(404, { status: 404, error: 'Not Found' }),
    );
    expect(details.statusCode).toBe(404);
    expect(details.body).toEqual({ status: 404, error: 'Not Found' });
  });

  it('reads request-promise style errors', () => {
    expect(extractHttpErrorDetails({ statusCode: 429, error: { message: 'slow down' } })).toEqual({
      statusCode: 429,
      body: { message: 'slow down' },
      headers: undefined,
    });
  });

  it('returns nothing for network errors', () => {
    expect(extractHttpErrorDetails(createNetworkError())).toEqual({});
    expect(extractHttpErrorDetails('boom')).toEqual({});
  });
});

describe('retry helpers', () => {
  it('retries 429 for every method', () => {
    expect(shouldRetry(429, 'POST', {})).toBe(true);
    expect(shouldRetry(429, 'GET', {})).toBe(true);
  });

  it('retries 502/503 only for idempotent requests', () => {
    expect(shouldRetry(503, 'GET', {})).toBe(true);
    expect(shouldRetry(502, 'DELETE', {})).toBe(true);
    expect(shouldRetry(503, 'PUT', {})).toBe(true);
    expect(shouldRetry(503, 'POST', {})).toBe(false);
    expect(shouldRetry(503, 'POST', {}, true)).toBe(true);
    expect(shouldRetry(500, 'GET', {})).toBe(false);
    expect(shouldRetry(400, 'GET', {})).toBe(false);
  });

  it('retries 504 only for GET/HEAD or explicitly idempotent requests', () => {
    // Regression: a 504 means Evolution may have processed the request; repeating
    // DELETE /instance/delete then answered 404 and turned a success into an error.
    expect(shouldRetry(504, 'GET', {})).toBe(true);
    expect(shouldRetry(504, 'HEAD', {})).toBe(true);
    expect(shouldRetry(504, 'DELETE', {})).toBe(false);
    expect(shouldRetry(504, 'PUT', {})).toBe(false);
    expect(shouldRetry(504, 'POST', {})).toBe(false);
    expect(shouldRetry(504, 'POST', {}, true)).toBe(true);
  });

  it('lets GET routes with side effects opt out of 5xx retries (idempotent: false)', () => {
    expect(shouldRetry(502, 'GET', {}, false)).toBe(false);
    expect(shouldRetry(504, 'GET', {}, false)).toBe(false);
    expect(shouldRetry(429, 'GET', {}, false)).toBe(true);
  });

  it('never retries 503 LICENSE_REQUIRED', () => {
    expect(shouldRetry(503, 'GET', LICENSE_BODY)).toBe(false);
  });

  it('parses Retry-After seconds and dates', () => {
    expect(parseRetryAfter('2')).toBe(2000);
    expect(parseRetryAfter(['1.5'])).toBe(1500);
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:05 GMT', now)).toBe(5000);
    expect(parseRetryAfter('soon')).toBeUndefined();
    expect(parseRetryAfter(undefined)).toBeUndefined();
  });

  it('computes exponential backoff capped by maxDelayMs', () => {
    const policy = { baseDelayMs: 1000, maxDelayMs: 5000 };
    expect(computeRetryDelay(0, undefined, policy)).toBe(1000);
    expect(computeRetryDelay(1, undefined, policy)).toBe(2000);
    expect(computeRetryDelay(5, undefined, policy)).toBe(5000);
    expect(computeRetryDelay(0, 3000, policy)).toBe(3000);
    expect(computeRetryDelay(0, 60000, policy)).toBe(5000);
  });
});

describe('evolutionApiRequest', () => {
  it('builds the URL from the credential, sends JSON and the apikey header', async () => {
    const ctx = createMockExecuteFunctions({ credentials: { baseUrl: 'https://evo.test/' } });
    ctx.http.reply('POST', '/message/sendText/inst', { key: { id: 'A' } }, 201);

    const response = await evolutionApiRequest.call(
      ctx,
      'POST',
      '/message/sendText/inst',
      { number: '1', text: 'hi' },
      { empty: '', keep: false },
    );

    expect(response).toEqual({ key: { id: 'A' } });
    const [call] = ctx.http.calls;
    expect(call.url).toBe('https://evo.test/message/sendText/inst');
    expect(call.credentialType).toBe(CREDENTIAL_TYPE);
    expect(call.headers.apikey).toBe(TEST_API_KEY);
    expect(call.headers['Content-Type']).toBe('application/json');
    expect(call.body).toEqual({ number: '1', text: 'hi' });
    expect(call.qs).toEqual({ keep: false });
    expect(call.options.json).toBe(true);
    expect(call.options.ignoreHttpStatusErrors).toBe(true);
    expect(call.options.returnFullResponse).toBe(true);
  });

  it('omits empty bodies and never sends a body with GET', async () => {
    const ctx = createMockExecuteFunctions();
    ctx.http.reply('GET', '/a', {}).reply('DELETE', '/b', {});
    await evolutionApiRequest.call(ctx, 'GET', '/a', { ignored: true });
    await evolutionApiRequest.call(ctx, 'DELETE', '/b');
    expect(ctx.http.calls[0].body).toBeUndefined();
    expect(ctx.http.calls[1].body).toBeUndefined();
    expect(ctx.http.calls[0].qs).toBeUndefined();
  });

  it('normalizes empty and primitive bodies', async () => {
    const ctx = createMockExecuteFunctions();
    ctx.http
      .reply('GET', '/null', null)
      .reply('GET', '/text', 'ok')
      .reply('GET', '/list', [{ a: 1 }]);
    expect(await evolutionApiRequest.call(ctx, 'GET', '/null')).toEqual({});
    expect(await evolutionApiRequest.call(ctx, 'GET', '/text')).toEqual({ result: 'ok' });
    expect(await evolutionApiRequest.call(ctx, 'GET', '/list')).toEqual([{ a: 1 }]);
  });

  it('passes FormData through without a JSON content type', async () => {
    const ctx = createMockExecuteFunctions();
    ctx.http.reply('POST', '/message/sendMedia/i', { ok: true }, 201);
    const form = buildMultipartBody(
      { number: '1' },
      { buffer: Buffer.from('x'), fileName: 'a.txt' },
    );
    await evolutionApiRequest.call(ctx, 'POST', '/message/sendMedia/i', form);
    expect(ctx.http.calls[0].body).toBe(form);
    expect(ctx.http.calls[0].headers['Content-Type']).toBeUndefined();
  });

  it('throws a normalized NodeApiError with the item index', async () => {
    const ctx = createMockExecuteFunctions();
    ctx.http.reply(
      'GET',
      '/instance/connectionState/nope',
      {
        status: 404,
        error: 'Not Found',
        response: { message: ['The "nope" instance does not exist'] },
      },
      404,
    );
    await expect(
      evolutionApiRequest.call(
        ctx,
        'GET',
        '/instance/connectionState/nope',
        {},
        {},
        { itemIndex: 3 },
      ),
    ).rejects.toMatchObject({
      message: 'Not found: The "nope" instance does not exist',
      httpCode: '404',
      context: expect.objectContaining({ itemIndex: 3 }),
    });
  });

  it('reports 503 LICENSE_REQUIRED clearly and does not retry it', async () => {
    const ctx = createMockExecuteFunctions();
    ctx.http.reply('GET', '/instance/fetchInstances', LICENSE_BODY, 503);
    const promise = evolutionApiRequest.call(ctx, 'GET', '/instance/fetchInstances');
    await expect(promise).rejects.toBeInstanceOf(NodeApiError);
    await expect(promise).rejects.toMatchObject({ httpCode: '503' });
    await expect(promise).rejects.toThrow('https://evo.test/manager/login');
    expect(ctx.http.calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('retries 429 on POST honoring Retry-After, then succeeds', async () => {
    const ctx = createMockExecuteFunctions();
    ctx.http
      .reply('POST', '/message/sendText/i', { message: 'slow' }, 429, { 'Retry-After': '2' })
      .reply('POST', '/message/sendText/i', { key: { id: 'B' } }, 201);
    const response = await evolutionApiRequest.call(ctx, 'POST', '/message/sendText/i', {
      text: 'x',
    });
    expect(response).toEqual({ key: { id: 'B' } });
    expect(ctx.http.calls).toHaveLength(2);
    expect(sleeps).toEqual([2000]);
  });

  it('retries 502/503/504 on GET with exponential backoff', async () => {
    const ctx = createMockExecuteFunctions();
    ctx.http
      .reply('GET', '/chat/x', 'Bad Gateway', 502)
      .reply('GET', '/chat/x', {}, 503)
      .reply('GET', '/chat/x', {}, 504)
      .reply('GET', '/chat/x', { ok: true });
    await expect(evolutionApiRequest.call(ctx, 'GET', '/chat/x')).resolves.toEqual({ ok: true });
    expect(sleeps).toEqual([1000, 2000, 4000]);
  });

  it('gives up after maxRetries and throws the last error', async () => {
    const ctx = createMockExecuteFunctions();
    for (let i = 0; i < 4; i++) ctx.http.reply('GET', '/busy', {}, 503);
    await expect(evolutionApiRequest.call(ctx, 'GET', '/busy')).rejects.toMatchObject({
      httpCode: '503',
    });
    expect(ctx.http.calls).toHaveLength(4);
    expect(sleeps).toHaveLength(3);
  });

  it('does not repeat a DELETE after a 504 but does after a 502', async () => {
    const ctx = createMockExecuteFunctions();
    ctx.http.reply('DELETE', '/instance/delete/main', 'Gateway Timeout', 504);
    await expect(
      evolutionApiRequest.call(ctx, 'DELETE', '/instance/delete/main'),
    ).rejects.toMatchObject({ httpCode: '504' });
    expect(ctx.http.calls).toHaveLength(1);
    expect(sleeps).toEqual([]);

    ctx.http
      .reply('DELETE', '/instance/delete/main', 'Bad Gateway', 502)
      .reply('DELETE', '/instance/delete/main', { status: 'SUCCESS' });
    await expect(evolutionApiRequest.call(ctx, 'DELETE', '/instance/delete/main')).resolves.toEqual(
      { status: 'SUCCESS' },
    );
    expect(sleeps).toEqual([1000]);
  });

  it('does not retry 503 on POST unless marked idempotent', async () => {
    const ctx = createMockExecuteFunctions();
    ctx.http.reply('POST', '/send', {}, 503);
    await expect(evolutionApiRequest.call(ctx, 'POST', '/send', { a: 1 })).rejects.toMatchObject({
      httpCode: '503',
    });
    expect(ctx.http.calls).toHaveLength(1);

    ctx.http.reply('POST', '/chat/findChats/i', {}, 503).reply('POST', '/chat/findChats/i', []);
    await expect(
      evolutionApiRequest.call(
        ctx,
        'POST',
        '/chat/findChats/i',
        { where: {} },
        {},
        { idempotent: true },
      ),
    ).resolves.toEqual([]);
  });

  it('respects maxRetries: 0', async () => {
    const ctx = createMockExecuteFunctions();
    ctx.http.reply('GET', '/busy', {}, 429);
    await expect(
      evolutionApiRequest.call(ctx, 'GET', '/busy', {}, {}, { maxRetries: 0 }),
    ).rejects.toMatchObject({ httpCode: '429' });
    expect(sleeps).toEqual([]);
  });

  it('also retries and normalizes errors thrown by the n8n helper', async () => {
    const ctx = createMockExecuteFunctions();
    ctx.http.queueError('GET', '/x', createN8nHttpError(429, { message: 'rate' })).queueError(
      'GET',
      '/x',
      createN8nHttpError(400, {
        status: 400,
        error: 'Bad Request',
        response: { message: ['bad'] },
      }),
    );
    await expect(evolutionApiRequest.call(ctx, 'GET', '/x')).rejects.toMatchObject({
      message: 'Bad request: bad',
      httpCode: '400',
    });
    expect(sleeps).toEqual([1000]);
  });

  it('wraps network errors in NodeApiError', async () => {
    const ctx = createMockExecuteFunctions();
    ctx.http.queueError('GET', '/x', createNetworkError('ECONNREFUSED'));
    const promise = evolutionApiRequest.call(ctx, 'GET', '/x', {}, {}, { itemIndex: 1 });
    await expect(promise).rejects.toBeInstanceOf(NodeApiError);
    await expect(promise).rejects.toMatchObject({
      context: expect.objectContaining({ itemIndex: 1 }),
    });
  });

  it('rejects an invalid Base URL before sending anything', async () => {
    const ctx = createMockExecuteFunctions({ credentials: { baseUrl: 'evo.test' } });
    await expect(evolutionApiRequest.call(ctx, 'GET', '/x')).rejects.toBeInstanceOf(
      NodeOperationError,
    );
    expect(ctx.http.calls).toHaveLength(0);
  });

  it('exposes status and headers through evolutionApiRawRequest', async () => {
    const ctx = createMockExecuteFunctions();
    ctx.http.reply('POST', '/x', { a: 1 }, 201, { 'x-test': '1' });
    await expect(evolutionApiRawRequest.call(ctx, 'POST', '/x', { b: 1 })).resolves.toEqual({
      statusCode: 201,
      headers: { 'x-test': '1' },
      body: { a: 1 },
    });
  });
});

describe('resolveInstanceName', () => {
  it('uses the node parameter (string or resourceLocator) and URL-encodes it', async () => {
    const ctx = createMockExecuteFunctions({
      itemParams: [{ instanceName: 'plain name' }, { instanceName: rl('ventas/mx', 'list') }],
    });
    await expect(resolveInstanceName.call(ctx, 0)).resolves.toBe('plain%20name');
    await expect(resolveInstanceName.call(ctx, 1)).resolves.toBe('ventas%2Fmx');
    await expect(resolveInstanceName.call(ctx, 1, { encode: false })).resolves.toBe('ventas/mx');
  });

  it('falls back to the credential default instance', async () => {
    const ctx = createMockExecuteFunctions({
      params: { instanceName: rl('', 'list') },
      credentials: { defaultInstance: ' main ' },
    });
    await expect(resolveInstanceName.call(ctx, 0)).resolves.toBe('main');
  });

  it('throws a clear error when nothing is set', async () => {
    const ctx = createMockExecuteFunctions();
    await expect(resolveInstanceName.call(ctx, 0)).rejects.toThrow('No instance selected');
  });

  it.each(['.', '..', ' .. '])('rejects %j, which URL normalization would drop', async (name) => {
    const ctx = createMockExecuteFunctions({ params: { instanceName: rl(name) } });
    const promise = resolveInstanceName.call(ctx, 0);
    await expect(promise).rejects.toBeInstanceOf(NodeOperationError);
    await expect(promise).rejects.toMatchObject({ context: { itemIndex: 0 } });
  });

  it('rejects "." / ".." coming from the credential default instance too', async () => {
    const ctx = createMockExecuteFunctions({ credentials: { defaultInstance: '..' } });
    await expect(resolveInstanceName.call(ctx, 0)).rejects.toThrow('Invalid instance name ".."');
  });

  it('keeps names that merely contain dots or slashes (encoded)', async () => {
    const ctx = createMockExecuteFunctions({ params: { instanceName: '../admin' } });
    await expect(resolveInstanceName.call(ctx, 0)).resolves.toBe('..%2Fadmin');
    const dotted = createMockExecuteFunctions({ params: { instanceName: 'v1.2' } });
    await expect(resolveInstanceName.call(dotted, 0)).resolves.toBe('v1.2');
  });

  it('resolveInstanceNameFromValue works without an item (hooks, loadOptions)', async () => {
    const ctx = createMockLoadOptionsFunctions({ credentials: { defaultInstance: 'main' } });
    await expect(resolveInstanceNameFromValue.call(ctx, rl('a b'))).resolves.toBe('a%20b');
    await expect(resolveInstanceNameFromValue.call(ctx, '')).resolves.toBe('main');
    await expect(resolveInstanceNameFromValue.call(ctx, { mode: 'list', value: '' })).resolves.toBe(
      'main',
    );
    await expect(resolveInstanceNameFromValue.call(ctx, 'x/y', { encode: false })).resolves.toBe(
      'x/y',
    );
  });
});

describe('encodePathSegment', () => {
  it('encodes IDs as one path segment', () => {
    expect(encodePathSegment('abc')).toBe('abc');
    expect(encodePathSegment('a/b?c=d#e')).toBe('a%2Fb%3Fc%3Dd%23e');
    expect(encodePathSegment(42)).toBe('42');
  });

  it.each(['', '.', '..', undefined, null])('rejects %j', (value) => {
    expect(() => encodePathSegment(value, 'Bot ID')).toThrow('Bot ID');
  });
});

describe('searchInstances', () => {
  it('lists instances sorted with their status and filters them', async () => {
    const ctx = createMockLoadOptionsFunctions();
    const instances = [
      { name: 'zeta', connectionStatus: 'open' },
      { name: 'alpha', connectionStatus: 'close' },
      { instance: { instanceName: 'legacy', status: 'open' } },
    ];
    ctx.http.reply('GET', '/instance/fetchInstances', instances);
    ctx.http.reply('GET', '/instance/fetchInstances', instances);

    await expect(searchInstances.call(ctx)).resolves.toEqual({
      results: [
        { name: 'alpha (close)', value: 'alpha' },
        { name: 'legacy (open)', value: 'legacy' },
        { name: 'zeta (open)', value: 'zeta' },
      ],
    });
    await expect(searchInstances.call(ctx, 'ZE')).resolves.toEqual({
      results: [{ name: 'zeta (open)', value: 'zeta' }],
    });
  });
});

describe('media helpers', () => {
  const pngBase64 = Buffer.from('fake-png').toString('base64');

  it('parses data URIs and validates base64', () => {
    expect(parseDataUri(`data:image/png;base64,${pngBase64}`)).toEqual({
      mimeType: 'image/png',
      data: pngBase64,
    });
    expect(parseDataUri('abc')).toEqual({ data: 'abc' });
    expect(
      cleanBase64(`data:image/png;base64,${pngBase64.slice(0, 4)}\n${pngBase64.slice(4)}`),
    ).toEqual({
      data: pngBase64,
      mimeType: 'image/png',
      valid: true,
    });
    expect(cleanBase64('not base64!').valid).toBe(false);
    expect(cleanBase64('abc').valid).toBe(false);
  });

  it('resolves URL media', async () => {
    const ctx = createMockExecuteFunctions();
    await expect(
      resolveMedia.call(ctx, 0, { type: 'url', url: ' https://cdn.test/a.jpg ' }),
    ).resolves.toMatchObject({ type: 'url', value: 'https://cdn.test/a.jpg' });
    await expect(resolveMedia.call(ctx, 0, { type: 'url', url: 'ftp://x' })).rejects.toThrow(
      'Media URL must start with http',
    );
  });

  it('resolves base64 media and strips data: URIs', async () => {
    const ctx = createMockExecuteFunctions();
    await expect(
      resolveMedia.call(ctx, 0, { type: 'base64', base64: `data:image/png;base64,${pngBase64}` }),
    ).resolves.toEqual({
      type: 'base64',
      value: pngBase64,
      fileName: undefined,
      mimeType: 'image/png',
    });
    await expect(resolveMedia.call(ctx, 0, { type: 'base64', base64: '%%%' })).rejects.toThrow(
      'Media is not valid base64',
    );
  });

  it('resolves binary media from the input item', async () => {
    const ctx = createMockExecuteFunctions({
      items: [
        binaryItem({}, { file: { content: 'hello', fileName: 'h.txt', mimeType: 'text/plain' } }),
      ],
    });
    const media = await resolveMedia.call(ctx, 0, { type: 'binary', binaryPropertyName: 'file' });
    expect(media.value).toBe(Buffer.from('hello').toString('base64'));
    expect(media.buffer?.toString()).toBe('hello');
    expect(media.fileName).toBe('h.txt');
    expect(media.mimeType).toBe('text/plain');
    await expect(
      resolveMedia.call(ctx, 0, { type: 'binary', binaryPropertyName: 'missing' }),
    ).rejects.toThrow("binary file 'missing'");
  });

  it('decides between multipart and JSON bodies', async () => {
    const binaryMedia = {
      type: 'binary' as const,
      value: Buffer.from('v').toString('base64'),
      buffer: Buffer.from('v'),
      fileName: 'v.mp4',
      mimeType: 'video/mp4',
    };
    const multipart = buildMediaRequestBody(
      binaryMedia,
      { number: '1', mediatype: 'video' },
      { allowMultipart: true },
    );
    expect(multipart).toBeInstanceOf(FormData);
    const form = multipart as FormData;
    expect(form.get('number')).toBe('1');
    const file = form.get('file') as File;
    expect(file.name).toBe('v.mp4');
    expect(file.type).toBe('video/mp4');

    // delay is a number: Evolution would reject it in multipart → JSON with base64
    const json = buildMediaRequestBody(
      binaryMedia,
      { number: '1', delay: 1000 },
      { allowMultipart: true },
    );
    expect(json).toEqual({ number: '1', delay: 1000, media: binaryMedia.value });

    const audio = buildMediaRequestBody(
      { type: 'url', value: 'https://cdn.test/a.ogg' },
      { number: '1' },
      { mediaField: 'audio', allowMultipart: true },
    );
    expect(audio).toEqual({ number: '1', audio: 'https://cdn.test/a.ogg' });
  });

  it('builds multipart bodies with bracket notation', () => {
    const form = buildMultipartBody({
      number: '1',
      mentioned: ['a', 'b'],
      quoted: { key: { id: 'X' } },
      skip: undefined,
    });
    expect(form.get('mentioned[0]')).toBe('a');
    expect(form.get('mentioned[1]')).toBe('b');
    expect(form.get('quoted[key][id]')).toBe('X');
    expect(form.has('skip')).toBe(false);
    expect(form.has('file')).toBe(false);
  });

  it('isMultipartSafe only accepts string leaves', () => {
    expect(isMultipartSafe({ a: 'x', b: ['y'], c: { d: 'z' } })).toBe(true);
    expect(isMultipartSafe({ a: 1 })).toBe(false);
    expect(isMultipartSafe({ a: { b: true } })).toBe(false);
  });

  it('converts base64 / data URIs to binary data', async () => {
    const ctx = createMockExecuteFunctions();
    const binary = await base64ToBinary.call(ctx, `data:image/png;base64,${pngBase64}`, 'qr.png');
    expect(binary).toMatchObject({ data: pngBase64, fileName: 'qr.png', mimeType: 'image/png' });
    const explicit = (await base64ToBinary.call(
      ctx,
      pngBase64,
      'x.bin',
      'application/x-test',
    )) as IDataObject;
    expect(explicit.mimeType).toBe('application/x-test');
  });
});
