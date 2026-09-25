import { EvolutionApi } from '../../nodes/EvolutionApi/EvolutionApi.node';
import { resetRetryPolicy, setRetryPolicy } from '../../nodes/EvolutionApi/GenericFunctions';
import { buildSettingsBody } from '../../nodes/EvolutionApi/resources/settings/set.operation';
import { createMockExecuteFunctions, rl } from '../helpers/mockExecuteFunctions';

// Tests of the settings resource.

beforeEach(() => setRetryPolicy({ sleep: async () => undefined }));
afterEach(() => resetRetryPolicy());

const STORED = {
  rejectCall: true,
  msgCall: 'Busy, text me',
  groupsIgnore: true,
  alwaysOnline: false,
  readMessages: false,
  readStatus: true,
  syncFullHistory: false,
  wavoipToken: 'wavoip-secret',
};

describe('settings > get', () => {
  it('GET /settings/find/:instance', async () => {
    const ctx = createMockExecuteFunctions({
      params: { resource: 'settings', operation: 'get', instanceName: rl('main', 'list') },
    });
    ctx.http.reply('GET', '/settings/find/main', { rejectCall: false, groupsIgnore: true });

    const [output] = await new EvolutionApi().execute.call(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/settings/find/main');
    expect(call.qs).toBeUndefined();
    expect(call.body).toBeUndefined();
    expect(output.map((item) => item.json)).toEqual([{ rejectCall: false, groupsIgnore: true }]);
    expect(output.every((item) => item.pairedItem !== undefined)).toBe(true);
  });

  it('removes the Wavoip token unless Include Secrets is on', async () => {
    const ctx = createMockExecuteFunctions({
      params: { resource: 'settings', operation: 'get', instanceName: 'main' },
      itemParams: [{}, { options: { includeSecrets: true } }],
      items: [{ json: {} }, { json: {} }],
    });
    ctx.http.reply('GET', '/settings/find/main', STORED);
    ctx.http.reply('GET', '/settings/find/main', STORED);

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(output[0].json.wavoipToken).toBeUndefined();
    expect(output[0].json.rejectCall).toBe(true);
    expect(output[1].json.wavoipToken).toBe('wavoip-secret');
    expect(output.map((item) => item.pairedItem)).toEqual([{ item: 0 }, { item: 1 }]);
  });

  it('returns {} when the instance has no settings row', async () => {
    const ctx = createMockExecuteFunctions({
      params: { resource: 'settings', operation: 'get', instanceName: 'main' },
    });
    ctx.http.reply('GET', '/settings/find/main', null);
    const [output] = await new EvolutionApi().execute.call(ctx);
    expect(output.map((item) => item.json)).toEqual([{}]);
  });
});

describe('settings > set', () => {
  it('reads the current settings, changes only the added ones and POSTs every setting', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'settings',
        operation: 'set',
        instanceName: rl('main'),
        updateFields: { alwaysOnline: true, msgCall: 'Call later' },
      },
    });
    ctx.http.reply('GET', '/settings/find/main', STORED);
    ctx.http.reply(
      'POST',
      '/settings/set/main',
      { settings: { instanceName: 'main', settings: { ...STORED, alwaysOnline: true } } },
      201,
    );

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /settings/find/main',
      'POST /settings/set/main',
    ]);
    expect(ctx.http.calls[1].body).toEqual({
      rejectCall: true,
      groupsIgnore: true,
      alwaysOnline: true,
      readMessages: false,
      readStatus: true,
      syncFullHistory: false,
      msgCall: 'Call later',
      wavoipToken: 'wavoip-secret',
    });
    // The echoed Wavoip token is removed from the output.
    expect(output[0].json).toEqual({
      settings: {
        instanceName: 'main',
        settings: {
          rejectCall: true,
          msgCall: 'Busy, text me',
          groupsIgnore: true,
          alwaysOnline: true,
          readMessages: false,
          readStatus: true,
          syncFullHistory: false,
        },
      },
    });
    expect(ctx.http.pending).toEqual([]);
  });

  it('defaults the required booleans to false when no settings exist yet', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'settings',
        operation: 'set',
        instanceName: 'main',
        updateFields: { rejectCall: true },
      },
    });
    ctx.http.reply('GET', '/settings/find/main', null);
    ctx.http.reply('POST', '/settings/set/main', { settings: {} }, 201);

    await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls[1].body).toEqual({
      rejectCall: true,
      groupsIgnore: false,
      alwaysOnline: false,
      readMessages: false,
      readStatus: false,
      syncFullHistory: false,
    });
  });

  it('runs once per item with its own instance and changes', async () => {
    const ctx = createMockExecuteFunctions({
      params: { resource: 'settings', operation: 'set' },
      items: [{ json: {} }, { json: {} }],
      itemParams: [
        { instanceName: 'a', updateFields: { readMessages: true } },
        { instanceName: 'b', updateFields: { groupsIgnore: false } },
      ],
    });
    ctx.http.reply('GET', '/settings/find/a', {});
    ctx.http.reply('POST', '/settings/set/a', { settings: { instanceName: 'a' } }, 201);
    ctx.http.reply('GET', '/settings/find/b', STORED);
    ctx.http.reply('POST', '/settings/set/b', { settings: { instanceName: 'b' } }, 201);

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls.map((call) => call.path)).toEqual([
      '/settings/find/a',
      '/settings/set/a',
      '/settings/find/b',
      '/settings/set/b',
    ]);
    expect((ctx.http.calls[1].body as Record<string, unknown>).readMessages).toBe(true);
    expect((ctx.http.calls[3].body as Record<string, unknown>).groupsIgnore).toBe(false);
    expect((ctx.http.calls[3].body as Record<string, unknown>).rejectCall).toBe(true);
    expect(output.map((item) => item.pairedItem)).toEqual([{ item: 0 }, { item: 1 }]);
  });

  it('fails without any setting to change, before calling the API', async () => {
    const ctx = createMockExecuteFunctions({
      params: { resource: 'settings', operation: 'set', instanceName: 'main' },
    });
    await expect(new EvolutionApi().execute.call(ctx)).rejects.toThrow(
      'Add at least one setting to change',
    );
    expect(ctx.http.calls).toEqual([]);
  });

  it('shows Evolution validation errors', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'settings',
        operation: 'set',
        instanceName: 'main',
        updateFields: { rejectCall: true },
      },
    });
    ctx.http.reply('GET', '/settings/find/main', STORED);
    ctx.http.reply(
      'POST',
      '/settings/set/main',
      {
        status: 400,
        error: 'Bad Request',
        response: { message: ['requires property "readStatus"'] },
      },
      400,
    );
    await expect(new EvolutionApi().execute.call(ctx)).rejects.toMatchObject({
      message: 'Bad request: requires property "readStatus"',
      httpCode: '400',
    });
  });

  it('can clear a stored Wavoip token without triggering an upstream socket reconnect', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'settings', operation: 'set', instanceName: 'main',
        updateFields: { wavoipToken: '' },
      },
    });
    ctx.http.reply('GET', '/settings/find/main', STORED);
    ctx.http.reply('POST', '/settings/set/main', { settings: {} }, 201);
    await new EvolutionApi().execute.call(ctx);
    expect(ctx.http.calls[1].body).toMatchObject({ wavoipToken: '', rejectCall: true });
  });

  it('explains a Wavoip socket failure and how to recover after the settings may be saved', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'settings', operation: 'set', instanceName: 'main',
        updateFields: { alwaysOnline: true },
      },
    });
    ctx.http.reply('GET', '/settings/find/main', STORED);
    ctx.http.reply('POST', '/settings/set/main', { status: 500, message: "Cannot read properties of undefined (reading 'ws')" }, 500);
    await expect(new EvolutionApi().execute.call(ctx)).rejects.toMatchObject({
      httpCode: '500',
      description: expect.stringContaining('Add Wavoip Token with an empty value'),
    });
    expect(ctx.http.calls).toHaveLength(2);
  });
});

describe('settings > buildSettingsBody', () => {
  it('keeps stored strings, omits missing ones and coerces the booleans', () => {
    expect(buildSettingsBody({ msgCall: null, rejectCall: 'yes' }, {})).toEqual({
      rejectCall: false,
      groupsIgnore: false,
      alwaysOnline: false,
      readMessages: false,
      readStatus: false,
      syncFullHistory: false,
    });
    expect(buildSettingsBody(STORED, { msgCall: '' }).msgCall).toBe('');
  });
});
