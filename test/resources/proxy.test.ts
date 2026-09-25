import { EvolutionApi } from '../../nodes/EvolutionApi/EvolutionApi.node';
import { resetRetryPolicy, setRetryPolicy } from '../../nodes/EvolutionApi/GenericFunctions';
import { DISABLE_PROXY_BODY } from '../../nodes/EvolutionApi/resources/proxy/set.operation';
import { createMockExecuteFunctions, rl } from '../helpers/mockExecuteFunctions';

// Tests of the proxy resource.

beforeEach(() => setRetryPolicy({ sleep: async () => undefined }));
afterEach(() => resetRetryPolicy());

const STORED = {
  id: 'p1',
  enabled: true,
  host: 'old.proxy.test',
  port: '3128',
  protocol: 'socks5',
  username: 'user',
  password: 'secret',
  instanceId: 'i1',
};

describe('proxy > get', () => {
  it('GET /proxy/find/:instance (empty body → {})', async () => {
    const ctx = createMockExecuteFunctions({
      params: { resource: 'proxy', operation: 'get', instanceName: rl('main', 'list') },
    });
    ctx.http.reply('GET', '/proxy/find/main', null);

    const [output] = await new EvolutionApi().execute.call(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/proxy/find/main');
    expect(call.qs).toBeUndefined();
    expect(call.body).toBeUndefined();
    expect(output.map((item) => item.json)).toEqual([{}]);
    expect(output.every((item) => item.pairedItem !== undefined)).toBe(true);
  });

  it('removes the password unless Include Secrets is on', async () => {
    const ctx = createMockExecuteFunctions({
      params: { resource: 'proxy', operation: 'get', instanceName: 'main' },
      items: [{ json: {} }, { json: {} }],
      itemParams: [{}, { options: { includeSecrets: true } }],
    });
    ctx.http.reply('GET', '/proxy/find/main', STORED);
    ctx.http.reply('GET', '/proxy/find/main', STORED);

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(output[0].json).toEqual({ ...STORED, password: undefined });
    expect('password' in output[0].json).toBe(false);
    expect(output[1].json.password).toBe('secret');
  });
});

describe('proxy > set', () => {
  it('disables the proxy with enabled:false as a JSON boolean and no read (EVONODE-6)', async () => {
    const ctx = createMockExecuteFunctions({
      params: { resource: 'proxy', operation: 'set', instanceName: 'main', proxyEnabled: false },
    });
    ctx.http.reply(
      'POST',
      '/proxy/set/main',
      {
        proxy: {
          instanceName: 'main',
          proxy: { enabled: false, host: '', port: '', protocol: '', username: '', password: '' },
        },
      },
      201,
    );

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls).toHaveLength(1);
    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/proxy/set/main');
    expect(call.body).toEqual(DISABLE_PROXY_BODY);
    expect(call.body).toEqual({ enabled: false, host: 'disabled', port: '0', protocol: 'http' });
    expect(output[0].json).toEqual({
      proxy: {
        instanceName: 'main',
        proxy: { enabled: false, host: '', port: '', protocol: '', username: '' },
      },
    });
  });

  it('keeps the stored port, protocol and credentials when only the host changes', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'proxy',
        operation: 'set',
        instanceName: rl('main'),
        proxyHost: ' new.proxy.test ',
      },
    });
    ctx.http.reply('GET', '/proxy/find/main', STORED);
    ctx.http.reply(
      'POST',
      '/proxy/set/main',
      { proxy: { instanceName: 'main', proxy: { host: 'new.proxy.test', password: 'secret' } } },
      201,
    );

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /proxy/find/main',
      'POST /proxy/set/main',
    ]);
    expect(ctx.http.calls[1].body).toEqual({
      enabled: true,
      host: 'new.proxy.test',
      port: '3128',
      protocol: 'socks5',
      username: 'user',
      password: 'secret',
    });
    expect(output[0].json).toEqual({
      proxy: { instanceName: 'main', proxy: { host: 'new.proxy.test' } },
    });
  });

  it('sets a new proxy and lets an added empty username/password clear them', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'proxy',
        operation: 'set',
        instanceName: 'main',
        proxyHost: 'p.test',
        proxyPort: '8080',
        additionalFields: { protocol: 'http', username: '', password: '' },
      },
    });
    ctx.http.reply('GET', '/proxy/find/main', STORED);
    ctx.http.reply('POST', '/proxy/set/main', { proxy: {} }, 201);

    await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls[1].body).toEqual({
      enabled: true,
      host: 'p.test',
      port: '8080',
      protocol: 'http',
      username: '',
      password: '',
    });
  });

  it('defaults to HTTP and sends no credentials for a first proxy', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'proxy',
        operation: 'set',
        instanceName: 'main',
        proxyHost: 'p.test',
        proxyPort: '8080',
      },
    });
    ctx.http.reply('GET', '/proxy/find/main', null);
    ctx.http.reply('POST', '/proxy/set/main', { proxy: {} }, 201);

    await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls[1].body).toEqual({
      enabled: true,
      host: 'p.test',
      port: '8080',
      protocol: 'http',
    });
  });

  it('requires a host and a valid port', async () => {
    const noHost = createMockExecuteFunctions({
      params: { resource: 'proxy', operation: 'set', instanceName: 'main', proxyPort: '8080' },
    });
    noHost.http.reply('GET', '/proxy/find/main', null);
    await expect(new EvolutionApi().execute.call(noHost)).rejects.toThrow(
      'Proxy Host and Port are required',
    );

    const badPort = createMockExecuteFunctions({
      params: {
        resource: 'proxy',
        operation: 'set',
        instanceName: 'main',
        proxyHost: 'p.test',
        proxyPort: '99999',
      },
    });
    badPort.http.reply('GET', '/proxy/find/main', null);
    await expect(new EvolutionApi().execute.call(badPort)).rejects.toThrow(
      'Invalid proxy port "99999"',
    );
    expect(badPort.http.calls).toHaveLength(1);
  });

  it('surfaces "Invalid proxy" (the server tests the proxy)', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'proxy',
        operation: 'set',
        instanceName: 'main',
        proxyHost: 'p.test',
        proxyPort: '8080',
      },
    });
    ctx.http.reply('GET', '/proxy/find/main', null);
    ctx.http.reply(
      'POST',
      '/proxy/set/main',
      { status: 400, error: 'Bad Request', response: { message: ['Invalid proxy'] } },
      400,
    );
    await expect(new EvolutionApi().execute.call(ctx)).rejects.toMatchObject({
      message: 'Bad request: Invalid proxy',
    });
  });

  it('processes every item (continueOnFail keeps going)', async () => {
    const ctx = createMockExecuteFunctions({
      params: { resource: 'proxy', operation: 'set', proxyEnabled: false },
      items: [{ json: {} }, { json: {} }],
      itemParams: [{ instanceName: 'a' }, { instanceName: 'b' }],
      continueOnFail: true,
    });
    ctx.http.reply('POST', '/proxy/set/a', { status: 404, error: 'Not Found' }, 404);
    ctx.http.reply('POST', '/proxy/set/b', { proxy: { instanceName: 'b' } }, 201);

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(output).toHaveLength(2);
    expect(output[0].json.httpCode).toBe('404');
    expect(output[1].json).toEqual({ proxy: { instanceName: 'b' } });
    expect(output.map((item) => item.pairedItem)).toEqual([{ item: 0 }, { item: 1 }]);
  });
});
