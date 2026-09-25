import type { IDataObject, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import { EvolutionApi } from '../../nodes/EvolutionApi/EvolutionApi.node';
import { resetRetryPolicy, setRetryPolicy } from '../../nodes/EvolutionApi/GenericFunctions';
import {
  binaryPassThrough,
  execute,
  fields,
  methods,
  operations,
} from '../../nodes/EvolutionApi/resources/group';
import {
  normalizeGroupJid,
  normalizeInviteCode,
} from '../../nodes/EvolutionApi/resources/group/helpers';
import type { MockExecuteFunctions, MockOptions } from '../helpers/mockExecuteFunctions';
import {
  binaryItem,
  createMockExecuteFunctions,
  createMockLoadOptionsFunctions,
  rl,
} from '../helpers/mockExecuteFunctions';

// Tests of the group resource (owned by the group agent).

const GROUP = '120363025246125244@g.us';
const GROUP_ID = '120363025246125244';
const CODE = 'F1EX5QZxO181L3TMVP31gY';

/** resourceLocator value of the "Group" field. */
const group = (value: string, mode: 'list' | 'id' = 'id'): IDataObject => ({
  __rl: true,
  mode,
  value,
});

function context(
  operation: string,
  params: IDataObject = {},
  options: Omit<MockOptions, 'params'> = {},
): MockExecuteFunctions {
  return createMockExecuteFunctions({
    ...options,
    params: { resource: 'group', operation, instanceName: rl('main', 'list'), ...params },
  });
}

async function runNode(ctx: MockExecuteFunctions): Promise<INodeExecutionData[]> {
  const [output] = await new EvolutionApi().execute.call(ctx);
  return output;
}

beforeEach(() => setRetryPolicy({ sleep: async () => undefined }));
afterEach(() => resetRetryPolicy());

describe('group > operations', () => {
  const options = operations.options as Array<{ value: string; description: string }>;

  it('covers every group route of 2.3.7 plus updateMemberAddMode (2.4)', () => {
    expect(options.map((option) => option.value)).toEqual([
      'acceptInvite',
      'create',
      'get',
      'getInviteCode',
      'getInviteInfo',
      'getMany',
      'getParticipants',
      'leave',
      'revokeInviteCode',
      'sendInvite',
      'toggleEphemeral',
      'updateDescription',
      'updateMemberAddMode',
      'updateParticipants',
      'updatePicture',
      'updateSetting',
      'updateSubject',
    ]);
    expect(operations.default).toBe('getMany');
  });

  it('marks updateMemberAddMode as 2.4+ in the operation and in its field', () => {
    const option = options.find((o) => o.value === 'updateMemberAddMode');
    expect(option?.description).toContain('Requires Evolution API 2.4+.');
    const field = fields.find((f) => f.name === 'groupMemberAddMode');
    expect(field?.description).toContain('Requires Evolution API 2.4+.');
  });

  it('shows the Group locator (with the group list) on every single-group operation', () => {
    const groupFields = fields.filter((f) => f.name === 'groupJid');
    const scoped = groupFields.flatMap((f) => f.displayOptions?.show?.operation as string[]);
    expect(scoped.sort()).toEqual(
      [
        'get',
        'getInviteCode',
        'getParticipants',
        'leave',
        'revokeInviteCode',
        'sendInvite',
        'toggleEphemeral',
        'updateDescription',
        'updateMemberAddMode',
        'updateParticipants',
        'updatePicture',
        'updateSetting',
        'updateSubject',
      ].sort(),
    );
    for (const field of groupFields as INodeProperties[]) {
      expect(field.type).toBe('resourceLocator');
      expect(field.required).toBe(true);
      expect(field.modes?.map((m) => m.name)).toEqual(['list', 'id']);
      expect(field.modes?.[0].typeOptions?.searchListMethod).toBe('groupSearchGroups');
    }
    expect(typeof methods.listSearch?.groupSearchGroups).toBe('function');
  });

  it('keeps the input binary only for Update Picture', () => {
    expect(binaryPassThrough).toEqual(['updatePicture']);
  });
});

describe('group > helpers', () => {
  it.each([
    [GROUP_ID, GROUP],
    [GROUP, GROUP],
    [` ${GROUP_ID}@G.US `, GROUP],
    ['1203 6302 5246 125244', GROUP],
    ['5511999999999-1600000000', '5511999999999-1600000000@g.us'],
    [{ __rl: true, mode: 'list', value: GROUP }, GROUP],
    ['', ''],
    ['   ', ''],
  ])('normalizeGroupJid(%j) → %j', (input, expected) => {
    expect(normalizeGroupJid(input)).toBe(expected);
  });

  it.each([
    '5215512345678@s.whatsapp.net',
    '123456789012345@lid',
    '120363000000000000@newsletter',
    `https://chat.whatsapp.com/${CODE}`,
    'My group',
    '@g.us',
    '-@g.us',
    // Bare phone numbers (E.164: at most 15 digits) never get @g.us appended.
    '5215512345678',
    '+52 1 55 1234 5678',
    '55-1234-5678',
    '123456789012345',
  ])('normalizeGroupJid(%j) is invalid', (input) => {
    expect(normalizeGroupJid(input)).toBeUndefined();
  });

  it('keeps an explicit @g.us JID even when its ID is short (the server has the last word)', () => {
    expect(normalizeGroupJid('5215512345678@g.us')).toBe('5215512345678@g.us');
    // 16+ digits cannot be a phone number: appended as usual.
    expect(normalizeGroupJid('1234567890123456')).toBe('1234567890123456@g.us');
  });

  it.each([
    [CODE, CODE],
    [` ${CODE} `, CODE],
    [`https://chat.whatsapp.com/${CODE}`, CODE],
    [`https://chat.whatsapp.com/invite/${CODE}`, CODE],
    [`chat.whatsapp.com/${CODE}?utm=x`, CODE],
    ['', ''],
  ])('normalizeInviteCode(%j) → %j', (input, expected) => {
    expect(normalizeInviteCode(input)).toBe(expected);
  });

  it.each(['not a code', 'https://example.com/?a=b', 'abc-def'])(
    'normalizeInviteCode(%j) is invalid',
    (input) => {
      expect(normalizeInviteCode(input)).toBeUndefined();
    },
  );
});

describe('group > listSearch groupSearchGroups', () => {
  const groups = [
    { id: '120363000000000002@g.us', subject: 'Sales' },
    { id: '120363000000000001@g.us', subject: 'Family' },
    { id: '120363000000000003@g.us', subject: '' },
  ];

  it('lists the groups of the selected instance, sorted by subject', async () => {
    const ctx = createMockLoadOptionsFunctions({ params: { instanceName: rl('main', 'list') } });
    ctx.http.reply('GET', '/group/fetchAllGroups/main', groups);

    const result = await methods.listSearch!.groupSearchGroups.call(ctx);

    expect(ctx.http.calls[0].qs).toEqual({ getParticipants: 'false' });
    expect(result.results).toEqual([
      { name: '120363000000000003@g.us', value: '120363000000000003@g.us' },
      { name: 'Family', value: '120363000000000001@g.us' },
      { name: 'Sales', value: '120363000000000002@g.us' },
    ]);
  });

  it('filters by subject or JID and falls back to the default instance', async () => {
    const ctx = createMockLoadOptionsFunctions({
      params: { instanceName: rl('', 'list') },
      credentials: { defaultInstance: 'fallback' },
    });
    ctx.http.reply('GET', '/group/fetchAllGroups/fallback', groups);
    ctx.http.reply('GET', '/group/fetchAllGroups/fallback', groups);

    const bySubject = await methods.listSearch!.groupSearchGroups.call(ctx, 'fam');
    const byJid = await methods.listSearch!.groupSearchGroups.call(ctx, '0002@g');

    expect(bySubject.results).toEqual([{ name: 'Family', value: '120363000000000001@g.us' }]);
    expect(byJid.results).toEqual([{ name: 'Sales', value: '120363000000000002@g.us' }]);
  });
});

describe('group > get', () => {
  it('GET /group/findGroupInfos/:instance?groupJid= and returns the group', async () => {
    const ctx = context('get', { groupJid: group(GROUP, 'list') });
    const info = { id: GROUP, subject: 'Sales', size: 2, participants: [{ id: 'a', admin: null }] };
    ctx.http.reply('GET', '/group/findGroupInfos/main', info);

    const output = await runNode(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/group/findGroupInfos/main');
    expect(call.qs).toEqual({ groupJid: GROUP });
    expect(call.body).toBeUndefined();
    expect(output).toEqual([{ json: info, pairedItem: { item: 0 } }]);
  });

  it('appends @g.us to a bare group ID', async () => {
    const ctx = context('get', { groupJid: group(GROUP_ID) });
    ctx.http.reply('GET', '/group/findGroupInfos/main', { id: GROUP });
    await execute.get.call(ctx, 0);
    expect(ctx.http.calls[0].qs).toEqual({ groupJid: GROUP });
  });

  it('rejects a contact JID before calling the API', async () => {
    const ctx = context('get', { groupJid: group('5215512345678@s.whatsapp.net') });
    const error = await execute.get.call(ctx, 0).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NodeOperationError);
    expect((error as NodeOperationError).message).toBe(
      '"5215512345678@s.whatsapp.net" is not a group JID',
    );
    expect(ctx.http.calls).toHaveLength(0);
  });

  it('explains that an invite link is not a group JID', async () => {
    const ctx = context('get', { groupJid: group(`https://chat.whatsapp.com/${CODE}`) });
    await expect(execute.get.call(ctx, 0)).rejects.toMatchObject({
      message: `"https://chat.whatsapp.com/${CODE}" is an invite link, not a group JID`,
      description: expect.stringContaining('Get Invite Info'),
    });
  });

  it('requires a group', async () => {
    const ctx = context('get', { groupJid: group('', 'list') });
    await expect(execute.get.call(ctx, 0)).rejects.toThrow('Group is required');
  });

  it.each(['5215512345678', '+52 1 55 1234 5678'])(
    'rejects the phone number %j instead of sending it as <number>@g.us',
    async (value) => {
      const ctx = context('get', { groupJid: group(value) });
      const error = await execute.get.call(ctx, 0).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(NodeOperationError);
      expect(error).toMatchObject({
        message: `"${value}" looks like a phone number, not a group ID`,
        description: expect.stringContaining('Group IDs have 18 digits'),
      });
      expect(ctx.http.calls).toHaveLength(0);
    },
  );

  it('runs once per input item with its own group JID in the query', async () => {
    const other = '120363000000000009@g.us';
    const ctx = createMockExecuteFunctions({
      params: { resource: 'group', operation: 'get', instanceName: rl('main') },
      items: [{ json: {} }, { json: {} }],
      itemParams: [{ groupJid: group(GROUP, 'list') }, { groupJid: group('120363000000000009') }],
    });
    ctx.http.reply('GET', '/group/findGroupInfos/main', { id: GROUP, subject: 'Sales' });
    ctx.http.reply('GET', '/group/findGroupInfos/main', { id: other, subject: 'Family' });

    const output = await runNode(ctx);

    expect(ctx.http.calls.map((call) => call.qs)).toEqual([
      { groupJid: GROUP },
      { groupJid: other },
    ]);
    expect(output).toEqual([
      { json: { id: GROUP, subject: 'Sales' }, pairedItem: { item: 0 } },
      { json: { id: other, subject: 'Family' }, pairedItem: { item: 1 } },
    ]);
  });

  it('shows the Evolution error when the group cannot be fetched', async () => {
    const ctx = context('get', { groupJid: group(GROUP) });
    ctx.http.reply(
      'GET',
      '/group/findGroupInfos/main',
      {
        status: 404,
        error: 'Not Found',
        response: { message: ['Error fetching group', 'Error: item-not-found'] },
      },
      404,
    );
    const error = await runNode(ctx).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NodeApiError);
    expect(error).toMatchObject({
      message: 'Not found: Error fetching group; Error: item-not-found',
      httpCode: '404',
    });
  });
});

describe('group > getMany', () => {
  it('GET /group/fetchAllGroups/:instance?getParticipants=', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'group',
        operation: 'getMany',
        getParticipants: false,
        returnAll: false,
        limit: 1,
        instanceName: rl('main', 'list'),
      },
    });
    ctx.http.reply('GET', '/group/fetchAllGroups/main', [{ id: '1@g.us' }, { id: '2@g.us' }]);

    const [output] = await new EvolutionApi().execute.call(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/group/fetchAllGroups/main');
    expect(call.qs).toEqual({ getParticipants: 'false' });
    expect(call.body).toBeUndefined();
    expect(output.map((item) => item.json)).toEqual([{ id: '1@g.us' }]);
    expect(output.every((item) => item.pairedItem !== undefined)).toBe(true);
  });

  it('asks for participants and returns every group with Return All', async () => {
    const ctx = context('getMany', { getParticipants: true, returnAll: true });
    const groups = Array.from({ length: 60 }, (_, i) => ({ id: `${i}@g.us`, participants: [] }));
    ctx.http.reply('GET', '/group/fetchAllGroups/main', groups);

    const output = await runNode(ctx);

    expect(ctx.http.calls[0].qs).toEqual({ getParticipants: 'true' });
    expect(output).toHaveLength(60);
  });

  it('filters by subject (case-insensitive) before applying the limit', async () => {
    const ctx = context('getMany', { limit: 1, filters: { subject: ' SALES ' } });
    ctx.http.reply('GET', '/group/fetchAllGroups/main', [
      { id: '1@g.us', subject: 'Family' },
      { id: '2@g.us', subject: 'Sales MX' },
      { id: '3@g.us', subject: 'sales BR' },
      { id: '4@g.us' },
    ]);

    const result = await execute.getMany.call(ctx, 0);

    expect(result).toEqual([{ id: '2@g.us', subject: 'Sales MX' }]);
    expect(ctx.http.calls[0].qs).toEqual({ getParticipants: 'false' });
  });

  it('returns no items when the instance has no groups', async () => {
    const ctx = context('getMany');
    ctx.http.reply('GET', '/group/fetchAllGroups/main', []);
    await expect(runNode(ctx)).resolves.toEqual([]);
  });
});

describe('group > getParticipants', () => {
  it('GET /group/participants/:instance?groupJid= and outputs one item per participant', async () => {
    const ctx = context('getParticipants', { groupJid: group(GROUP) });
    const participants = [
      { id: '5215512345678@s.whatsapp.net', admin: 'superadmin', name: 'Ana' },
      { id: '123456789012345@lid', admin: null },
    ];
    ctx.http.reply('GET', '/group/participants/main', { participants });

    const output = await runNode(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('GET');
    expect(call.qs).toEqual({ groupJid: GROUP });
    expect(output).toEqual([
      { json: participants[0], pairedItem: { item: 0 } },
      { json: participants[1], pairedItem: { item: 0 } },
    ]);
  });

  it('returns the response as-is when it has no participant list', async () => {
    const ctx = context('getParticipants', { groupJid: group(GROUP) });
    ctx.http.reply('GET', '/group/participants/main', { unexpected: true });
    await expect(execute.getParticipants.call(ctx, 0)).resolves.toEqual({ unexpected: true });
  });
});

describe('group > getInviteCode', () => {
  it('GET /group/inviteCode/:instance?groupJid=', async () => {
    const ctx = context('getInviteCode', { groupJid: group(GROUP_ID) });
    const response = { inviteUrl: `https://chat.whatsapp.com/${CODE}`, inviteCode: CODE };
    ctx.http.reply('GET', '/group/inviteCode/main', response);

    await expect(execute.getInviteCode.call(ctx, 0)).resolves.toEqual(response);
    const [call] = ctx.http.calls;
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/group/inviteCode/main');
    expect(call.qs).toEqual({ groupJid: GROUP });
    expect(call.body).toBeUndefined();
  });
});

describe('group > getInviteInfo', () => {
  it('GET /group/inviteInfo/:instance?inviteCode= with the code taken from a link', async () => {
    const ctx = context('getInviteInfo', { inviteCode: `https://chat.whatsapp.com/${CODE}` });
    ctx.http.reply('GET', '/group/inviteInfo/main', { id: GROUP, subject: 'Sales', size: 12 });

    await expect(execute.getInviteInfo.call(ctx, 0)).resolves.toEqual({
      id: GROUP,
      subject: 'Sales',
      size: 12,
    });
    const [call] = ctx.http.calls;
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/group/inviteInfo/main');
    expect(call.qs).toEqual({ inviteCode: CODE });
  });

  it('rejects an invalid invite code before calling the API', async () => {
    const ctx = context('getInviteInfo', { inviteCode: 'not a code' });
    await expect(execute.getInviteInfo.call(ctx, 0)).rejects.toThrow(
      'Invalid invite code "not a code"',
    );
    expect(ctx.http.calls).toHaveLength(0);
  });

  it('retries a 503 from the proxy (read-only GET)', async () => {
    const ctx = context('getInviteInfo', { inviteCode: CODE });
    ctx.http.queue(
      'GET',
      '/group/inviteInfo/main',
      { statusCode: 503, body: 'Service Unavailable' },
      { statusCode: 200, body: { id: GROUP } },
    );
    await expect(execute.getInviteInfo.call(ctx, 0)).resolves.toEqual({ id: GROUP });
    expect(ctx.http.calls).toHaveLength(2);
  });
});

describe('group > acceptInvite', () => {
  it('GET /group/acceptInviteCode/:instance?inviteCode=', async () => {
    const ctx = context('acceptInvite', { inviteCode: ` ${CODE} ` });
    ctx.http.reply('GET', '/group/acceptInviteCode/main', { accepted: true, groupJid: GROUP });

    const output = await runNode(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/group/acceptInviteCode/main');
    expect(call.qs).toEqual({ inviteCode: CODE });
    expect(call.body).toBeUndefined();
    expect(output).toEqual([
      { json: { accepted: true, groupJid: GROUP }, pairedItem: { item: 0 } },
    ]);
  });

  it('never retries a 5xx: the GET joins the group', async () => {
    const ctx = context('acceptInvite', { inviteCode: CODE });
    ctx.http.reply('GET', '/group/acceptInviteCode/main', 'Service Unavailable', 503);
    ctx.http.reply('GET', '/group/acceptInviteCode/main', { accepted: true, groupJid: GROUP });

    await expect(execute.acceptInvite.call(ctx, 0)).rejects.toMatchObject({ httpCode: '503' });
    expect(ctx.http.calls).toHaveLength(1);
  });

  it('requires an invite code', async () => {
    const ctx = context('acceptInvite', { inviteCode: '' });
    await expect(execute.acceptInvite.call(ctx, 0)).rejects.toThrow('Invite code is required');
  });
});

describe('group > create', () => {
  it('POST /group/create/:instance with subject, participants and optional fields', async () => {
    const ctx = context('create', {
      groupSubject: '  Sales Team ',
      groupParticipants: '+52 1 55 1234 5678, 5511999999999\n5511999999999; 123456789012345@lid',
      additionalFields: { description: 'Weekly numbers', promoteParticipants: true },
    });
    const metadata = { id: GROUP, subject: 'Sales Team', participants: [] };
    ctx.http.reply('POST', '/group/create/main', metadata, 201);

    const output = await runNode(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/group/create/main');
    expect(call.qs).toBeUndefined();
    expect(call.body).toEqual({
      subject: 'Sales Team',
      participants: ['5215512345678', '5511999999999', '123456789012345@lid'],
      description: 'Weekly numbers',
      promoteParticipants: true,
    });
    expect(output).toEqual([{ json: metadata, pairedItem: { item: 0 } }]);
  });

  it('omits empty optional fields', async () => {
    const ctx = context('create', {
      groupSubject: 'Sales',
      groupParticipants: '5511999999999',
      additionalFields: { description: '  ', promoteParticipants: false },
    });
    ctx.http.reply('POST', '/group/create/main', { id: GROUP }, 201);
    await execute.create.call(ctx, 0);
    expect(ctx.http.calls[0].body).toEqual({ subject: 'Sales', participants: ['5511999999999'] });
  });

  it('accepts participants as an array from an expression', async () => {
    const ctx = context('create', {
      groupSubject: 'Sales',
      groupParticipants: ['5511999999999', '5511888888888'],
    });
    ctx.http.reply('POST', '/group/create/main', { id: GROUP }, 201);
    await execute.create.call(ctx, 0);
    expect((ctx.http.calls[0].body as IDataObject).participants).toEqual([
      '5511999999999',
      '5511888888888',
    ]);
  });

  it('validates subject and participants before calling the API', async () => {
    const noSubject = context('create', { groupSubject: ' ', groupParticipants: '5511999999999' });
    await expect(execute.create.call(noSubject, 0)).rejects.toThrow('Subject is required');

    const noParticipants = context('create', { groupSubject: 'Sales', groupParticipants: ' , ' });
    await expect(execute.create.call(noParticipants, 0)).rejects.toThrow(
      'At least one participant is required',
    );
    expect([...noSubject.http.calls, ...noParticipants.http.calls]).toHaveLength(0);
  });

  it('does not retry a 503 (POST)', async () => {
    const ctx = context('create', { groupSubject: 'Sales', groupParticipants: '5511999999999' });
    ctx.http.reply('POST', '/group/create/main', 'Service Unavailable', 503);
    await expect(execute.create.call(ctx, 0)).rejects.toMatchObject({ httpCode: '503' });
    expect(ctx.http.calls).toHaveLength(1);
  });
});

describe('group > updateSubject', () => {
  it('POST /group/updateGroupSubject/:instance { groupJid, subject }', async () => {
    const ctx = context('updateSubject', { groupJid: group(GROUP_ID), groupSubject: ' New name ' });
    ctx.http.reply('POST', '/group/updateGroupSubject/main', { update: 'success' }, 201);

    await expect(execute.updateSubject.call(ctx, 0)).resolves.toEqual({ update: 'success' });
    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.qs).toBeUndefined();
    expect(call.body).toEqual({ groupJid: GROUP, subject: 'New name' });
  });

  it('runs once per input item with its own group and subject', async () => {
    const other = '120363000000000009@g.us';
    const ctx = createMockExecuteFunctions({
      params: { resource: 'group', operation: 'updateSubject', instanceName: rl('main') },
      items: [{ json: {} }, { json: {} }],
      itemParams: [
        { groupJid: group(GROUP), groupSubject: 'First' },
        { groupJid: group(other), groupSubject: 'Second' },
      ],
    });
    ctx.http.reply('POST', '/group/updateGroupSubject/main', { update: 'success' }, 201);
    ctx.http.reply('POST', '/group/updateGroupSubject/main', { update: 'success' }, 201);

    const output = await runNode(ctx);

    expect(ctx.http.calls.map((call) => call.body)).toEqual([
      { groupJid: GROUP, subject: 'First' },
      { groupJid: other, subject: 'Second' },
    ]);
    expect(output.map((item) => item.pairedItem)).toEqual([{ item: 0 }, { item: 1 }]);
  });

  it('continues on fail with a per-item error for an invalid group', async () => {
    const ctx = createMockExecuteFunctions({
      params: { resource: 'group', operation: 'updateSubject', instanceName: rl('main') },
      items: [{ json: {} }, { json: {} }],
      itemParams: [
        { groupJid: group('5215512345678@s.whatsapp.net'), groupSubject: 'First' },
        { groupJid: group(GROUP), groupSubject: 'Second' },
      ],
      continueOnFail: true,
    });
    ctx.http.reply('POST', '/group/updateGroupSubject/main', { update: 'success' }, 201);

    const output = await runNode(ctx);

    expect(ctx.http.calls).toHaveLength(1);
    expect(output[0]).toMatchObject({
      json: { error: '"5215512345678@s.whatsapp.net" is not a group JID' },
      pairedItem: { item: 0 },
    });
    expect(output[1]).toEqual({ json: { update: 'success' }, pairedItem: { item: 1 } });
  });

  it('requires a subject', async () => {
    const ctx = context('updateSubject', { groupJid: group(GROUP), groupSubject: '' });
    await expect(execute.updateSubject.call(ctx, 0)).rejects.toThrow('Subject is required');
  });
});

describe('group > updateDescription', () => {
  it('POST /group/updateGroupDescription/:instance { groupJid, description }', async () => {
    const ctx = context('updateDescription', {
      groupJid: group(GROUP),
      groupDescription: 'Line 1\nLine 2',
    });
    ctx.http.reply('POST', '/group/updateGroupDescription/main', { update: 'success' }, 201);

    await expect(execute.updateDescription.call(ctx, 0)).resolves.toEqual({ update: 'success' });
    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/group/updateGroupDescription/main');
    expect(call.body).toEqual({ groupJid: GROUP, description: 'Line 1\nLine 2' });
  });

  it('rejects an empty description (Evolution cannot clear it)', async () => {
    const ctx = context('updateDescription', { groupJid: group(GROUP), groupDescription: ' ' });
    await expect(execute.updateDescription.call(ctx, 0)).rejects.toThrow('Description is required');
    expect(ctx.http.calls).toHaveLength(0);
  });
});

describe('group > updatePicture', () => {
  it('sends a URL as { groupJid, image } JSON', async () => {
    const ctx = context('updatePicture', {
      groupJid: group(GROUP),
      groupPictureSource: 'url',
      groupPictureUrl: ' https://example.com/logo.jpg ',
    });
    ctx.http.reply('POST', '/group/updateGroupPicture/main', { update: 'success' }, 201);

    await expect(execute.updatePicture.call(ctx, 0)).resolves.toEqual({ update: 'success' });
    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/group/updateGroupPicture/main');
    expect(call.body).toEqual({ groupJid: GROUP, image: 'https://example.com/logo.jpg' });
    expect(call.headers['Content-Type']).toBe('application/json');
  });

  it('strips the data: prefix of base64 input', async () => {
    const png = Buffer.from('PNGDATA').toString('base64');
    const ctx = context('updatePicture', {
      groupJid: group(GROUP),
      groupPictureSource: 'base64',
      groupPictureBase64: `data:image/png;base64,${png}`,
    });
    ctx.http.reply('POST', '/group/updateGroupPicture/main', { update: 'success' }, 201);

    await execute.updatePicture.call(ctx, 0);
    expect(ctx.http.calls[0].body).toEqual({ groupJid: GROUP, image: png });
  });

  it('uploads an n8n binary as base64 and keeps the binary in the output', async () => {
    const item = binaryItem(
      { source: 'upload' },
      { photo: { content: 'JPEGDATA', fileName: 'logo.jpg', mimeType: 'image/jpeg' } },
    );
    const ctx = context(
      'updatePicture',
      { groupJid: group(GROUP), groupPictureSource: 'binary', binaryPropertyName: 'photo' },
      { items: [item] },
    );
    ctx.http.reply('POST', '/group/updateGroupPicture/main', { update: 'success' }, 201);

    const output = await runNode(ctx);

    const [call] = ctx.http.calls;
    expect(call.body).not.toBeInstanceOf(FormData);
    expect(call.body).toEqual({
      groupJid: GROUP,
      image: Buffer.from('JPEGDATA').toString('base64'),
    });
    expect(output).toEqual([
      { json: { update: 'success' }, binary: item.binary, pairedItem: { item: 0 } },
    ]);
  });

  it('rejects a binary file that is not an image', async () => {
    const ctx = context(
      'updatePicture',
      { groupJid: group(GROUP), groupPictureSource: 'binary', binaryPropertyName: 'data' },
      {
        items: [
          binaryItem(
            {},
            { data: { content: '%PDF', fileName: 'a.pdf', mimeType: 'application/pdf' } },
          ),
        ],
      },
    );
    await expect(execute.updatePicture.call(ctx, 0)).rejects.toThrow(
      'The picture must be an image, not application/pdf',
    );
    expect(ctx.http.calls).toHaveLength(0);
  });

  it('fails clearly when the binary property is missing', async () => {
    const ctx = context('updatePicture', {
      groupJid: group(GROUP),
      groupPictureSource: 'binary',
      binaryPropertyName: 'data',
    });
    await expect(execute.updatePicture.call(ctx, 0)).rejects.toThrow("binary file 'data'");
    expect(ctx.http.calls).toHaveLength(0);
  });

  it('rejects a URL that is not http(s)', async () => {
    const ctx = context('updatePicture', {
      groupJid: group(GROUP),
      groupPictureSource: 'url',
      groupPictureUrl: 'ftp://example.com/a.jpg',
    });
    await expect(execute.updatePicture.call(ctx, 0)).rejects.toThrow(
      'Media URL must start with http:// or https://',
    );
  });

  it('rejects an unknown picture source and invalid base64 before calling the API', async () => {
    const badSource = context('updatePicture', {
      groupJid: group(GROUP),
      groupPictureSource: 'file',
    });
    await expect(execute.updatePicture.call(badSource, 0)).rejects.toThrow(
      'Invalid picture source "file"',
    );

    const badBase64 = context('updatePicture', {
      groupJid: group(GROUP),
      groupPictureSource: 'base64',
      groupPictureBase64: 'not base64!',
    });
    await expect(execute.updatePicture.call(badBase64, 0)).rejects.toThrow(
      'Media is not valid base64',
    );
    expect([...badSource.http.calls, ...badBase64.http.calls]).toHaveLength(0);
  });

  it('accepts a binary without a specific image mime type (application/octet-stream)', async () => {
    const ctx = context(
      'updatePicture',
      { groupJid: group(GROUP), groupPictureSource: 'binary', binaryPropertyName: 'data' },
      {
        items: [
          binaryItem(
            {},
            { data: { content: 'JPEGDATA', fileName: 'x', mimeType: 'application/octet-stream' } },
          ),
        ],
      },
    );
    ctx.http.reply('POST', '/group/updateGroupPicture/main', { update: 'success' }, 201);
    await execute.updatePicture.call(ctx, 0);
    expect((ctx.http.calls[0].body as IDataObject).image).toBe(
      Buffer.from('JPEGDATA').toString('base64'),
    );
  });

  it('documents the Evolution URL caveats (TLD/IP host, ?timestamp on pre-signed URLs)', () => {
    const urlField = fields.find((f) => f.name === 'groupPictureUrl');
    expect(urlField?.description).toContain('localhost');
    expect(urlField?.description).toContain('pre-signed URLs');
  });
});

describe('group > updateParticipants', () => {
  it('POST /group/updateParticipant/:instance and outputs one item per participant', async () => {
    const ctx = context('updateParticipants', {
      groupJid: group(GROUP),
      groupParticipantAction: 'add',
      groupParticipants: '+55 11 99999-9999, 5511888888888',
    });
    const results = [
      { status: '200', jid: '5511999999999@s.whatsapp.net', content: { tag: 'participant' } },
      { status: '403', jid: '5511888888888@s.whatsapp.net', content: { tag: 'participant' } },
    ];
    ctx.http.reply('POST', '/group/updateParticipant/main', { updateParticipants: results }, 201);

    const output = await runNode(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.qs).toBeUndefined();
    expect(call.body).toEqual({
      groupJid: GROUP,
      action: 'add',
      participants: ['5511999999999', '5511888888888'],
    });
    expect(output).toEqual([
      { json: results[0], pairedItem: { item: 0 } },
      { json: results[1], pairedItem: { item: 0 } },
    ]);
  });

  it('keeps @lid and full JIDs untouched (Evolution applies createJid itself)', async () => {
    const ctx = context('updateParticipants', {
      groupJid: group(GROUP),
      groupParticipantAction: 'Remove',
      groupParticipants: '123456789012345@lid\n5511999999999@s.whatsapp.net',
    });
    const results = [{ status: '200', jid: '123456789012345@lid', content: {} }];
    ctx.http.reply('POST', '/group/updateParticipant/main', { updateParticipants: results }, 201);

    await expect(execute.updateParticipants.call(ctx, 0)).resolves.toEqual(results);
    expect(ctx.http.calls[0].body).toEqual({
      groupJid: GROUP,
      action: 'remove',
      participants: ['123456789012345@lid', '5511999999999@s.whatsapp.net'],
    });
  });

  it.each(['promote', 'demote', 'remove'])('sends action "%s"', async (action) => {
    const ctx = context('updateParticipants', {
      groupJid: group(GROUP),
      groupParticipantAction: action,
      groupParticipants: '5511999999999',
    });
    ctx.http.reply('POST', '/group/updateParticipant/main', { updateParticipants: [] }, 201);
    await expect(execute.updateParticipants.call(ctx, 0)).resolves.toEqual({
      updateParticipants: [],
    });
    expect((ctx.http.calls[0].body as IDataObject).action).toBe(action);
  });

  it('rejects an unknown action and an empty participant list', async () => {
    const badAction = context('updateParticipants', {
      groupJid: group(GROUP),
      groupParticipantAction: 'kick',
      groupParticipants: '5511999999999',
    });
    await expect(execute.updateParticipants.call(badAction, 0)).rejects.toThrow(
      'Invalid participant action "kick"',
    );

    const noParticipants = context('updateParticipants', {
      groupJid: group(GROUP),
      groupParticipantAction: 'add',
      groupParticipants: '',
    });
    await expect(execute.updateParticipants.call(noParticipants, 0)).rejects.toThrow(
      'At least one participant is required',
    );
  });
});

describe('group > updateSetting', () => {
  it.each(['announcement', 'not_announcement', 'locked', 'unlocked'])(
    'POST /group/updateSetting/:instance { groupJid, action: "%s" }',
    async (action) => {
      const ctx = context('updateSetting', { groupJid: group(GROUP_ID), groupSetting: action });
      // Baileys returns undefined: Evolution answers { updateSetting: undefined } → {}
      ctx.http.reply('POST', '/group/updateSetting/main', {}, 201);

      const output = await runNode(ctx);

      const [call] = ctx.http.calls;
      expect(call.method).toBe('POST');
      expect(call.path).toBe('/group/updateSetting/main');
      expect(call.body).toEqual({ groupJid: GROUP, action });
      expect(output).toEqual([
        { json: { update: 'success', groupJid: GROUP, action }, pairedItem: { item: 0 } },
      ]);
    },
  );

  it('accepts the setting in any case from an expression', async () => {
    const ctx = context('updateSetting', {
      groupJid: group(GROUP),
      groupSetting: ' NOT_ANNOUNCEMENT ',
    });
    ctx.http.reply('POST', '/group/updateSetting/main', {}, 201);
    await execute.updateSetting.call(ctx, 0);
    expect(ctx.http.calls[0].body).toEqual({ groupJid: GROUP, action: 'not_announcement' });
  });

  it('rejects an unknown setting', async () => {
    const ctx = context('updateSetting', { groupJid: group(GROUP), groupSetting: 'closed' });
    await expect(execute.updateSetting.call(ctx, 0)).rejects.toThrow(
      'Invalid group setting "closed"',
    );
  });
});

describe('group > updateMemberAddMode (2.4+)', () => {
  it('POST /group/updateMemberAddMode/:instance { groupJid, mode }', async () => {
    const ctx = context('updateMemberAddMode', {
      groupJid: group(GROUP),
      groupMemberAddMode: 'all_member_add',
    });
    ctx.http.reply(
      'POST',
      '/group/updateMemberAddMode/main',
      { update: 'success', mode: 'all_member_add' },
      201,
    );

    await expect(execute.updateMemberAddMode.call(ctx, 0)).resolves.toEqual({
      update: 'success',
      mode: 'all_member_add',
    });
    expect(ctx.http.calls[0].body).toEqual({ groupJid: GROUP, mode: 'all_member_add' });
  });

  it('explains the 404 of a 2.3.x server', async () => {
    const ctx = context('updateMemberAddMode', {
      groupJid: group(GROUP),
      groupMemberAddMode: 'admin_add',
    });
    ctx.http.reply(
      'POST',
      '/group/updateMemberAddMode/main',
      {
        status: 404,
        error: 'Not Found',
        response: { message: ['Cannot POST /group/updateMemberAddMode/main'] },
      },
      404,
    );
    await expect(runNode(ctx)).rejects.toMatchObject({
      message: 'Not found: Cannot POST /group/updateMemberAddMode/main',
      description: expect.stringContaining('Requires Evolution API 2.4+'),
    });
  });

  it('accepts the mode in any case from an expression', async () => {
    const ctx = context('updateMemberAddMode', {
      groupJid: group(GROUP),
      groupMemberAddMode: 'ADMIN_ADD',
    });
    ctx.http.reply(
      'POST',
      '/group/updateMemberAddMode/main',
      { update: 'success', mode: 'admin_add' },
      201,
    );
    await execute.updateMemberAddMode.call(ctx, 0);
    expect(ctx.http.calls[0].body).toEqual({ groupJid: GROUP, mode: 'admin_add' });
  });

  it('rejects an unknown mode', async () => {
    const ctx = context('updateMemberAddMode', {
      groupJid: group(GROUP),
      groupMemberAddMode: 'everyone',
    });
    await expect(execute.updateMemberAddMode.call(ctx, 0)).rejects.toThrow(
      'Invalid member add mode "everyone"',
    );
  });
});

describe('group > toggleEphemeral', () => {
  it.each([
    [0, 0],
    [86400, 86400],
    ['604800', 604800],
    [7776000, 7776000],
  ])('POST /group/toggleEphemeral/:instance with expiration %j', async (value, expected) => {
    const ctx = context('toggleEphemeral', {
      groupJid: group(GROUP),
      groupEphemeralExpiration: value,
    });
    ctx.http.reply('POST', '/group/toggleEphemeral/main', { success: true }, 201);

    await expect(execute.toggleEphemeral.call(ctx, 0)).resolves.toEqual({ success: true });
    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.body).toEqual({ groupJid: GROUP, expiration: expected });
  });

  it('defaults to 7 days', async () => {
    const ctx = context('toggleEphemeral', { groupJid: group(GROUP) });
    ctx.http.reply('POST', '/group/toggleEphemeral/main', { success: true }, 201);
    await execute.toggleEphemeral.call(ctx, 0);
    expect((ctx.http.calls[0].body as IDataObject).expiration).toBe(604800);
  });

  it.each([3600, '', '1d', null])('rejects the unsupported duration %j', async (value) => {
    const ctx = context('toggleEphemeral', {
      groupJid: group(GROUP),
      groupEphemeralExpiration: value,
    });
    await expect(execute.toggleEphemeral.call(ctx, 0)).rejects.toThrow(
      'Invalid disappearing messages duration',
    );
    expect(ctx.http.calls).toHaveLength(0);
  });
});

describe('group > sendInvite', () => {
  it('POST /group/sendInvite/:instance with the full JID in the body', async () => {
    const ctx = context('sendInvite', {
      groupJid: group(GROUP_ID),
      numbers: '+52 1 55 1234 5678\n5511999999999',
      text: 'Join us!',
    });
    const response = { send: true, inviteUrl: `https://chat.whatsapp.com/${CODE}` };
    ctx.http.reply('POST', '/group/sendInvite/main', response);

    const output = await runNode(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/group/sendInvite/main');
    expect(call.qs).toBeUndefined();
    // groupNoValidate: Evolution neither reads ?groupJid nor appends @g.us on this route.
    expect(call.body).toEqual({
      groupJid: GROUP,
      description: 'Join us!',
      numbers: ['5215512345678', '5511999999999'],
    });
    expect(output).toEqual([{ json: response, pairedItem: { item: 0 } }]);
  });

  it('validates numbers and text before calling the API', async () => {
    const noNumbers = context('sendInvite', { groupJid: group(GROUP), numbers: '', text: 'Hi' });
    await expect(execute.sendInvite.call(noNumbers, 0)).rejects.toThrow(
      'At least one number is required',
    );
    const noText = context('sendInvite', {
      groupJid: group(GROUP),
      numbers: '5511999999999',
      text: '  ',
    });
    await expect(execute.sendInvite.call(noText, 0)).rejects.toThrow('Message is required');
    expect([...noNumbers.http.calls, ...noText.http.calls]).toHaveLength(0);
  });

  it('shows the catch-all 404 "No send invite"', async () => {
    const ctx = context('sendInvite', {
      groupJid: group(GROUP),
      numbers: '5511999999999',
      text: 'Hi',
    });
    ctx.http.reply(
      'POST',
      '/group/sendInvite/main',
      { status: 404, error: 'Not Found', response: { message: ['No send invite'] } },
      404,
    );
    await expect(execute.sendInvite.call(ctx, 0)).rejects.toMatchObject({
      message: 'Not found: No send invite',
      httpCode: '404',
    });
  });
});

describe('group > revokeInviteCode', () => {
  it('POST /group/revokeInviteCode/:instance { groupJid } and adds the new invite link', async () => {
    const ctx = context('revokeInviteCode', { groupJid: group(GROUP) });
    ctx.http.reply(
      'POST',
      '/group/revokeInviteCode/main',
      { revoked: true, inviteCode: CODE },
      201,
    );

    await expect(execute.revokeInviteCode.call(ctx, 0)).resolves.toEqual({
      revoked: true,
      inviteCode: CODE,
      inviteUrl: `https://chat.whatsapp.com/${CODE}`,
    });
    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.qs).toBeUndefined();
    expect(call.body).toEqual({ groupJid: GROUP });
  });

  it('keeps the response unchanged when it has no invite code', async () => {
    const ctx = context('revokeInviteCode', { groupJid: group(GROUP) });
    ctx.http.reply('POST', '/group/revokeInviteCode/main', { revoked: true }, 201);
    await expect(execute.revokeInviteCode.call(ctx, 0)).resolves.toEqual({ revoked: true });
  });
});

describe('group > leave', () => {
  it('DELETE /group/leaveGroup/:instance?groupJid=', async () => {
    const ctx = context('leave', { groupJid: group(GROUP_ID) });
    ctx.http.reply('DELETE', '/group/leaveGroup/main', { groupJid: GROUP, leave: true });

    const output = await runNode(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('DELETE');
    expect(call.path).toBe('/group/leaveGroup/main');
    expect(call.qs).toEqual({ groupJid: GROUP });
    expect(call.body).toBeUndefined();
    expect(output).toEqual([{ json: { groupJid: GROUP, leave: true }, pairedItem: { item: 0 } }]);
  });

  it('does not retry a 504: the group may already have been left', async () => {
    const ctx = context('leave', { groupJid: group(GROUP) });
    ctx.http.reply('DELETE', '/group/leaveGroup/main', 'Gateway Timeout', 504);
    await expect(execute.leave.call(ctx, 0)).rejects.toMatchObject({ httpCode: '504' });
    expect(ctx.http.calls).toHaveLength(1);
  });
});
