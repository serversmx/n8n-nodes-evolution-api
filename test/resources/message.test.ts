import type { IDataObject, INodeProperties, INodePropertyOptions } from 'n8n-workflow';

import { EvolutionApi } from '../../nodes/EvolutionApi/EvolutionApi.node';
import { resetRetryPolicy, setRetryPolicy } from '../../nodes/EvolutionApi/GenericFunctions';
import {
  binaryPassThrough,
  execute,
  fields,
  operations,
} from '../../nodes/EvolutionApi/resources/message';
import {
  assertButtonRules,
  buildQuoted,
  contactWaId,
  ensureFileExtension,
  fileNameFromUrl,
  normalizeMentions,
} from '../../nodes/EvolutionApi/resources/message/helpers';
import {
  binaryItem,
  createMockExecuteFunctions,
  rl,
  TEST_NODE,
} from '../helpers/mockExecuteFunctions';
import type { MockExecuteFunctions, MockOptions } from '../helpers/mockExecuteFunctions';

// Tests of the message resource (owned by the message agent).

beforeEach(() => setRetryPolicy({ sleep: async () => undefined }));
afterEach(() => resetRetryPolicy());

const SENT = {
  key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: true, id: '3EB0SENT' },
  status: 'PENDING',
  messageTimestamp: 1758800000,
};

/** Context for one message operation (instance "main" unless overridden). */
function messageContext(
  operation: string,
  params: IDataObject = {},
  extra: Omit<MockOptions, 'params'> = {},
): MockExecuteFunctions {
  return createMockExecuteFunctions({
    ...extra,
    params: { resource: 'message', operation, instanceName: rl('main', 'list'), ...params },
  });
}

/** Run the whole node and return the JSON of every output item. */
async function runNode(ctx: MockExecuteFunctions): Promise<IDataObject[]> {
  const [output] = await new EvolutionApi().execute.call(ctx);
  return output.map((item) => item.json);
}

function formEntries(form: FormData): Record<string, unknown> {
  const entries: Record<string, unknown> = {};
  form.forEach((value, key) => {
    entries[key] = value;
  });
  return entries;
}

const ROUTES: Record<string, string> = {
  sendAudio: 'sendWhatsAppAudio',
  sendButtons: 'sendButtons',
  sendCarousel: 'sendCarousel',
  sendContact: 'sendContact',
  sendList: 'sendList',
  sendLocation: 'sendLocation',
  sendMedia: 'sendMedia',
  sendPoll: 'sendPoll',
  sendPtv: 'sendPtv',
  sendReaction: 'sendReaction',
  sendStatus: 'sendStatus',
  sendSticker: 'sendSticker',
  sendTemplate: 'sendTemplate',
  sendText: 'sendText',
};

/** Every operation: the send routes plus GET /baileys/generateMessageID (2.4). */
const OPERATIONS = [...Object.keys(ROUTES), 'generateMessageId'].sort();

describe('message resource structure', () => {
  const options = operations.options as INodePropertyOptions[];

  it('exposes every send route of 2.3.7, sendCarousel and generateMessageId (2.4), with sendText as default', () => {
    expect(options.map((option) => option.value).sort()).toEqual(OPERATIONS);
    expect(operations.default).toBe('sendText');
    expect(Object.keys(execute).sort()).toEqual(OPERATIONS);
  });

  it('uses the operation names/actions of the spec, sorted by name', () => {
    const byValue = Object.fromEntries(options.map((o) => [o.value, o]));
    expect(byValue.sendAudio).toMatchObject({ name: 'Send Audio', action: 'Send a voice message' });
    expect(byValue.sendPtv).toMatchObject({ name: 'Send Video Note', action: 'Send a video note' });
    expect(byValue.sendStatus).toMatchObject({ action: 'Post a status (story)' });
    expect(byValue.sendReaction).toMatchObject({ action: 'React to a message' });
    expect(byValue.generateMessageId).toMatchObject({
      name: 'Generate Message ID',
      action: 'Generate a message ID',
    });
    expect(byValue.sendCarousel.description).toContain('Requires Evolution API 2.4+');
    expect(byValue.generateMessageId.description).toContain('Requires Evolution API 2.4+');
    const names = options.map((o) => o.name);
    expect(names).toEqual([...names].sort());
  });

  it('marks every 2.4-only option and keeps option collections sorted', () => {
    const collections = fields.filter((field) => field.name === 'options');
    for (const collection of collections) {
      const children = collection.options as INodeProperties[];
      const names = children.map((child) => child.displayName);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
      for (const child of children) {
        if (['messageId', 'gifPlayback', 'gifAttribution'].includes(child.name)) {
          expect(child.description).toContain('Requires Evolution API 2.4+');
        }
      }
    }
    // 2.3.7 ignores "quoted" on voice notes.
    const audio = collections.find((c) =>
      (c.displayOptions?.show?.operation as string[]).includes('sendAudio'),
    );
    for (const name of ['quotedMessage', 'quotedMessageId']) {
      const option = (audio?.options as INodeProperties[]).find((o) => o.name === name);
      expect(option?.description).toContain('Requires Evolution API 2.4+');
    }
    // Only the routes whose service reads it expose a custom message ID.
    const withMessageId = collections
      .filter((c) => (c.options as INodeProperties[]).some((o) => o.name === 'messageId'))
      .flatMap((c) => c.displayOptions?.show?.operation as string[]);
    expect(withMessageId.sort()).toEqual([
      'sendMedia',
      'sendPoll',
      'sendPtv',
      'sendSticker',
      'sendText',
    ]);
  });

  it('only uses display conditions on fields and values of the same operation', () => {
    const problems: string[] = [];
    for (const operation of OPERATIONS) {
      const own = fields.filter((field) =>
        (field.displayOptions?.show?.operation as string[]).includes(operation),
      );
      const byName = new Map<string, INodeProperties[]>();
      for (const field of own) byName.set(field.name, [...(byName.get(field.name) ?? []), field]);
      const check = (
        label: string,
        show: IDataObject,
        siblings: Map<string, INodeProperties[]>,
      ) => {
        for (const [key, values] of Object.entries(show)) {
          if (key === 'resource' || key === 'operation') continue;
          const controllers = key.startsWith('/') ? byName.get(key.slice(1)) : siblings.get(key);
          if (!controllers) {
            problems.push(`${operation}: ${label} depends on missing "${key}"`);
            continue;
          }
          for (const value of values as unknown[]) {
            const allowed = controllers.flatMap((controller) =>
              controller.type === 'boolean'
                ? [true, false]
                : ((controller.options ?? []) as INodePropertyOptions[]).map((o) => o.value),
            );
            if (!allowed.includes(value as string)) {
              problems.push(`${operation}: ${label} depends on ${key}=${String(value)}`);
            }
          }
        }
      };
      const visitChildren = (parent: string, children: INodeProperties[]) => {
        const siblings = new Map(children.map((child) => [child.name, [child]]));
        for (const child of children) {
          check(
            `${parent}.${child.name}`,
            (child.displayOptions?.show ?? {}) as IDataObject,
            siblings,
          );
          const nested = child.options as Array<INodeProperties | { values?: INodeProperties[] }>;
          for (const entry of nested ?? []) {
            if ('values' in entry && entry.values)
              visitChildren(`${parent}.${child.name}`, entry.values);
          }
        }
      };
      for (const field of own) {
        check(field.name, (field.displayOptions?.show ?? {}) as IDataObject, byName);
        if (field.type === 'collection')
          visitChildren(field.name, field.options as INodeProperties[]);
        if (field.type === 'fixedCollection') {
          for (const group of field.options as Array<{ values: INodeProperties[] }>) {
            visitChildren(field.name, group.values);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('keeps the input binary after sending files', () => {
    expect([...binaryPassThrough].sort()).toEqual([
      'sendAudio',
      'sendMedia',
      'sendPtv',
      'sendStatus',
      'sendSticker',
    ]);
  });
});

describe('message route contract (whole node, 2 items each)', () => {
  const number = '5511999999999';
  const reply = { type: 'reply', displayText: 'OK' };
  const cases: Array<[string, IDataObject, 'GET' | 'POST', string]> = [
    ['generateMessageId', {}, 'GET', '/baileys/generateMessageID/main'],
    [
      'sendAudio',
      { number, mediaUrl: 'https://e.com/a.mp3' },
      'POST',
      '/message/sendWhatsAppAudio/main',
    ],
    [
      'sendButtons',
      { number, buttonsTitle: 'T', buttons: { button: [reply] } },
      'POST',
      '/message/sendButtons/main',
    ],
    [
      'sendCarousel',
      { number, carouselBody: 'B', carouselCards: { card: [{ body: 'C', buttons: [reply] }] } },
      'POST',
      '/message/sendCarousel/main',
    ],
    [
      'sendContact',
      { number, contactCards: { contact: [{ fullName: 'A', phoneNumber: '+55 11 98888-7777' }] } },
      'POST',
      '/message/sendContact/main',
    ],
    [
      'sendList',
      {
        number,
        listTitle: 'T',
        listButtonText: 'Open',
        listSections: { section: [{ title: 'S', rows: { row: [{ title: 'R', rowId: 'r' }] } }] },
      },
      'POST',
      '/message/sendList/main',
    ],
    ['sendLocation', { number, latitude: 1, longitude: 2 }, 'POST', '/message/sendLocation/main'],
    ['sendMedia', { number, mediaUrl: 'https://e.com/a.jpg' }, 'POST', '/message/sendMedia/main'],
    [
      'sendPoll',
      { number, pollQuestion: 'Q', pollOptions: 'A\nB' },
      'POST',
      '/message/sendPoll/main',
    ],
    ['sendPtv', { number, mediaUrl: 'https://e.com/a.mp4' }, 'POST', '/message/sendPtv/main'],
    [
      'sendReaction',
      { remoteJid: `${number}@s.whatsapp.net`, messageId: '3EB0X' },
      'POST',
      '/message/sendReaction/main',
    ],
    ['sendStatus', { text: 'Hi', statusRecipients: number }, 'POST', '/message/sendStatus/main'],
    [
      'sendSticker',
      { number, mediaUrl: 'https://e.com/a.png' },
      'POST',
      '/message/sendSticker/main',
    ],
    ['sendTemplate', { number, templateName: 'hello_world' }, 'POST', '/message/sendTemplate/main'],
    ['sendText', { number, text: 'Hi' }, 'POST', '/message/sendText/main'],
  ];

  it('covers every operation', () => {
    expect(cases.map(([operation]) => operation).sort()).toEqual(OPERATIONS);
  });

  it.each(cases)('%s → %s %s', async (operation, params, method, path) => {
    const ctx = createMockExecuteFunctions({
      items: [{ json: { n: 1 } }, { json: { n: 2 } }],
      params: { resource: 'message', operation, instanceName: rl('main', 'list'), ...params },
    });
    const responses =
      method === 'GET'
        ? [{ id: '3EB0A' }, { id: '3EB0B' }]
        : [
            { ...SENT, key: { ...SENT.key, id: '3EB0A' } },
            { ...SENT, key: { ...SENT.key, id: '3EB0B' } },
          ];
    for (const response of responses) {
      ctx.http.reply(method, path, response, method === 'GET' ? 200 : 201);
    }

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      `${method} ${path}`,
      `${method} ${path}`,
    ]);
    // Never forwards query parameters (EVOAPI-3: ?instanceName overrides the path instance).
    expect(ctx.http.calls.every((call) => call.qs === undefined)).toBe(true);
    expect(ctx.http.calls.every((call) => call.headers.apikey === 'test-api-key')).toBe(true);
    if (method === 'GET') expect(ctx.http.calls[0].body).toBeUndefined();
    expect(output.map((item) => item.json)).toEqual(responses);
    expect(output.map((item) => item.pairedItem)).toEqual([{ item: 0 }, { item: 1 }]);
    expect(ctx.http.pending).toEqual([]);
  });
});

describe('message > sendText', () => {
  it('POST /message/sendText/:instance', async () => {
    const ctx = messageContext('sendText', {
      number: '5511999999999',
      text: 'Hola',
      options: { delay: 1200, linkPreview: false },
    });
    ctx.http.reply('POST', '/message/sendText/main', { key: { id: 'MSG' } });

    const [output] = await new EvolutionApi().execute.call(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/message/sendText/main');
    expect(call.qs).toBeUndefined();
    expect(call.body).toEqual({
      number: '5511999999999',
      text: 'Hola',
      delay: 1200,
      linkPreview: false,
    });
    expect(output.map((item) => item.json)).toEqual([{ key: { id: 'MSG' } }]);
    expect(output.every((item) => item.pairedItem !== undefined)).toBe(true);
  });

  it('sends reply, mentions and the 2.4 custom message ID', async () => {
    const ctx = messageContext('sendText', {
      number: '120363025246125888@g.us',
      text: 'Hi @5215512345678',
      options: {
        quotedMessageId: ' 3EB0QUOTED ',
        mentioned: '+52 1 55 1234 5678, 123456789012345@lid',
        mentionsEveryOne: true,
        messageId: '3EB0CUSTOM',
        delay: 0,
      },
    });
    ctx.http.reply('POST', '/message/sendText/main', SENT, 201);

    const result = await execute.sendText.call(ctx, 0);

    expect(ctx.http.calls[0].body).toEqual({
      number: '120363025246125888@g.us',
      text: 'Hi @5215512345678',
      quoted: { key: { id: '3EB0QUOTED' } },
      mentionsEveryOne: true,
      mentioned: ['5215512345678', '123456789012345@lid'],
      messageId: '3EB0CUSTOM',
    });
    expect(result).toEqual(SENT);
  });

  it('drops the "@" of mentions written as in the text (schema: items start with digits)', async () => {
    const ctx = messageContext('sendText', {
      number: '120363025246125888@g.us',
      text: 'Hi @5215512345678 and @123456789012345',
      options: { mentioned: '@5215512345678; @123456789012345@lid\n@5215512345678' },
    });
    ctx.http.reply('POST', '/message/sendText/main', SENT, 201);

    await execute.sendText.call(ctx, 0);

    expect((ctx.http.calls[0].body as IDataObject).mentioned).toEqual([
      '5215512345678',
      '123456789012345@lid',
    ]);
  });

  it('quotes a full message taken from a webhook body', async () => {
    const webhook = {
      event: 'messages.upsert',
      data: {
        key: {
          id: '3EB0ORIG',
          remoteJid: '5511999999999@s.whatsapp.net',
          fromMe: 'false',
          participant: null,
        },
        message: { conversation: 'Original' },
      },
    };
    const ctx = messageContext('sendText', {
      number: '5511999999999@s.whatsapp.net',
      text: 'Reply',
      options: { quotedMessage: JSON.stringify(webhook), quotedMessageId: 'IGNORED' },
    });
    ctx.http.reply('POST', '/message/sendText/main', SENT, 201);

    await execute.sendText.call(ctx, 0);

    expect((ctx.http.calls[0].body as IDataObject).quoted).toEqual({
      key: { id: '3EB0ORIG', remoteJid: '5511999999999@s.whatsapp.net', fromMe: false },
      message: { conversation: 'Original' },
    });
  });

  it('keeps @lid, @newsletter and group JIDs and strips phone formatting', async () => {
    const recipients = [
      ['123456789012345@lid', '123456789012345@lid'],
      ['120363400000000000@newsletter', '120363400000000000@newsletter'],
      ['120363025246125888@g.us', '120363025246125888@g.us'],
      ['+52 1 (55) 1234-5678', '5215512345678'],
    ];
    const ctx = createMockExecuteFunctions({
      items: recipients.map(() => ({ json: {} })),
      params: { resource: 'message', operation: 'sendText', instanceName: 'main', text: 'x' },
      itemParams: recipients.map(([number]) => ({ number })),
    });
    for (let i = 0; i < recipients.length; i++) {
      ctx.http.reply('POST', '/message/sendText/main', { key: { id: `M${i}` } }, 201);
    }

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(ctx.http.calls.map((call) => (call.body as IDataObject).number)).toEqual(
      recipients.map(([, expected]) => expected),
    );
    expect(output.map((item) => item.pairedItem)).toEqual([
      { item: 0 },
      { item: 1 },
      { item: 2 },
      { item: 3 },
    ]);
    expect(ctx.http.pending).toEqual([]);
  });

  it('continues on fail per item and shows Evolution errors (unknown number)', async () => {
    const ctx = createMockExecuteFunctions({
      items: [{ json: {} }, { json: {} }],
      continueOnFail: true,
      params: { resource: 'message', operation: 'sendText', instanceName: 'main', text: 'x' },
      itemParams: [{ number: '5511000000000' }, { number: '5511999999999' }],
    });
    ctx.http.reply(
      'POST',
      '/message/sendText/main',
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
    ctx.http.reply('POST', '/message/sendText/main', SENT, 201);

    const output = await runNode(ctx);

    expect(output).toHaveLength(2);
    expect(output[0]).toMatchObject({
      error:
        'Bad request: The number 5511000000000 (5511000000000@s.whatsapp.net) is not on WhatsApp',
      httpCode: '400',
    });
    expect(output[1]).toEqual(SENT);
  });

  it('turns a Cloud API error answered with 201 into an error', async () => {
    const ctx = messageContext('sendText', { number: '5511999999999', text: 'x' });
    ctx.http.reply(
      'POST',
      '/message/sendText/main',
      {
        message: '(#131030) Recipient phone number not in allowed list',
        type: 'OAuthException',
        code: 131030,
        error_data: { messaging_product: 'whatsapp', details: 'Add the number to the list' },
        fbtrace_id: 'AbC',
      },
      201,
    );

    await expect(execute.sendText.call(ctx, 0)).rejects.toThrow(
      'WhatsApp Cloud API rejected the message: (#131030) Recipient phone number not in allowed list; Add the number to the list',
    );
  });

  it('rejects an invalid Reply To Message (JSON) before calling the API', async () => {
    const ctx = messageContext('sendText', {
      number: '5511999999999',
      text: 'x',
      options: { quotedMessage: '{"message":{"conversation":"no key"}}' },
    });
    await expect(execute.sendText.call(ctx, 0)).rejects.toThrow(
      'Reply To Message (JSON) must be a message object with "key.id"',
    );
    expect(ctx.http.calls).toHaveLength(0);
  });

  it('validates number and text before calling the API', async () => {
    const ctx = createMockExecuteFunctions({
      params: {
        resource: 'message',
        operation: 'sendText',
        instanceName: 'main',
        number: ' ',
        text: 'x',
      },
    });
    await expect(new EvolutionApi().execute.call(ctx)).rejects.toThrow('Number is required');
    const empty = messageContext('sendText', { number: '5511999999999', text: '   ' });
    await expect(execute.sendText.call(empty, 0)).rejects.toThrow('Text is required');
    expect(ctx.http.calls).toHaveLength(0);
    expect(empty.http.calls).toHaveLength(0);
  });

  it('uses the credential default instance when none is selected', async () => {
    const ctx = createMockExecuteFunctions({
      credentials: { defaultInstance: 'my instance' },
      params: { resource: 'message', operation: 'sendText', number: '5511999999999', text: 'x' },
    });
    ctx.http.reply('POST', '/message/sendText/my%20instance', SENT, 201);
    await execute.sendText.call(ctx, 0);
    expect(ctx.http.calls[0].path).toBe('/message/sendText/my%20instance');
  });
});

describe('message > sendMedia', () => {
  it('sends a URL as JSON with caption and file name', async () => {
    const ctx = messageContext('sendMedia', {
      number: '5511999999999',
      mediatype: 'document',
      mediaSource: 'url',
      mediaUrl: 'https://files.example.com/invoice.pdf',
      caption: 'Your invoice',
      options: { fileName: 'invoice-123.pdf', delay: 500, messageId: '3EB0ID' },
    });
    ctx.http.reply('POST', '/message/sendMedia/main', SENT, 201);

    const result = await execute.sendMedia.call(ctx, 0);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/message/sendMedia/main');
    expect(call.body).toEqual({
      number: '5511999999999',
      mediatype: 'document',
      caption: 'Your invoice',
      fileName: 'invoice-123.pdf',
      media: 'https://files.example.com/invoice.pdf',
      delay: 500,
      messageId: '3EB0ID',
    });
    expect(result).toEqual(SENT);
  });

  it('uploads an n8n binary as multipart "file" when every field is a string', async () => {
    const ctx = messageContext(
      'sendMedia',
      {
        number: '+55 11 99999-9999',
        mediatype: 'image',
        mediaSource: 'binary',
        binaryPropertyName: 'photo',
        caption: 'Look',
        options: { quotedMessageId: '3EB0Q', mentioned: '5511888888888' },
      },
      {
        items: [
          binaryItem(
            {},
            { photo: { content: 'PNGDATA', fileName: 'a.png', mimeType: 'image/png' } },
          ),
        ],
      },
    );
    ctx.http.reply('POST', '/message/sendMedia/main', SENT, 201);

    await execute.sendMedia.call(ctx, 0);

    const form = ctx.http.calls[0].body as FormData;
    expect(form).toBeInstanceOf(FormData);
    const entries = formEntries(form);
    expect(entries).toMatchObject({
      number: '5511999999999',
      mediatype: 'image',
      caption: 'Look',
      fileName: 'a.png',
      mimetype: 'image/png',
      'quoted[key][id]': '3EB0Q',
      'mentioned[0]': '5511888888888',
    });
    expect(entries.media).toBeUndefined();
    const file = form.get('file') as File;
    expect(file.name).toBe('a.png');
    expect(file.type).toBe('image/png');
    expect(Buffer.from(await file.arrayBuffer()).toString()).toBe('PNGDATA');
  });

  it('falls back to JSON + base64 for a binary when a numeric option is set', async () => {
    const ctx = messageContext(
      'sendMedia',
      {
        number: '5511999999999',
        mediatype: 'video',
        mediaSource: 'binary',
        options: { delay: 1000, gifPlayback: true, gifAttribution: 2 },
      },
      {
        items: [
          binaryItem({}, { data: { content: 'MP4', fileName: 'clip', mimeType: 'video/mp4' } }),
        ],
      },
    );
    ctx.http.reply('POST', '/message/sendMedia/main', SENT, 201);

    await execute.sendMedia.call(ctx, 0);

    expect(ctx.http.calls[0].body).toEqual({
      number: '5511999999999',
      mediatype: 'video',
      fileName: 'clip.mp4',
      mimetype: 'video/mp4',
      gifPlayback: true,
      gifAttribution: 2,
      delay: 1000,
      media: Buffer.from('MP4').toString('base64'),
    });
  });

  it('sends the 2.4 GIF options as strings in multipart', async () => {
    const ctx = messageContext(
      'sendMedia',
      {
        number: '5511999999999',
        mediatype: 'video',
        mediaSource: 'binary',
        options: { gifPlayback: true, gifAttribution: 1 },
      },
      {
        items: [
          binaryItem({}, { data: { content: 'MP4', fileName: 'a.mp4', mimeType: 'video/mp4' } }),
        ],
      },
    );
    ctx.http.reply('POST', '/message/sendMedia/main', SENT, 201);

    await execute.sendMedia.call(ctx, 0);

    const entries = formEntries(ctx.http.calls[0].body as FormData);
    expect(entries).toMatchObject({ gifPlayback: 'true', gifAttribution: '1' });
  });

  it('strips a data: URI and ignores GIF options and caption where they do not apply', async () => {
    const ctx = messageContext('sendMedia', {
      number: '5511999999999',
      mediatype: 'audio',
      mediaSource: 'base64',
      mediaBase64: 'data:audio/mpeg;base64,SUQz',
      caption: 'ignored',
      options: { gifPlayback: true },
    });
    ctx.http.reply('POST', '/message/sendMedia/main', SENT, 201);

    await execute.sendMedia.call(ctx, 0);

    expect(ctx.http.calls[0].body).toEqual({
      number: '5511999999999',
      mediatype: 'audio',
      mimetype: 'audio/mpeg',
      media: 'SUQz',
    });
  });

  it('names a document sent from a URL after the URL (Evolution would send mimetype "false")', async () => {
    const ctx = messageContext('sendMedia', {
      number: '5511999999999',
      mediatype: 'document',
      mediaSource: 'url',
      mediaUrl: 'https://files.example.com/docs/Invoice%20123.pdf?token=abc',
    });
    ctx.http.reply('POST', '/message/sendMedia/main', SENT, 201);

    await execute.sendMedia.call(ctx, 0);

    expect(ctx.http.calls[0].body).toEqual({
      number: '5511999999999',
      mediatype: 'document',
      fileName: 'Invoice 123.pdf',
      media: 'https://files.example.com/docs/Invoice%20123.pdf?token=abc',
    });
  });

  it('completes an extension-less file name from the URL or the MIME Type option', async () => {
    const fromUrl = messageContext('sendMedia', {
      number: '5511999999999',
      mediatype: 'document',
      mediaSource: 'url',
      mediaUrl: 'https://files.example.com/a/report.xlsx',
      options: { fileName: 'March report' },
    });
    fromUrl.http.reply('POST', '/message/sendMedia/main', SENT, 201);
    await execute.sendMedia.call(fromUrl, 0);
    expect(fromUrl.http.calls[0].body).toMatchObject({ fileName: 'March report.xlsx' });

    const fromMime = messageContext('sendMedia', {
      number: '5511999999999',
      mediatype: 'document',
      mediaSource: 'url',
      mediaUrl: 'https://api.example.com/files/123',
      options: { mimetype: 'application/pdf' },
    });
    fromMime.http.reply('POST', '/message/sendMedia/main', SENT, 201);
    await execute.sendMedia.call(fromMime, 0);
    expect(fromMime.http.calls[0].body).toMatchObject({
      fileName: 'document.pdf',
      mimetype: 'application/pdf',
    });
  });

  it('gives extension-less image and video names the extension Evolution produces', async () => {
    const ctx = createMockExecuteFunctions({
      items: [
        binaryItem({}, { data: { content: 'IMG', fileName: 'file', mimeType: 'image/heic' } }),
        binaryItem({}, { data: { content: 'VID', fileName: 'clip', mimeType: 'video/x-unknown' } }),
      ],
      params: {
        resource: 'message',
        operation: 'sendMedia',
        instanceName: 'main',
        number: '5511999999999',
        mediaSource: 'binary',
      },
      itemParams: [{ mediatype: 'image' }, { mediatype: 'video' }],
    });
    ctx.http.reply('POST', '/message/sendMedia/main', SENT, 201);
    ctx.http.reply('POST', '/message/sendMedia/main', SENT, 201);

    await runNode(ctx);

    const names = ctx.http.calls.map((call) => (call.body as FormData).get('fileName'));
    expect(names).toEqual(['file.jpg', 'clip.mp4']);
  });

  it('requires a file name for a document URL without extension', async () => {
    const ctx = messageContext('sendMedia', {
      number: '5511999999999',
      mediatype: 'document',
      mediaSource: 'url',
      mediaUrl: 'https://drive.example.com/uc?export=download&id=XYZ',
    });
    await expect(execute.sendMedia.call(ctx, 0)).rejects.toThrow(
      'A file name is required to send a document from a URL without a file extension',
    );
    expect(ctx.http.calls).toHaveLength(0);
  });

  it('requires a file name for base64 documents', async () => {
    const ctx = messageContext('sendMedia', {
      number: '5511999999999',
      mediatype: 'document',
      mediaSource: 'base64',
      mediaBase64: 'JVBERi0=',
    });
    await expect(execute.sendMedia.call(ctx, 0)).rejects.toThrow(
      'A file name is required to send a document from base64 or binary data',
    );
    expect(ctx.http.calls).toHaveLength(0);
  });

  it('rejects non-http URLs and missing binaries', async () => {
    const ctx = messageContext('sendMedia', {
      number: '5511999999999',
      mediaSource: 'url',
      mediaUrl: 'ftp://example.com/a.jpg',
    });
    await expect(execute.sendMedia.call(ctx, 0)).rejects.toThrow(
      'Media URL must start with http:// or https://',
    );
    const noBinary = messageContext('sendMedia', {
      number: '5511999999999',
      mediaSource: 'binary',
    });
    await expect(execute.sendMedia.call(noBinary, 0)).rejects.toThrow("binary file 'data'");
  });

  it('keeps the input binary on the output item (node run)', async () => {
    const item = binaryItem(
      { id: 1 },
      { data: { content: 'PNG', fileName: 'a.png', mimeType: 'image/png' } },
    );
    const ctx = messageContext(
      'sendMedia',
      { number: '5511999999999', mediatype: 'image', mediaSource: 'binary' },
      { items: [item] },
    );
    ctx.http.reply('POST', '/message/sendMedia/main', SENT, 201);

    const [output] = await new EvolutionApi().execute.call(ctx);

    expect(output).toHaveLength(1);
    expect(output[0].json).toEqual(SENT);
    expect(output[0].binary).toBe(item.binary);
    expect(output[0].pairedItem).toEqual({ item: 0 });
  });

  it('shows Evolution validation errors', async () => {
    const ctx = messageContext('sendMedia', {
      number: '5511999999999',
      mediaSource: 'url',
      mediaUrl: 'https://example.com/a.jpg',
    });
    ctx.http.reply(
      'POST',
      '/message/sendMedia/main',
      {
        status: 400,
        error: 'Bad Request',
        response: { message: ['Owned media must be a url or base64'] },
      },
      400,
    );
    await expect(new EvolutionApi().execute.call(ctx)).rejects.toMatchObject({
      message: 'Bad request: Owned media must be a url or base64',
      httpCode: '400',
    });
    // Send routes are never retried on 5xx (no duplicate messages).
    const retry = messageContext('sendMedia', {
      number: '5511999999999',
      mediaSource: 'url',
      mediaUrl: 'https://example.com/a.jpg',
    });
    retry.http.reply('POST', '/message/sendMedia/main', { message: 'Bad gateway' }, 502);
    await expect(execute.sendMedia.call(retry, 0)).rejects.toMatchObject({ httpCode: '502' });
    expect(retry.http.calls).toHaveLength(1);
  });
});

describe('message > sendPtv', () => {
  it('sends a video URL in "video"', async () => {
    const ctx = messageContext('sendPtv', {
      number: '5511999999999',
      mediaSource: 'url',
      mediaUrl: 'https://example.com/note.mp4',
      options: { messageId: '3EB0PTV', quotedMessageId: 'Q1' },
    });
    ctx.http.reply('POST', '/message/sendPtv/main', SENT, 201);

    const result = await execute.sendPtv.call(ctx, 0);

    expect(ctx.http.calls[0].path).toBe('/message/sendPtv/main');
    expect(ctx.http.calls[0].body).toEqual({
      number: '5511999999999',
      video: 'https://example.com/note.mp4',
      quoted: { key: { id: 'Q1' } },
      messageId: '3EB0PTV',
    });
    expect(result).toEqual(SENT);
  });

  it('uploads a binary video as multipart', async () => {
    const ctx = messageContext(
      'sendPtv',
      { number: '5511999999999', mediaSource: 'binary' },
      {
        items: [
          binaryItem({}, { data: { content: 'MP4', fileName: 'n.mp4', mimeType: 'video/mp4' } }),
        ],
      },
    );
    ctx.http.reply('POST', '/message/sendPtv/main', SENT, 201);

    await execute.sendPtv.call(ctx, 0);

    const form = ctx.http.calls[0].body as FormData;
    expect(formEntries(form).number).toBe('5511999999999');
    expect((form.get('file') as File).name).toBe('n.mp4');
    expect(form.get('video')).toBeNull();
  });
});

describe('message > sendAudio', () => {
  it('POST /message/sendWhatsAppAudio with the audio URL and a reply', async () => {
    const ctx = messageContext('sendAudio', {
      number: '5511999999999',
      mediaSource: 'url',
      mediaUrl: 'https://example.com/voice.mp3',
      options: { delay: 3000, quotedMessageId: 'Q2' },
    });
    ctx.http.reply('POST', '/message/sendWhatsAppAudio/main', SENT, 201);

    const result = await execute.sendAudio.call(ctx, 0);

    expect(ctx.http.calls[0].path).toBe('/message/sendWhatsAppAudio/main');
    expect(ctx.http.calls[0].body).toEqual({
      number: '5511999999999',
      audio: 'https://example.com/voice.mp3',
      delay: 3000,
      quoted: { key: { id: 'Q2' } },
    });
    expect(result).toEqual(SENT);
  });

  it('uploads a binary as multipart and omits the default encoding', async () => {
    const ctx = messageContext(
      'sendAudio',
      { number: '5511999999999', mediaSource: 'binary', options: { encoding: true } },
      {
        items: [
          binaryItem({}, { data: { content: 'OGG', fileName: 'v.ogg', mimeType: 'audio/ogg' } }),
        ],
      },
    );
    ctx.http.reply('POST', '/message/sendWhatsAppAudio/main', SENT, 201);

    await execute.sendAudio.call(ctx, 0);

    const form = ctx.http.calls[0].body as FormData;
    expect(formEntries(form)).toMatchObject({ number: '5511999999999' });
    expect(form.get('encoding')).toBeNull();
    expect((form.get('file') as File).name).toBe('v.ogg');
  });

  it('sends encoding: false as JSON (multipart "false" would be truthy)', async () => {
    const ctx = messageContext(
      'sendAudio',
      { number: '5511999999999', mediaSource: 'binary', options: { encoding: false } },
      {
        items: [
          binaryItem({}, { data: { content: 'OGG', fileName: 'v.ogg', mimeType: 'audio/ogg' } }),
        ],
      },
    );
    ctx.http.reply('POST', '/message/sendWhatsAppAudio/main', SENT, 201);

    await execute.sendAudio.call(ctx, 0);

    expect(ctx.http.calls[0].body).toEqual({
      number: '5511999999999',
      encoding: false,
      audio: Buffer.from('OGG').toString('base64'),
    });
  });
});

describe('message > sendSticker', () => {
  it('always inlines binaries as base64 JSON (the multipart path is broken server side)', async () => {
    const ctx = messageContext(
      'sendSticker',
      {
        number: '5511999999999',
        mediaSource: 'binary',
        options: { notConvertSticker: true, messageId: '3EB0ST' },
      },
      {
        items: [
          binaryItem({}, { data: { content: 'WEBP', fileName: 's.webp', mimeType: 'image/webp' } }),
        ],
      },
    );
    ctx.http.reply('POST', '/message/sendSticker/main', SENT, 201);

    const result = await execute.sendSticker.call(ctx, 0);

    expect(ctx.http.calls[0].path).toBe('/message/sendSticker/main');
    expect(ctx.http.calls[0].body).toEqual({
      number: '5511999999999',
      notConvertSticker: true,
      messageId: '3EB0ST',
      sticker: Buffer.from('WEBP').toString('base64'),
    });
    expect(result).toEqual(SENT);
  });

  it('sends a URL and refuses "Already WebP" with a URL', async () => {
    const ctx = messageContext('sendSticker', {
      number: '5511999999999',
      mediaSource: 'url',
      mediaUrl: 'https://example.com/cat.gif',
    });
    ctx.http.reply('POST', '/message/sendSticker/main', SENT, 201);
    await execute.sendSticker.call(ctx, 0);
    expect(ctx.http.calls[0].body).toEqual({
      number: '5511999999999',
      sticker: 'https://example.com/cat.gif',
    });

    const invalid = messageContext('sendSticker', {
      number: '5511999999999',
      mediaSource: 'url',
      mediaUrl: 'https://example.com/cat.webp',
      options: { notConvertSticker: true },
    });
    await expect(execute.sendSticker.call(invalid, 0)).rejects.toThrow(
      'Already WebP needs Base64 or Binary File input',
    );
    expect(invalid.http.calls).toHaveLength(0);
  });
});

describe('message > sendLocation', () => {
  it('sends coordinates, name and address (schema-required keys)', async () => {
    const ctx = messageContext('sendLocation', {
      number: '5215512345678',
      latitude: 19.4326077,
      longitude: '-99.133208',
      locationName: ' Zócalo ',
      options: { delay: 250, mentionsEveryOne: false },
    });
    ctx.http.reply('POST', '/message/sendLocation/main', SENT, 201);

    const result = await execute.sendLocation.call(ctx, 0);

    expect(ctx.http.calls[0].path).toBe('/message/sendLocation/main');
    expect(ctx.http.calls[0].body).toEqual({
      number: '5215512345678',
      latitude: 19.4326077,
      longitude: -99.133208,
      name: 'Zócalo',
      address: '',
      delay: 250,
    });
    expect(result).toEqual(SENT);
  });

  it('validates coordinates', async () => {
    const ctx = messageContext('sendLocation', {
      number: '5215512345678',
      latitude: 91,
      longitude: 0,
    });
    await expect(execute.sendLocation.call(ctx, 0)).rejects.toThrow(
      'Latitude must be a number between -90 and 90',
    );
    const lng = messageContext('sendLocation', {
      number: '5215512345678',
      latitude: 0,
      longitude: 'abc',
    });
    await expect(execute.sendLocation.call(lng, 0)).rejects.toThrow(
      'Longitude must be a number between -180 and 180',
    );
  });
});

describe('message > sendContact', () => {
  it('sends vCards with a digits-only WhatsApp ID', async () => {
    const ctx = messageContext('sendContact', {
      number: '5511999999999',
      contactCards: {
        contact: [
          {
            fullName: 'Jane Doe',
            phoneNumber: '+52 1 55 1234 5678',
            organization: 'ACME',
            email: 'jane@example.com',
            url: '',
          },
          {
            fullName: 'John',
            phoneNumber: '+55 11 98888-7777',
            wuid: '5511988887777@s.whatsapp.net',
          },
        ],
      },
    });
    ctx.http.reply('POST', '/message/sendContact/main', SENT, 201);

    const result = await execute.sendContact.call(ctx, 0);

    expect(ctx.http.calls[0].path).toBe('/message/sendContact/main');
    expect(ctx.http.calls[0].body).toEqual({
      number: '5511999999999',
      contact: [
        {
          fullName: 'Jane Doe',
          phoneNumber: '+52 1 55 1234 5678',
          wuid: '525512345678',
          organization: 'ACME',
          email: 'jane@example.com',
        },
        { fullName: 'John', phoneNumber: '+55 11 98888-7777', wuid: '5511988887777' },
      ],
    });
    expect(result).toEqual(SENT);
  });

  it('validates contacts', async () => {
    const none = messageContext('sendContact', { number: '5511999999999' });
    await expect(execute.sendContact.call(none, 0)).rejects.toThrow('Add at least one contact');
    const short = messageContext('sendContact', {
      number: '5511999999999',
      contactCards: { contact: [{ fullName: 'A', phoneNumber: '12345' }] },
    });
    await expect(execute.sendContact.call(short, 0)).rejects.toThrow(
      'Contact 1: Phone Number must include the country code (at least 10 digits)',
    );
  });

  it('never drops a WhatsApp ID that is too short (Evolution would break the vCard)', async () => {
    const ctx = messageContext('sendContact', {
      number: '5511999999999',
      contactCards: {
        contact: [{ fullName: 'A', phoneNumber: '+55 11 98888-7777', wuid: '98888' }],
      },
    });
    await expect(execute.sendContact.call(ctx, 0)).rejects.toThrow(
      'Contact 1: WhatsApp ID must be the digits of a WhatsApp number with country code',
    );
    expect(ctx.http.calls).toHaveLength(0);

    const device = messageContext('sendContact', {
      number: '5511999999999',
      contactCards: {
        contact: [
          {
            fullName: 'A',
            phoneNumber: '+55 11 98888-7777',
            wuid: '5511988887777:12@s.whatsapp.net',
          },
        ],
      },
    });
    device.http.reply('POST', '/message/sendContact/main', SENT, 201);
    await execute.sendContact.call(device, 0);
    expect((device.http.calls[0].body as IDataObject).contact).toEqual([
      { fullName: 'A', phoneNumber: '+55 11 98888-7777', wuid: '5511988887777' },
    ]);
  });

  it('mirrors Evolution createJid number rules for the vCard waid', () => {
    expect(contactWaId('+52 1 55 1234 5678')).toBe('525512345678');
    expect(contactWaId('+54 9 11 1234 5678')).toBe('541112345678');
    expect(contactWaId('+55 11 98888-7777')).toBe('5511988887777');
    expect(contactWaId('+55 31 98888-7777')).toBe('553188887777');
    expect(contactWaId('+1 (555) 123-4567')).toBe('15551234567');
  });
});

describe('message > sendReaction', () => {
  it('sends the message key and the emoji (no number field)', async () => {
    const ctx = messageContext('sendReaction', {
      remoteJid: '120363025246125888@g.us',
      messageId: '3EB0TARGET',
      fromMe: false,
      reaction: '🔥',
      options: { participant: '5511999999999' },
    });
    ctx.http.reply('POST', '/message/sendReaction/main', SENT, 201);

    const result = await execute.sendReaction.call(ctx, 0);

    expect(ctx.http.calls[0].path).toBe('/message/sendReaction/main');
    expect(ctx.http.calls[0].body).toEqual({
      key: {
        id: '3EB0TARGET',
        remoteJid: '120363025246125888@g.us',
        fromMe: false,
        participant: '5511999999999@s.whatsapp.net',
      },
      reaction: '🔥',
    });
    expect(result).toEqual(SENT);
  });

  it('builds a JID from a number, keeps @lid and removes the reaction with an empty value', async () => {
    const ctx = createMockExecuteFunctions({
      items: [{ json: {} }, { json: {} }],
      params: {
        resource: 'message',
        operation: 'sendReaction',
        instanceName: 'main',
        messageId: 'ID',
        fromMe: true,
        reaction: '',
      },
      itemParams: [{ remoteJid: '5511999999999' }, { remoteJid: '123456789012345@lid' }],
    });
    ctx.http.reply('POST', '/message/sendReaction/main', SENT, 201);
    ctx.http.reply('POST', '/message/sendReaction/main', SENT, 201);

    await runNode(ctx);

    expect(ctx.http.calls.map((call) => call.body)).toEqual([
      { key: { id: 'ID', remoteJid: '5511999999999@s.whatsapp.net', fromMe: true }, reaction: '' },
      { key: { id: 'ID', remoteJid: '123456789012345@lid', fromMe: true }, reaction: '' },
    ]);
  });

  it('requires the chat and the message ID', async () => {
    const ctx = messageContext('sendReaction', { remoteJid: '', messageId: 'X' });
    await expect(execute.sendReaction.call(ctx, 0)).rejects.toThrow('Chat JID is required');
    const noId = messageContext('sendReaction', { remoteJid: '5511999999999', messageId: ' ' });
    await expect(execute.sendReaction.call(noId, 0)).rejects.toThrow('Message ID is required');
  });
});

describe('message > sendPoll', () => {
  it('sends name, selectableCount and values (one per line, commas kept)', async () => {
    const ctx = messageContext('sendPoll', {
      number: '120363025246125888@g.us',
      pollQuestion: 'When?',
      pollOptions: 'Monday, 9am\n\n Tuesday \r\nWednesday',
      selectableCount: 0,
      options: { messageId: '3EB0POLL' },
    });
    ctx.http.reply('POST', '/message/sendPoll/main', SENT, 201);

    const result = await execute.sendPoll.call(ctx, 0);

    expect(ctx.http.calls[0].path).toBe('/message/sendPoll/main');
    expect(ctx.http.calls[0].body).toEqual({
      number: '120363025246125888@g.us',
      name: 'When?',
      selectableCount: 0,
      values: ['Monday, 9am', 'Tuesday', 'Wednesday'],
      messageId: '3EB0POLL',
    });
    expect(result).toEqual(SENT);
  });

  it('accepts an array of options from an expression', async () => {
    const ctx = messageContext('sendPoll', {
      number: '5511999999999',
      pollQuestion: 'Pick',
      pollOptions: ['A', 'B'],
    });
    ctx.http.reply('POST', '/message/sendPoll/main', SENT, 201);
    await execute.sendPoll.call(ctx, 0);
    expect(ctx.http.calls[0].body).toMatchObject({ values: ['A', 'B'], selectableCount: 1 });
  });

  it.each([
    [{ pollOptions: 'Only one' }, 'A poll needs between 2 and 10 options (got 1)'],
    [{ pollOptions: 'A\nB\nA' }, 'Poll options must be different ("A" is repeated)'],
    [
      { pollOptions: 'A\nB', selectableCount: 3 },
      'Selectable Count must be between 0 and the number of options (2)',
    ],
    [{ pollQuestion: ' ', pollOptions: 'A\nB' }, 'Question is required'],
  ])('validates %j', async (params, message) => {
    const ctx = messageContext('sendPoll', {
      number: '5511999999999',
      pollQuestion: 'Q',
      ...params,
    });
    await expect(execute.sendPoll.call(ctx, 0)).rejects.toThrow(message);
    expect(ctx.http.calls).toHaveLength(0);
  });
});

describe('message > sendList', () => {
  it('sends "sections" (not "values") and omits empty row descriptions', async () => {
    const ctx = messageContext('sendList', {
      number: '5511999999999',
      listTitle: 'Menu',
      listDescription: 'Pick one',
      listButtonText: 'Open',
      listSections: {
        section: [
          {
            title: 'Food',
            rows: {
              row: [
                { title: 'Pizza', description: 'Large', rowId: 'pizza' },
                { title: 'Salad', description: '', rowId: 'salad' },
              ],
            },
          },
        ],
      },
      options: { delay: 100 },
    });
    ctx.http.reply('POST', '/message/sendList/main', SENT, 201);

    const result = await execute.sendList.call(ctx, 0);

    expect(ctx.http.calls[0].path).toBe('/message/sendList/main');
    expect(ctx.http.calls[0].body).toEqual({
      number: '5511999999999',
      title: 'Menu',
      description: 'Pick one',
      buttonText: 'Open',
      footerText: '',
      sections: [
        {
          title: 'Food',
          rows: [
            { title: 'Pizza', description: 'Large', rowId: 'pizza' },
            { title: 'Salad', rowId: 'salad' },
          ],
        },
      ],
      delay: 100,
    });
    expect(result).toEqual(SENT);
  });

  it('accepts JSON sections, including the legacy "values" wrapper and "id" rows', async () => {
    const ctx = messageContext('sendList', {
      number: '5511999999999',
      listTitle: 'Menu',
      listButtonText: 'Open',
      listFooter: 'Thanks',
      interactiveInputMode: 'json',
      listSectionsJson: JSON.stringify({
        values: [{ title: 'Drinks', rows: [{ title: 'Water', id: 'water' }] }],
      }),
    });
    ctx.http.reply('POST', '/message/sendList/main', SENT, 201);

    await execute.sendList.call(ctx, 0);

    expect(ctx.http.calls[0].body).toEqual({
      number: '5511999999999',
      title: 'Menu',
      buttonText: 'Open',
      footerText: 'Thanks',
      sections: [{ title: 'Drinks', rows: [{ title: 'Water', rowId: 'water' }] }],
    });
  });

  it.each([
    [{}, 'Add at least one section with at least one row'],
    [{ listSections: { section: [{ title: 'S', rows: {} }] } }, 'Section 1: add at least one row'],
    [
      {
        listSections: {
          section: [
            { title: 'S', rows: { row: [{ title: 'A', rowId: 'x' }] } },
            { title: 'T', rows: { row: [{ title: 'B', rowId: 'x' }] } },
          ],
        },
      },
      'Section 2, row 1: Row ID "x" is used twice',
    ],
    [
      { listSections: { section: [{ title: 'S', rows: { row: [{ title: 'A' }] } }] } },
      'Section 1, row 1: Row ID is required',
    ],
    [
      { interactiveInputMode: 'json', listSectionsJson: '{"a":1}' },
      'Sections (JSON) must be a JSON array',
    ],
    [{ interactiveInputMode: 'json', listSectionsJson: '[{' }, 'Invalid JSON in "Sections (JSON)"'],
  ])('validates %j', async (params, message) => {
    const ctx = messageContext('sendList', {
      number: '5511999999999',
      listTitle: 'Menu',
      listButtonText: 'Open',
      ...params,
    });
    await expect(execute.sendList.call(ctx, 0)).rejects.toThrow(message);
    expect(ctx.http.calls).toHaveLength(0);
  });
});

describe('message > sendButtons', () => {
  it('sends reply buttons (ID defaults to the display text)', async () => {
    const ctx = messageContext('sendButtons', {
      number: '5511999999999',
      buttonsTitle: 'Confirm?',
      buttonsDescription: 'Tomorrow 10am',
      buttons: {
        button: [
          { type: 'reply', displayText: 'Yes', id: 'yes' },
          { type: 'reply', displayText: 'No', id: '' },
        ],
      },
      options: {
        footer: 'Clinic',
        thumbnailUrl: 'https://example.com/logo.png',
        quotedMessageId: 'Q',
      },
    });
    ctx.http.reply('POST', '/message/sendButtons/main', SENT, 201);

    const result = await execute.sendButtons.call(ctx, 0);

    expect(ctx.http.calls[0].path).toBe('/message/sendButtons/main');
    expect(ctx.http.calls[0].body).toEqual({
      number: '5511999999999',
      title: 'Confirm?',
      description: 'Tomorrow 10am',
      footer: 'Clinic',
      thumbnailUrl: 'https://example.com/logo.png',
      buttons: [
        { type: 'reply', displayText: 'Yes', id: 'yes' },
        { type: 'reply', displayText: 'No', id: 'No' },
      ],
      quoted: { key: { id: 'Q' } },
    });
    expect(result).toEqual(SENT);
  });

  it('sends up to 2 call-to-action buttons and a lone PIX button', async () => {
    const ctx = messageContext('sendButtons', {
      number: '5511999999999',
      buttonsTitle: 'Contact us',
      interactiveInputMode: 'json',
      buttonsJson: JSON.stringify({
        buttons: [
          { type: 'url', displayText: 'Site', url: 'https://example.com', id: 'dropped' },
          { type: 'call', displayText: 'Call', phoneNumber: '+5511999999999' },
        ],
      }),
    });
    ctx.http.reply('POST', '/message/sendButtons/main', SENT, 201);
    await execute.sendButtons.call(ctx, 0);
    expect((ctx.http.calls[0].body as IDataObject).buttons).toEqual([
      { type: 'url', displayText: 'Site', url: 'https://example.com' },
      { type: 'call', displayText: 'Call', phoneNumber: '+5511999999999' },
    ]);

    const pix = messageContext('sendButtons', {
      number: '5511999999999',
      buttonsTitle: 'Pay',
      buttons: {
        button: [
          { type: 'pix', name: 'ACME', keyType: 'email', key: 'pay@acme.com', currency: '' },
        ],
      },
    });
    pix.http.reply('POST', '/message/sendButtons/main', SENT, 201);
    await execute.sendButtons.call(pix, 0);
    expect((pix.http.calls[0].body as IDataObject).buttons).toEqual([
      { type: 'pix', currency: 'BRL', name: 'ACME', keyType: 'email', key: 'pay@acme.com' },
    ]);
  });

  const url = (n: number) => ({ type: 'url', displayText: `U${n}`, url: `https://e.com/${n}` });
  const reply = (n: number) => ({ type: 'reply', displayText: `R${n}` });
  const pixButton = { type: 'pix', name: 'A', keyType: 'cpf', key: '123' };

  it.each([
    [[], 'At least one button is required'],
    [
      [reply(1), { type: 'reply', displayText: 'Other', id: 'R1' }],
      'Quick Reply button IDs must be different ("R1" is repeated)',
    ],
    [
      [url(1), url(2), { type: 'copy', displayText: 'C', copyCode: 'X' }],
      'at most 2 call-to-action',
    ],
    [[reply(1), reply(2), reply(3), reply(4)], 'at most 3 Quick Reply buttons'],
    [[reply(1), url(1)], 'Quick Reply buttons cannot be mixed with other button types'],
    [[pixButton, url(1)], 'A PIX Payment button must be the only button of the message'],
    [[{ type: 'url', displayText: 'U', url: 'example.com' }], 'Button 1: URL must start with http'],
    [[{ type: 'call', displayText: 'C' }], 'Button 1: Phone Number is required'],
    [[{ type: 'copy', copyCode: 'X' }], 'Button 1: Display Text is required'],
    [
      [{ type: 'pix', name: 'A', keyType: 'iban', key: '1' }],
      'Button 1: PIX Key Type must be one of',
    ],
    [[{ type: 'list', displayText: 'X' }], 'Button 1: unsupported button type "list"'],
  ])('validates the button rules client side: %j', async (buttons, message) => {
    const ctx = messageContext('sendButtons', {
      number: '5511999999999',
      buttonsTitle: 'T',
      buttons: { button: buttons },
    });
    await expect(execute.sendButtons.call(ctx, 0)).rejects.toThrow(message);
    expect(ctx.http.calls).toHaveLength(0);
  });

  it('explains the allowed combinations in the error description', () => {
    expect(() => assertButtonRules(TEST_NODE, 0, [url(1), url(2), url(3)])).toThrow(
      expect.objectContaining({
        description: expect.stringContaining('Evolution API 2.4+ rejects more'),
      }),
    );
  });
});

describe('message > sendCarousel (2.4+)', () => {
  it('sends the cards with their buttons', async () => {
    const ctx = messageContext('sendCarousel', {
      number: '5511999999999',
      carouselBody: 'Our products',
      carouselCards: {
        card: [
          {
            title: 'Pizza',
            body: 'Large',
            footer: '',
            imageUrl: 'https://example.com/p.jpg',
            buttons: {
              button: [
                { type: 'reply', displayText: 'Order', id: 'order_pizza' },
                { type: 'copy', displayText: 'Coupon', copyCode: 'PIZZA10' },
              ],
            },
          },
          {
            body: 'Salad',
            buttons: { button: [{ type: 'call', displayText: 'Call', phoneNumber: '+551199' }] },
          },
        ],
      },
      options: { mentionsEveryOne: true },
    });
    ctx.http.reply('POST', '/message/sendCarousel/main', SENT, 201);

    const result = await execute.sendCarousel.call(ctx, 0);

    expect(ctx.http.calls[0].path).toBe('/message/sendCarousel/main');
    expect(ctx.http.calls[0].body).toEqual({
      number: '5511999999999',
      body: 'Our products',
      cards: [
        {
          body: 'Large',
          title: 'Pizza',
          imageUrl: 'https://example.com/p.jpg',
          buttons: [
            { type: 'reply', displayText: 'Order', id: 'order_pizza' },
            { type: 'copy', displayText: 'Coupon', copyCode: 'PIZZA10' },
          ],
        },
        {
          body: 'Salad',
          buttons: [{ type: 'call', displayText: 'Call', phoneNumber: '+551199' }],
        },
      ],
      mentionsEveryOne: true,
    });
    expect(result).toEqual(SENT);
  });

  it('accepts JSON cards', async () => {
    const ctx = messageContext('sendCarousel', {
      number: '5511999999999',
      carouselBody: 'B',
      interactiveInputMode: 'json',
      carouselCardsJson: [
        { body: 'C1', buttons: [{ type: 'url', displayText: 'Go', url: 'https://e.com' }] },
      ],
    });
    ctx.http.reply('POST', '/message/sendCarousel/main', SENT, 201);
    await execute.sendCarousel.call(ctx, 0);
    expect((ctx.http.calls[0].body as IDataObject).cards).toEqual([
      { body: 'C1', buttons: [{ type: 'url', displayText: 'Go', url: 'https://e.com' }] },
    ]);
  });

  const card = (buttons: IDataObject[], body = 'X') => ({ body, buttons });
  const button = { type: 'reply', displayText: 'R' };

  it.each([
    [[], 'A carousel needs between 1 and 10 cards (got 0)'],
    [
      Array.from({ length: 11 }, () => card([button])),
      'A carousel needs between 1 and 10 cards (got 11)',
    ],
    [
      [card([button, button, button, button])],
      'Card 1: a card needs between 1 and 3 buttons (got 4)',
    ],
    [[card([])], 'Card 1: a card needs between 1 and 3 buttons (got 0)'],
    [[card([button], ' ')], 'Card 1: Body is required'],
    [
      [card([{ type: 'pix', name: 'A', keyType: 'cpf', key: '1' }])],
      'Card 1, button 1: unsupported button type "pix"',
    ],
  ])('validates %#', async (cards, message) => {
    const ctx = messageContext('sendCarousel', {
      number: '5511999999999',
      carouselBody: 'B',
      interactiveInputMode: 'json',
      carouselCardsJson: JSON.stringify(cards),
    });
    await expect(execute.sendCarousel.call(ctx, 0)).rejects.toThrow(message);
    expect(ctx.http.calls).toHaveLength(0);
  });

  it('explains that 2.3.x servers do not have the route', async () => {
    const ctx = messageContext('sendCarousel', {
      number: '5511999999999',
      carouselBody: 'B',
      interactiveInputMode: 'json',
      carouselCardsJson: JSON.stringify([card([button])]),
    });
    ctx.http.reply(
      'POST',
      '/message/sendCarousel/main',
      {
        status: 404,
        error: 'Not Found',
        response: { message: ['Cannot POST /message/sendCarousel/main'] },
      },
      404,
    );
    await expect(execute.sendCarousel.call(ctx, 0)).rejects.toMatchObject({
      httpCode: '404',
      message: expect.stringContaining('Cannot POST /message/sendCarousel/main'),
    });
  });
});

describe('message > sendStatus', () => {
  it('posts a text status to full JIDs', async () => {
    const ctx = messageContext('sendStatus', {
      statusType: 'text',
      text: 'Hello',
      statusBackgroundColor: '#123456',
      statusFont: 3,
      statusRecipients: '5511999999999, 123456789012345@lid, 5511999999999@s.whatsapp.net',
    });
    ctx.http.reply(
      'POST',
      '/message/sendStatus/main',
      { ...SENT, key: { remoteJid: 'status@broadcast' } },
      201,
    );

    const result = await execute.sendStatus.call(ctx, 0);

    expect(ctx.http.calls[0].path).toBe('/message/sendStatus/main');
    expect(ctx.http.calls[0].body).toEqual({
      type: 'text',
      statusJidList: ['5511999999999@s.whatsapp.net', '123456789012345@lid'],
      content: 'Hello',
      backgroundColor: '#123456',
      font: 3,
    });
    expect(result).toMatchObject({ key: { remoteJid: 'status@broadcast' } });
  });

  it('posts an image URL with caption to all contacts', async () => {
    const ctx = messageContext('sendStatus', {
      statusType: 'image',
      mediaUrl: 'https://example.com/story.jpg',
      caption: 'New!',
      statusAllContacts: true,
    });
    ctx.http.reply('POST', '/message/sendStatus/main', SENT, 201);

    await execute.sendStatus.call(ctx, 0);

    expect(ctx.http.calls[0].body).toEqual({
      type: 'image',
      allContacts: true,
      content: 'https://example.com/story.jpg',
      caption: 'New!',
    });
  });

  it('sends a binary image as a data: URI in JSON (Baileys reads { url: "data:…" } inline)', async () => {
    const item = binaryItem(
      {},
      { photo: { content: 'PNGDATA', fileName: 'story.png', mimeType: 'image/png' } },
    );
    const ctx = messageContext(
      'sendStatus',
      {
        statusType: 'image',
        mediaSource: 'binary',
        binaryPropertyName: 'photo',
        caption: 'New!',
        statusRecipients: '5511999999999',
      },
      { items: [item] },
    );
    ctx.http.reply('POST', '/message/sendStatus/main', SENT, 201);

    const [output] = await new EvolutionApi().execute.call(ctx);

    const [call] = ctx.http.calls;
    expect(call.body).not.toBeInstanceOf(FormData);
    expect(call.body).toEqual({
      type: 'image',
      statusJidList: ['5511999999999@s.whatsapp.net'],
      content: `data:image/png;base64,${Buffer.from('PNGDATA').toString('base64')}`,
      caption: 'New!',
    });
    expect(output[0].json).toEqual(SENT);
    expect(output[0].binary).toBe(item.binary);
  });

  it('sends a base64 video as a data: URI (default MIME type video/mp4)', async () => {
    const ctx = messageContext('sendStatus', {
      statusType: 'video',
      mediaSource: 'base64',
      mediaBase64: 'AAAAIGZ0eXA=',
      statusAllContacts: true,
    });
    ctx.http.reply('POST', '/message/sendStatus/main', SENT, 201);

    await execute.sendStatus.call(ctx, 0);

    expect(ctx.http.calls[0].body).toEqual({
      type: 'video',
      allContacts: true,
      content: 'data:video/mp4;base64,AAAAIGZ0eXA=',
    });
  });

  it('uploads a binary audio status as multipart', async () => {
    const ctx = messageContext(
      'sendStatus',
      { statusType: 'audio', mediaSource: 'binary', statusRecipients: '5511999999999' },
      {
        items: [
          binaryItem({}, { data: { content: 'MP3', fileName: 'a.mp3', mimeType: 'audio/mpeg' } }),
        ],
      },
    );
    ctx.http.reply('POST', '/message/sendStatus/main', SENT, 201);

    await execute.sendStatus.call(ctx, 0);

    const form = ctx.http.calls[0].body as FormData;
    expect(formEntries(form)).toMatchObject({
      type: 'audio',
      'statusJidList[0]': '5511999999999@s.whatsapp.net',
    });
    expect((form.get('file') as File).name).toBe('a.mp3');
    expect(form.get('content')).toBeNull();
  });

  it.each([
    [
      { statusType: 'text', text: 'x', statusRecipients: ' ' },
      'Add at least one recipient or enable All Contacts',
    ],
    [{ statusType: 'text', text: ' ', statusRecipients: '5511999999999' }, 'Text is required'],
    [
      { statusType: 'text', text: 'x', statusFont: 0, statusRecipients: '5511999999999' },
      'Font must be a number from 1 to 5',
    ],
    [
      { statusType: 'video', mediaUrl: 'file:///tmp/a.mp4', statusRecipients: '5511999999999' },
      'Media URL must start with http:// or https://',
    ],
  ])('validates %j', async (params, message) => {
    const ctx = messageContext('sendStatus', params);
    await expect(execute.sendStatus.call(ctx, 0)).rejects.toThrow(message);
    expect(ctx.http.calls).toHaveLength(0);
  });
});

describe('message > generateMessageId (2.4+)', () => {
  it('GET /baileys/generateMessageID/:instance returns { id }', async () => {
    const ctx = messageContext('generateMessageId');
    ctx.http.reply('GET', '/baileys/generateMessageID/main', { id: '3EB0B2C4D6E8F0A1' });

    const result = await execute.generateMessageId.call(ctx, 0);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/baileys/generateMessageID/main');
    expect(call.qs).toBeUndefined();
    expect(result).toEqual({ id: '3EB0B2C4D6E8F0A1' });
  });

  it('feeds the Custom Message ID of a send operation', async () => {
    const generate = messageContext('generateMessageId');
    generate.http.reply('GET', '/baileys/generateMessageID/main', { id: '3EB0IDEMP' });
    const { id } = (await execute.generateMessageId.call(generate, 0)) as IDataObject;

    const send = messageContext('sendText', {
      number: '5511999999999',
      text: 'x',
      options: { messageId: id },
    });
    send.http.reply('POST', '/message/sendText/main', SENT, 201);
    await execute.sendText.call(send, 0);
    expect((send.http.calls[0].body as IDataObject).messageId).toBe('3EB0IDEMP');
  });

  it('explains that 2.3.x servers do not have the route', async () => {
    const ctx = messageContext('generateMessageId');
    ctx.http.reply(
      'GET',
      '/baileys/generateMessageID/main',
      {
        status: 404,
        error: 'Not Found',
        response: { message: ['Cannot GET /baileys/generateMessageID/main'] },
      },
      404,
    );
    await expect(execute.generateMessageId.call(ctx, 0)).rejects.toMatchObject({
      httpCode: '404',
      message: expect.stringContaining('Cannot GET /baileys/generateMessageID/main'),
    });
  });
});

describe('message > sendTemplate', () => {
  it('sends name, language, components, reply and status webhook', async () => {
    const components = [{ type: 'body', parameters: [{ type: 'text', text: 'Jane' }] }];
    const ctx = messageContext('sendTemplate', {
      number: '5511999999999',
      templateName: 'order_confirmation',
      templateLanguage: 'pt_BR',
      templateComponents: JSON.stringify(components),
      options: { quotedMessageId: 'wamid.X', webhookUrl: 'https://example.com/status' },
    });
    ctx.http.reply('POST', '/message/sendTemplate/main', SENT, 201);

    const result = await execute.sendTemplate.call(ctx, 0);

    expect(ctx.http.calls[0].path).toBe('/message/sendTemplate/main');
    expect(ctx.http.calls[0].body).toEqual({
      number: '5511999999999',
      name: 'order_confirmation',
      language: 'pt_BR',
      components,
      quoted: { key: { id: 'wamid.X' } },
      webhookUrl: 'https://example.com/status',
    });
    expect(result).toEqual(SENT);
  });

  it('omits empty components and validates the JSON', async () => {
    const ctx = messageContext('sendTemplate', {
      number: '5511999999999',
      templateName: 'hello_world',
    });
    ctx.http.reply('POST', '/message/sendTemplate/main', SENT, 201);
    await execute.sendTemplate.call(ctx, 0);
    expect(ctx.http.calls[0].body).toEqual({
      number: '5511999999999',
      name: 'hello_world',
      language: 'en_US',
    });

    const invalid = messageContext('sendTemplate', {
      number: '5511999999999',
      templateName: 'hello_world',
      templateComponents: '{"type":"body"}',
    });
    await expect(execute.sendTemplate.call(invalid, 0)).rejects.toThrow(
      'Components (JSON) must be a JSON array',
    );
  });

  it('reports Meta errors returned with HTTP 201', async () => {
    const ctx = messageContext('sendTemplate', {
      number: '5511999999999',
      templateName: 'missing',
    });
    ctx.http.reply(
      'POST',
      '/message/sendTemplate/main',
      {
        message: '(#132001) Template name does not exist in the translation',
        type: 'OAuthException',
        code: 132001,
        error_data: {
          messaging_product: 'whatsapp',
          details: 'template name (missing) does not exist in en_US',
        },
        fbtrace_id: 'X',
      },
      201,
    );
    await expect(execute.sendTemplate.call(ctx, 0)).rejects.toMatchObject({
      message:
        'WhatsApp Cloud API rejected the message: (#132001) Template name does not exist in the translation; template name (missing) does not exist in en_US',
      description: expect.stringContaining('code 132001'),
    });
  });
});

describe('message helpers', () => {
  it('adds a file extension from the MIME type only when missing', () => {
    expect(ensureFileExtension('report', 'application/pdf')).toBe('report.pdf');
    expect(ensureFileExtension('voice', 'audio/ogg; codecs=opus')).toBe('voice.ogg');
    expect(ensureFileExtension('photo.png', 'image/jpeg')).toBe('photo.png');
    expect(ensureFileExtension('blob', 'application/x-unknown')).toBe('blob');
    expect(ensureFileExtension('', 'image/png')).toBe('');
  });

  it('takes a document name from the last URL segment only when it has an extension', () => {
    expect(fileNameFromUrl('https://e.com/a/b/Factura%20Marzo.pdf?x=1#y')).toBe(
      'Factura Marzo.pdf',
    );
    expect(fileNameFromUrl('https://e.com/a/b/report')).toBe('');
    expect(fileNameFromUrl('https://e.com/')).toBe('');
    expect(fileNameFromUrl('https://e.com/%E0%A4%A.pdf')).toBe('%E0%A4%A.pdf');
    expect(fileNameFromUrl('not a url')).toBe('');
  });

  it('normalizes mentions (leading "@", separators, duplicates)', () => {
    expect(normalizeMentions('@+52 1 55 1234 5678, 5511999999999\n@@5511999999999')).toEqual([
      '5215512345678',
      '5511999999999',
    ]);
    expect(normalizeMentions(['@1234@lid', ''])).toEqual(['1234@lid']);
    expect(normalizeMentions(undefined)).toEqual([]);
  });

  it('builds quoted from an object value (expressions) and ignores empty input', () => {
    expect(buildQuoted(TEST_NODE, 0, {})).toBeUndefined();
    expect(buildQuoted(TEST_NODE, 0, { quotedMessage: '', quotedMessageId: '' })).toBeUndefined();
    expect(
      buildQuoted(TEST_NODE, 0, {
        quotedMessage: { key: { id: 'A', fromMe: true }, message: { conversation: 'x' } },
      }),
    ).toEqual({ key: { id: 'A', fromMe: true }, message: { conversation: 'x' } });
  });
});
