import type {
  IDataObject,
  INodeExecutionData,
  INodeProperties,
  INodePropertyOptions,
} from 'n8n-workflow';

import { EvolutionApi } from '../../nodes/EvolutionApi/EvolutionApi.node';
import { resetRetryPolicy, setRetryPolicy } from '../../nodes/EvolutionApi/GenericFunctions';
import { operations } from '../../nodes/EvolutionApi/resources/profile';
import { description as privacyDescription } from '../../nodes/EvolutionApi/resources/profile/updatePrivacySettings.operation';
import type { MockExecuteFunctions, MockOptions } from '../helpers/mockExecuteFunctions';
import { binaryItem, createMockExecuteFunctions, rl } from '../helpers/mockExecuteFunctions';

// Tests of the profile resource (owned by the profile agent).

beforeEach(() => setRetryPolicy({ sleep: async () => undefined }));
afterEach(() => resetRetryPolicy());

const PRIVACY = {
  readreceipts: 'all',
  profile: 'contacts',
  status: 'contacts',
  online: 'all',
  last: 'contacts',
  groupadd: 'contacts',
};

function profileContext(
  operation: string,
  params: IDataObject = {},
  options: Omit<MockOptions, 'params'> = {},
): MockExecuteFunctions {
  return createMockExecuteFunctions({
    ...options,
    params: { resource: 'profile', operation, instanceName: rl('main', 'list'), ...params },
  });
}

async function run(ctx: MockExecuteFunctions): Promise<INodeExecutionData[]> {
  const [output] = await new EvolutionApi().execute.call(ctx);
  return output;
}

describe('profile resource description', () => {
  it('keeps get as the default operation', () => {
    expect(operations.default).toBe('get');
  });
});

describe('profile > get', () => {
  it('POST /chat/fetchProfile/:instance (own profile)', async () => {
    const ctx = profileContext('get', { number: '' });
    ctx.http.reply('POST', '/chat/fetchProfile/main', { wuid: '1@s.whatsapp.net', name: 'Me' });

    const output = await run(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/chat/fetchProfile/main');
    expect(call.qs).toBeUndefined();
    expect(call.body).toBeUndefined();
    expect(output.map((item) => item.json)).toEqual([{ wuid: '1@s.whatsapp.net', name: 'Me' }]);
    expect(output.every((item) => item.pairedItem !== undefined)).toBe(true);
  });

  it('fetches the profile of a number for every item', async () => {
    const ctx = profileContext(
      'get',
      {},
      {
        items: [{ json: {} }, { json: {} }],
        itemParams: [{ number: '+52 1 55 1234 5678' }, { number: '123@lid' }],
      },
    );
    ctx.http
      .reply('POST', '/chat/fetchProfile/main', { wuid: 'a' })
      .reply('POST', '/chat/fetchProfile/main', { wuid: 'b' });

    const output = await run(ctx);

    expect(ctx.http.calls.map((c) => c.body)).toEqual([
      { number: '5215512345678' },
      { number: '123@lid' },
    ]);
    expect(output.map((item) => item.pairedItem)).toEqual([{ item: 0 }, { item: 1 }]);
  });

  it('shows "not on WhatsApp" for unknown numbers', async () => {
    const ctx = profileContext('get', { number: '5511000000000' });
    ctx.http.reply(
      'POST',
      '/chat/fetchProfile/main',
      {
        status: 400,
        error: 'Bad Request',
        response: {
          message: [
            { jid: '5511000000000@s.whatsapp.net', exists: false, number: '5511000000000' },
          ],
        },
      },
      400,
    );

    const error = (await run(ctx).catch((caught: unknown) => caught)) as Error & {
      httpCode?: string;
    };
    expect(error.httpCode).toBe('400');
    expect(error.message).toContain('is not on WhatsApp');
  });
});

describe('profile > getBusinessProfile', () => {
  it('POST /chat/fetchBusinessProfile/:instance { number }', async () => {
    const ctx = profileContext('getBusinessProfile', { number: '+55 11 99999-9999' });
    const business = {
      isBusiness: true,
      wid: '5511999999999@s.whatsapp.net',
      description: 'Shop',
      website: ['https://shop.example'],
    };
    ctx.http.reply('POST', '/chat/fetchBusinessProfile/main', business);

    const output = await run(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/chat/fetchBusinessProfile/main');
    expect(call.body).toEqual({ number: '5511999999999' });
    expect(output.map((item) => item.json)).toEqual([business]);
  });

  it('sends no body for the instance itself', async () => {
    const ctx = profileContext('getBusinessProfile');
    ctx.http.reply('POST', '/chat/fetchBusinessProfile/main', { isBusiness: false });

    await run(ctx);

    expect(ctx.http.calls[0].body).toBeUndefined();
  });
});

describe('profile > getPicture', () => {
  it('POST /chat/fetchProfilePictureUrl/:instance { number }', async () => {
    const ctx = profileContext('getPicture', { number: '120363025246125486@g.us' });
    ctx.http.reply('POST', '/chat/fetchProfilePictureUrl/main', {
      wuid: '120363025246125486@g.us',
      profilePictureUrl: 'https://pps.whatsapp.net/v/x.jpg',
    });

    const output = await run(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/chat/fetchProfilePictureUrl/main');
    expect(call.body).toEqual({ number: '120363025246125486@g.us' });
    expect(output[0].json).toEqual({
      wuid: '120363025246125486@g.us',
      profilePictureUrl: 'https://pps.whatsapp.net/v/x.jpg',
    });
  });

  it('requires a number', async () => {
    const ctx = profileContext('getPicture', { number: ' ' });
    await expect(run(ctx)).rejects.toThrow('Number is required');
    expect(ctx.http.calls).toHaveLength(0);
  });
});

describe('profile > getPrivacySettings', () => {
  it('GET /chat/fetchPrivacySettings/:instance', async () => {
    const ctx = profileContext('getPrivacySettings');
    ctx.http.reply('GET', '/chat/fetchPrivacySettings/main', PRIVACY);

    const output = await run(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/chat/fetchPrivacySettings/main');
    expect(call.body).toBeUndefined();
    expect(output[0].json).toEqual(PRIVACY);
  });
});

describe('profile > removePicture', () => {
  it('DELETE /chat/removeProfilePicture/:instance without a body', async () => {
    const ctx = profileContext('removePicture');
    ctx.http.reply('DELETE', '/chat/removeProfilePicture/main', { update: 'success' });

    const output = await run(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('DELETE');
    expect(call.path).toBe('/chat/removeProfilePicture/main');
    expect(call.body).toBeUndefined();
    expect(output[0].json).toEqual({ update: 'success' });
  });
});

describe('profile > updateName', () => {
  it('POST /chat/updateProfileName/:instance { name }', async () => {
    const ctx = profileContext('updateName', { profileName: '  Support Bot ' });
    ctx.http.reply('POST', '/chat/updateProfileName/main', { update: 'success' });

    const output = await run(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/chat/updateProfileName/main');
    expect(call.body).toEqual({ name: 'Support Bot' });
    expect(output[0].json).toEqual({ update: 'success' });
  });

  it('requires a name', async () => {
    const ctx = profileContext('updateName', { profileName: '' });
    await expect(run(ctx)).rejects.toThrow('Name is required');
  });
});

describe('profile > updateStatus', () => {
  it('POST /chat/updateProfileStatus/:instance { status }', async () => {
    const ctx = profileContext('updateStatus', { profileStatus: 'Available 9-18h' });
    ctx.http.reply('POST', '/chat/updateProfileStatus/main', { update: 'success' });

    const output = await run(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/chat/updateProfileStatus/main');
    expect(call.body).toEqual({ status: 'Available 9-18h' });
    expect(output[0].json).toEqual({ update: 'success' });
  });

  it('requires the about text', async () => {
    const ctx = profileContext('updateStatus', { profileStatus: ' ' });
    await expect(run(ctx)).rejects.toThrow('About text is required');
  });
});

describe('profile > updatePicture', () => {
  it('sends a URL (default source)', async () => {
    const ctx = profileContext('updatePicture', {
      profilePictureUrl: ' https://cdn.example.com/a.jpg ',
    });
    ctx.http.reply('POST', '/chat/updateProfilePicture/main', { update: 'success' });

    const output = await run(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/chat/updateProfilePicture/main');
    expect(call.body).toEqual({ picture: 'https://cdn.example.com/a.jpg' });
    expect(output[0].json).toEqual({ update: 'success' });
  });

  it('strips the data: prefix of base64 input', async () => {
    const png = Buffer.from('PNGDATA').toString('base64');
    const ctx = profileContext('updatePicture', {
      profilePictureSource: 'base64',
      profilePictureBase64: `data:image/png;base64,${png}`,
    });
    ctx.http.reply('POST', '/chat/updateProfilePicture/main', { update: 'success' });

    await run(ctx);

    expect(ctx.http.calls[0].body).toEqual({ picture: png });
  });

  it('sends an n8n binary file as base64 JSON (the route takes no multipart)', async () => {
    const ctx = profileContext(
      'updatePicture',
      { profilePictureSource: 'binary', binaryPropertyName: 'avatar' },
      {
        items: [
          binaryItem(
            {},
            { avatar: { content: 'JPEGDATA', fileName: 'a.jpg', mimeType: 'image/jpeg' } },
          ),
        ],
      },
    );
    ctx.http.reply('POST', '/chat/updateProfilePicture/main', { update: 'success' });

    await run(ctx);

    expect(ctx.http.calls[0].body).toEqual({
      picture: Buffer.from('JPEGDATA').toString('base64'),
    });
  });

  it('rejects a URL that is not http(s)', async () => {
    const ctx = profileContext('updatePicture', { profilePictureUrl: 'ftp://x/a.jpg' });
    await expect(run(ctx)).rejects.toThrow('Media URL must start with http:// or https://');
    expect(ctx.http.calls).toHaveLength(0);
  });

  it('fails when the binary field is missing', async () => {
    const ctx = profileContext('updatePicture', { profilePictureSource: 'binary' });
    await expect(run(ctx)).rejects.toThrow("binary file 'data'");
  });
});

describe('profile > updatePrivacySettings', () => {
  it('offers only group audiences supported by Baileys', () => {
    const settings = privacyDescription.find((field) => field.name === 'privacySettings');
    const groupadd = (settings?.options as INodeProperties[]).find(
      (field) => field.name === 'groupadd',
    );
    expect((groupadd?.options as INodePropertyOptions[]).map((option) => option.value)).toEqual([
      'all',
      'contacts',
      'contact_blacklist',
    ]);
  });

  it('rejects unsupported groupadd=none before any other privacy setting can be applied', async () => {
    const ctx = profileContext('updatePrivacySettings', {
      privacySettings: { readreceipts: 'none', groupadd: 'none' },
    });

    await expect(run(ctx)).rejects.toThrow('Invalid value "none" for "groupadd"');
    expect(ctx.http.calls).toHaveLength(0);
  });

  it('does not resend an unsupported group audience read from the server', async () => {
    const ctx = profileContext('updatePrivacySettings', { privacySettings: { last: 'none' } });
    ctx.http.reply('GET', '/chat/fetchPrivacySettings/main', { ...PRIVACY, groupadd: 'none' });

    await expect(run(ctx)).rejects.toThrow('Could not read the current value of: groupadd');
    expect(ctx.http.calls).toHaveLength(1);
  });

  it('reads the current settings, merges the changes and sends all six', async () => {
    const ctx = profileContext('updatePrivacySettings', {
      privacySettings: { readreceipts: 'none', last: 'none' },
    });
    ctx.http.reply('GET', '/chat/fetchPrivacySettings/main', PRIVACY);
    const merged = { ...PRIVACY, readreceipts: 'none', last: 'none' };
    ctx.http.reply(
      'POST',
      '/chat/updatePrivacySettings/main',
      { update: 'success', data: merged },
      201,
    );

    const output = await run(ctx);

    expect(ctx.http.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /chat/fetchPrivacySettings/main',
      'POST /chat/updatePrivacySettings/main',
    ]);
    expect(ctx.http.calls[1].body).toEqual(merged);
    expect(output[0].json).toEqual({ update: 'success', data: merged });
  });

  it('requires at least one change and never calls the API', async () => {
    const ctx = profileContext('updatePrivacySettings', { privacySettings: {} });
    await expect(run(ctx)).rejects.toThrow('Add at least one setting to change');
    expect(ctx.http.calls).toHaveLength(0);
  });

  it('rejects values Evolution would refuse', async () => {
    const ctx = profileContext('updatePrivacySettings', { privacySettings: { online: 'none' } });
    await expect(run(ctx)).rejects.toThrow('Invalid value "none" for "online"');
    expect(ctx.http.calls).toHaveLength(0);
  });

  it('asks for the settings whose current value cannot be read', async () => {
    const ctx = profileContext('updatePrivacySettings', { privacySettings: { status: 'none' } });
    ctx.http.reply('GET', '/chat/fetchPrivacySettings/main', {
      ...PRIVACY,
      groupadd: undefined,
      online: 'unexpected',
    });

    await expect(run(ctx)).rejects.toThrow('Could not read the current value of: online, groupadd');
    expect(ctx.http.calls).toHaveLength(1);
  });

  it('skips the read when all six settings are given', async () => {
    const all = {
      readreceipts: 'none',
      profile: 'none',
      status: 'contact_blacklist',
      online: 'match_last_seen',
      last: 'none',
      groupadd: 'all',
    };
    const ctx = profileContext('updatePrivacySettings', { privacySettings: all });
    ctx.http.reply(
      'POST',
      '/chat/updatePrivacySettings/main',
      { update: 'success', data: all },
      201,
    );

    await run(ctx);

    expect(ctx.http.calls).toHaveLength(1);
    expect(ctx.http.calls[0].body).toEqual(all);
  });
});
