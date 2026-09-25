import type { IDataObject, INodeExecutionData } from 'n8n-workflow';

import { EvolutionApi } from '../../nodes/EvolutionApi/EvolutionApi.node';
import { resetRetryPolicy, setRetryPolicy } from '../../nodes/EvolutionApi/GenericFunctions';
import { execute, operations } from '../../nodes/EvolutionApi/resources/chat';
import {
  description as downloadMediaDescription,
  mediaFileName,
} from '../../nodes/EvolutionApi/resources/chat/downloadMedia.operation';
import { withPushNameFallback } from '../../nodes/EvolutionApi/resources/chat/getMany.operation';
import {
  collectPages,
  evolutionJid,
  timestampRange,
  toIsoDate,
} from '../../nodes/EvolutionApi/resources/chat/helpers';
import type { MockExecuteFunctions, MockOptions } from '../helpers/mockExecuteFunctions';
import { createMockExecuteFunctions, rl } from '../helpers/mockExecuteFunctions';

// Tests of the chat resource (owned by the chat agent).

beforeEach(() => setRetryPolicy({ sleep: async () => undefined }));
afterEach(() => resetRetryPolicy());

const MX_INPUT = '+52 1 55 1234 5678';
const MX_NUMBER = '5215512345678';
const MX_JID = '525512345678@s.whatsapp.net';
const LID = '123456789012345@lid';
const GROUP = '120363025246125486@g.us';

/** Context for resource "chat", instance "main" (list mode). */
function chatContext(
  operation: string,
  params: IDataObject = {},
  options: Omit<MockOptions, 'params'> = {},
): MockExecuteFunctions {
  return createMockExecuteFunctions({
    ...options,
    params: { resource: 'chat', operation, instanceName: rl('main', 'list'), ...params },
  });
}

async function run(ctx: MockExecuteFunctions): Promise<INodeExecutionData[]> {
  const [output] = await new EvolutionApi().execute.call(ctx);
  return output;
}

function jsonOf(output: INodeExecutionData[]): IDataObject[] {
  return output.map((item) => item.json);
}

/** Queue the whatsappNumbers lookup the node does for a bare phone number. */
function replyLookup(ctx: MockExecuteFunctions, number = MX_NUMBER, jid = MX_JID): void {
  ctx.http.reply('POST', '/chat/whatsappNumbers/main', [{ exists: true, jid, number }]);
}

function messagesPage(records: IDataObject[], pages = 1, currentPage = 1, total = records.length) {
  return { messages: { total, pages, currentPage, records } };
}

describe('chat resource description', () => {
  it('keeps checkNumbers as the default operation', () => {
    expect(operations.default).toBe('checkNumbers');
  });

  it('marks the 2.4-only operations', () => {
    const options = operations.options as Array<{ value: string; description: string }>;
    for (const value of ['getChannels', 'getPollVotes', 'markAsPlayed']) {
      const option = options.find((o) => o.value === value);
      expect(option?.description).toContain('Requires Evolution API 2.4+');
    }
    const others = options.filter(
      (o) => !['getChannels', 'getPollVotes', 'markAsPlayed'].includes(o.value),
    );
    for (const option of others) expect(option.description).not.toContain('2.4');
  });

  it('does not expose the develop-only fetchLid route', () => {
    const values = (operations.options as Array<{ value: string }>).map((o) => o.value);
    expect(values).not.toContain('getLid');
  });
});

describe('chat > checkNumbers', () => {
  it('POST /chat/whatsappNumbers/:instance', async () => {
    const ctx = chatContext('checkNumbers', { numbers: '+55 11 99999-9999, 123@lid' });
    ctx.http.reply('POST', '/chat/whatsappNumbers/main', [
      { exists: true, jid: '5511999999999@s.whatsapp.net', number: '5511999999999' },
    ]);

    const output = await run(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/chat/whatsappNumbers/main');
    expect(call.qs).toBeUndefined();
    expect(call.body).toEqual({ numbers: ['5511999999999', '123@lid'] });
    expect(jsonOf(output)).toEqual([
      { exists: true, jid: '5511999999999@s.whatsapp.net', number: '5511999999999' },
    ]);
    expect(output.every((item) => item.pairedItem !== undefined)).toBe(true);
  });

  it('checks every input item and pairs each result with its item', async () => {
    const ctx = chatContext(
      'checkNumbers',
      {},
      {
        items: [{ json: {} }, { json: {} }],
        itemParams: [{ numbers: '5215512345678' }, { numbers: '5511999999999, 5511888888888' }],
      },
    );
    ctx.http
      .reply('POST', '/chat/whatsappNumbers/main', [{ exists: true, jid: MX_JID }])
      .reply('POST', '/chat/whatsappNumbers/main', [
        { exists: true, jid: '5511999999999@s.whatsapp.net' },
        { exists: false, jid: '5511888888888@s.whatsapp.net' },
      ]);

    const output = await run(ctx);

    expect(ctx.http.calls.map((c) => c.body)).toEqual([
      { numbers: ['5215512345678'] },
      { numbers: ['5511999999999', '5511888888888'] },
    ]);
    expect(output.map((item) => item.pairedItem)).toEqual([{ item: 0 }, { item: 1 }, { item: 1 }]);
  });

  it('rejects an empty list before calling the API', async () => {
    const ctx = chatContext('checkNumbers', { numbers: ' , ' });
    await expect(run(ctx)).rejects.toThrow('At least one number is required');
    expect(ctx.http.calls).toHaveLength(0);
  });
});

describe('chat > archive', () => {
  it('looks up the last stored message and sends it as lastMessage', async () => {
    const ctx = chatContext('archive', { remoteJid: MX_JID, archive: true });
    ctx.http.reply(
      'POST',
      '/chat/findMessages/main',
      messagesPage([
        {
          id: 'db-1',
          key: { id: 'LAST', fromMe: false, remoteJid: MX_JID },
          messageTimestamp: 1717000000,
        },
      ]),
    );
    ctx.http.reply('POST', '/chat/archiveChat/main', { chatId: MX_JID, archived: true }, 201);

    const output = await run(ctx);

    const [lookup, call] = ctx.http.calls;
    expect(lookup.path).toBe('/chat/findMessages/main');
    expect(lookup.body).toEqual({
      where: { key: { remoteJid: MX_JID, remoteJidAlt: MX_JID } },
      page: 1,
      offset: 1,
    });
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/chat/archiveChat/main');
    expect(call.body).toEqual({
      archive: true,
      lastMessage: {
        key: { id: 'LAST', fromMe: false, remoteJid: MX_JID },
        messageTimestamp: 1717000000,
      },
    });
    expect(jsonOf(output)).toEqual([{ chatId: MX_JID, archived: true }]);
  });

  it('keeps the group sender of the stored key', async () => {
    const ctx = chatContext('archive', { remoteJid: GROUP });
    ctx.http.reply(
      'POST',
      '/chat/findMessages/main',
      messagesPage([
        {
          key: { id: 'G1', fromMe: false, remoteJid: GROUP, participant: LID },
          messageTimestamp: 1717000001,
        },
      ]),
    );
    ctx.http.reply('POST', '/chat/archiveChat/main', { chatId: GROUP, archived: true }, 201);

    await run(ctx);

    expect((ctx.http.calls[1].body as IDataObject).lastMessage).toEqual({
      key: { id: 'G1', fromMe: false, remoteJid: GROUP, participant: LID },
      messageTimestamp: 1717000001,
    });
  });

  it('unarchives with the last message given in the options (no lookup)', async () => {
    const ctx = chatContext('archive', {
      remoteJid: LID,
      archive: false,
      options: {
        lastMessageId: ' ABC ',
        lastMessageFromMe: true,
        lastMessageTimestamp: 1717000002,
      },
    });
    ctx.http.reply('POST', '/chat/archiveChat/main', { chatId: LID, archived: true }, 201);

    const output = await run(ctx);

    expect(ctx.http.calls).toHaveLength(1);
    expect(ctx.http.calls[0].body).toEqual({
      archive: false,
      lastMessage: {
        key: { id: 'ABC', fromMe: true, remoteJid: LID },
        messageTimestamp: 1717000002,
      },
    });
    // Evolution answers archived: true for unarchive too; the output reflects the request.
    expect(jsonOf(output)).toEqual([{ chatId: LID, archived: false }]);
  });

  it('resolves a phone number and fails clearly when nothing is stored', async () => {
    // Evolution's own `chat` lookup reads the same table (and is broken in 2.3.7): sending it
    // would only produce a 500 "Open a calling" error.
    const ctx = chatContext('archive', { remoteJid: MX_INPUT });
    replyLookup(ctx);
    ctx.http.reply('POST', '/chat/findMessages/main', messagesPage([], 0));

    const error = (await run(ctx).catch((caught: unknown) => caught)) as Error & {
      description?: string;
    };

    expect(error.message).toBe(`No stored message found for chat ${MX_JID}`);
    expect(error.description).toContain('Last Message ID');
    expect(ctx.http.calls.map((c) => c.path)).toEqual([
      '/chat/whatsappNumbers/main',
      '/chat/findMessages/main',
    ]);
    expect(ctx.http.calls[0].body).toEqual({ numbers: [MX_NUMBER] });
    expect(ctx.http.calls[1].body).toEqual({
      where: { key: { remoteJid: MX_JID, remoteJidAlt: MX_JID } },
      page: 1,
      offset: 1,
    });
  });

  it('requires a chat', async () => {
    const ctx = chatContext('archive', { remoteJid: '  ' });
    await expect(run(ctx)).rejects.toThrow('Chat is required');
    expect(ctx.http.calls).toHaveLength(0);
  });
});

describe('chat > markUnread', () => {
  it('POST /chat/markChatUnread/:instance with the last stored message', async () => {
    const ctx = chatContext('markUnread', { remoteJid: MX_JID });
    ctx.http.reply(
      'POST',
      '/chat/findMessages/main',
      messagesPage([{ key: { id: 'LAST', fromMe: true, remoteJid: MX_JID }, messageTimestamp: 5 }]),
    );
    ctx.http.reply(
      'POST',
      '/chat/markChatUnread/main',
      { chatId: MX_JID, markedChatUnread: true },
      201,
    );

    const output = await run(ctx);

    const call = ctx.http.calls[1];
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/chat/markChatUnread/main');
    expect(call.body).toEqual({
      lastMessage: { key: { id: 'LAST', fromMe: true, remoteJid: MX_JID }, messageTimestamp: 5 },
    });
    expect(jsonOf(output)).toEqual([{ chatId: MX_JID, markedChatUnread: true }]);
  });

  it('uses the last message of the options', async () => {
    const ctx = chatContext('markUnread', {
      remoteJid: GROUP,
      options: { lastMessageId: 'X1' },
    });
    ctx.http.reply(
      'POST',
      '/chat/markChatUnread/main',
      { chatId: GROUP, markedChatUnread: true },
      201,
    );

    await run(ctx);

    expect(ctx.http.calls).toHaveLength(1);
    expect(ctx.http.calls[0].body).toEqual({
      lastMessage: { key: { id: 'X1', fromMe: false, remoteJid: GROUP } },
    });
  });

  it('fails clearly when no message is stored (lastMessage is required)', async () => {
    const ctx = chatContext('markUnread', { remoteJid: MX_JID });
    ctx.http.reply('POST', '/chat/findMessages/main', messagesPage([], 0));

    await expect(run(ctx)).rejects.toThrow(`No stored message found for chat ${MX_JID}`);
    expect(ctx.http.calls).toHaveLength(1);
  });
});

describe('chat > markAsRead', () => {
  it('POST /chat/markMessageAsRead/:instance with one key per message ID', async () => {
    const ctx = chatContext('markAsRead', { remoteJid: MX_JID, messageIds: 'A1, A2\nA1' });
    ctx.http.reply(
      'POST',
      '/chat/markMessageAsRead/main',
      { message: 'Read messages', read: 'success' },
      201,
    );

    const output = await run(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/chat/markMessageAsRead/main');
    expect(call.body).toEqual({
      readMessages: [
        { id: 'A1', fromMe: false, remoteJid: MX_JID },
        { id: 'A2', fromMe: false, remoteJid: MX_JID },
      ],
    });
    expect(jsonOf(output)).toEqual([{ message: 'Read messages', read: 'success' }]);
  });

  it('sends @lid JIDs verbatim and resolves phone numbers, one request per item', async () => {
    const ctx = chatContext(
      'markAsRead',
      {},
      {
        items: [{ json: {} }, { json: {} }],
        itemParams: [
          { remoteJid: LID, messageIds: 'L1' },
          { remoteJid: MX_INPUT, messageIds: 'P1', fromMe: true },
        ],
      },
    );
    ctx.http.reply('POST', '/chat/markMessageAsRead/main', { read: 'success' }, 201);
    replyLookup(ctx);
    ctx.http.reply('POST', '/chat/markMessageAsRead/main', { read: 'success' }, 201);

    const output = await run(ctx);

    expect(ctx.http.calls.map((c) => c.path)).toEqual([
      '/chat/markMessageAsRead/main',
      '/chat/whatsappNumbers/main',
      '/chat/markMessageAsRead/main',
    ]);
    expect(ctx.http.calls[0].body).toEqual({
      readMessages: [{ id: 'L1', fromMe: false, remoteJid: LID }],
    });
    expect(ctx.http.calls[2].body).toEqual({
      readMessages: [{ id: 'P1', fromMe: true, remoteJid: MX_JID }],
    });
    expect(output.map((item) => item.pairedItem)).toEqual([{ item: 0 }, { item: 1 }]);
  });

  it('requires at least one message ID', async () => {
    const ctx = chatContext('markAsRead', { remoteJid: MX_JID, messageIds: ' , ' });
    await expect(run(ctx)).rejects.toThrow('At least one message ID is required');
  });
});

describe('chat > markAsPlayed', () => {
  it('POST /chat/markMessageAsPlayed/:instance (2.4+)', async () => {
    const ctx = chatContext('markAsPlayed', { remoteJid: MX_JID, messageIds: 'V1' });
    ctx.http.reply(
      'POST',
      '/chat/markMessageAsPlayed/main',
      { message: 'Played messages', played: 'success' },
      201,
    );

    const output = await run(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/chat/markMessageAsPlayed/main');
    expect(call.body).toEqual({ playedMessages: [{ id: 'V1', fromMe: false, remoteJid: MX_JID }] });
    expect(jsonOf(output)).toEqual([{ message: 'Played messages', played: 'success' }]);
  });

  it('explains the 404 of Evolution API 2.3.x', async () => {
    const ctx = chatContext('markAsPlayed', { remoteJid: MX_JID, messageIds: 'V1' });
    ctx.http.reply(
      'POST',
      '/chat/markMessageAsPlayed/main',
      {
        status: 404,
        error: 'Not Found',
        response: { message: ['Cannot POST /chat/markMessageAsPlayed/main'] },
      },
      404,
    );

    await expect(run(ctx)).rejects.toMatchObject({ httpCode: '404' });
  });
});

describe('chat > deleteMessage', () => {
  it('DELETE /chat/deleteMessageForEveryone/:instance with a JSON body', async () => {
    const ctx = chatContext('deleteMessage', {
      remoteJid: GROUP,
      messageId: ' M1 ',
      fromMe: false,
      options: { participant: LID },
    });
    ctx.http.reply('DELETE', '/chat/deleteMessageForEveryone/main', { key: { id: 'REVOKE' } }, 201);

    const output = await run(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('DELETE');
    expect(call.path).toBe('/chat/deleteMessageForEveryone/main');
    expect(call.body).toEqual({ id: 'M1', fromMe: false, remoteJid: GROUP, participant: LID });
    expect(call.headers['Content-Type']).toBe('application/json');
    expect(jsonOf(output)).toEqual([{ key: { id: 'REVOKE' } }]);
  });

  it('defaults fromMe to true and never rewrites an @lid chat', async () => {
    const ctx = chatContext('deleteMessage', { remoteJid: LID, messageId: 'M2' });
    ctx.http.reply('DELETE', '/chat/deleteMessageForEveryone/main', { key: { id: 'REVOKE' } }, 201);

    await run(ctx);

    expect(ctx.http.calls[0].body).toEqual({ id: 'M2', fromMe: true, remoteJid: LID });
  });

  it('requires the message ID', async () => {
    const ctx = chatContext('deleteMessage', { remoteJid: LID, messageId: '' });
    await expect(run(ctx)).rejects.toThrow('Message ID is required');
  });
});

describe('chat > editMessage', () => {
  it('POST /chat/updateMessage/:instance with the resolved chat JID as number and key', async () => {
    const ctx = chatContext('editMessage', {
      remoteJid: MX_INPUT,
      messageId: 'E1',
      text: 'Corrected text',
    });
    replyLookup(ctx);
    ctx.http.reply('POST', '/chat/updateMessage/main', { key: { id: 'EDIT' } });

    const output = await run(ctx);

    const call = ctx.http.calls[1];
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/chat/updateMessage/main');
    expect(call.body).toEqual({
      number: MX_JID,
      key: { id: 'E1', fromMe: true, remoteJid: MX_JID },
      text: 'Corrected text',
    });
    expect(jsonOf(output)).toEqual([{ key: { id: 'EDIT' } }]);
  });

  it('falls back to the createJid rules when the lookup fails, without retrying it', async () => {
    const ctx = chatContext('editMessage', { remoteJid: MX_NUMBER, messageId: 'E1', text: 'x' });
    ctx.http.reply(
      'POST',
      '/chat/whatsappNumbers/main',
      { status: 500, error: 'Internal Server Error', response: { message: ['Connection Closed'] } },
      500,
    );
    ctx.http.reply('POST', '/chat/updateMessage/main', { key: { id: 'EDIT' } });

    await run(ctx);

    expect(ctx.http.calls.map((c) => c.path)).toEqual([
      '/chat/whatsappNumbers/main',
      '/chat/updateMessage/main',
    ]);
    // Evolution stores "5215512345678" as 525512345678@s.whatsapp.net (MX rule), not 521….
    expect(ctx.http.calls[1].body).toEqual({
      number: MX_JID,
      key: { id: 'E1', fromMe: true, remoteJid: MX_JID },
      text: 'x',
    });
    expect(ctx.logger.debug).toHaveBeenCalled();
  });

  it('validates the message ID and text before looking the number up', async () => {
    const noId = chatContext('editMessage', { remoteJid: MX_INPUT, messageId: ' ', text: 'x' });
    await expect(run(noId)).rejects.toThrow('Message ID is required');
    expect(noId.http.calls).toHaveLength(0);

    const noText = chatContext('editMessage', { remoteJid: MX_INPUT, messageId: 'E1', text: '' });
    await expect(run(noText)).rejects.toThrow('Text is required');
    expect(noText.http.calls).toHaveLength(0);
  });

  it('requires the new text', async () => {
    const ctx = chatContext('editMessage', { remoteJid: MX_JID, messageId: 'E1', text: '  ' });
    await expect(run(ctx)).rejects.toThrow('Text is required');
    expect(ctx.http.calls).toHaveLength(0);
  });
});

describe('chat > downloadMedia', () => {
  it('does not require a redundant Message ID when Full Message supplies key.id', () => {
    expect(downloadMediaDescription.find((field) => field.name === 'messageId')?.required).not.toBe(
      true,
    );
  });

  const FILE = Buffer.from('%PDF-1.4 test');
  const MEDIA_RESPONSE = {
    mediaType: 'documentMessage',
    fileName: 'invoice.pdf',
    caption: 'Invoice',
    size: { fileLength: '13' },
    mimetype: 'application/pdf',
    base64: FILE.toString('base64'),
    buffer: null,
  };

  it('downloads by message ID into a binary field and keeps metadata in JSON', async () => {
    const ctx = chatContext('downloadMedia', { messageId: 'IMG1', binaryPropertyName: 'file' });
    ctx.http.reply('POST', '/chat/getBase64FromMediaMessage/main', MEDIA_RESPONSE, 201);

    const output = await run(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/chat/getBase64FromMediaMessage/main');
    expect(call.body).toEqual({ message: { key: { id: 'IMG1' } } });
    expect(output).toHaveLength(1);
    expect(output[0].json).toEqual({
      messageId: 'IMG1',
      mediaType: 'documentMessage',
      fileName: 'invoice.pdf',
      caption: 'Invoice',
      size: { fileLength: '13' },
      mimetype: 'application/pdf',
    });
    expect(output[0].binary?.file).toMatchObject({
      data: FILE.toString('base64'),
      mimeType: 'application/pdf',
      fileName: 'invoice.pdf',
    });
    expect(output[0].pairedItem).toEqual({ item: 0 });
  });

  it('accepts the full webhook message, converts audio and keeps base64 when asked', async () => {
    const data = {
      key: { id: 'AUD1', remoteJid: MX_JID, fromMe: false },
      message: { audioMessage: { mediaKey: 'k', directPath: '/p', mimetype: 'audio/ogg' } },
      messageType: 'audioMessage',
    };
    const ctx = chatContext('downloadMedia', {
      messageId: '',
      options: {
        message: JSON.stringify(data),
        convertToMp4: true,
        includeBase64: true,
        fileName: 'voice.m4a',
      },
    });
    ctx.http.reply(
      'POST',
      '/chat/getBase64FromMediaMessage/main',
      { mediaType: 'audioMessage', mimetype: 'audio/mp4', base64: 'QUJD', buffer: null },
      201,
    );

    const output = await run(ctx);

    expect(ctx.http.calls[0].body).toEqual({ message: data, convertToMp4: true });
    expect(output[0].json).toMatchObject({
      messageId: 'AUD1',
      fileName: 'voice.m4a',
      mimetype: 'audio/mp4',
      base64: 'QUJD',
    });
    expect(output[0].binary?.data).toMatchObject({
      data: 'QUJD',
      mimeType: 'audio/mp4',
      fileName: 'voice.m4a',
    });
  });

  it('fills the key ID of a full message object from Message ID', async () => {
    const ctx = chatContext('downloadMedia', {
      messageId: 'IMG9',
      options: { message: { message: { imageMessage: { url: 'u' } } } },
    });
    ctx.http.reply('POST', '/chat/getBase64FromMediaMessage/main', MEDIA_RESPONSE, 201);

    await run(ctx);

    expect(ctx.http.calls[0].body).toEqual({
      message: { message: { imageMessage: { url: 'u' } }, key: { id: 'IMG9' } },
    });
  });

  it('fails when the message has no media (null answer)', async () => {
    const ctx = chatContext('downloadMedia', { messageId: 'TXT1' });
    ctx.http.reply('POST', '/chat/getBase64FromMediaMessage/main', null, 201);

    await expect(run(ctx)).rejects.toThrow('The message has no downloadable media');
  });

  it('shows the Evolution error for non-media messages', async () => {
    const ctx = chatContext('downloadMedia', { messageId: 'TXT1' });
    ctx.http.reply(
      'POST',
      '/chat/getBase64FromMediaMessage/main',
      {
        status: 400,
        error: 'Bad Request',
        response: { message: ['The message is not of the media type'] },
      },
      400,
    );

    await expect(run(ctx)).rejects.toMatchObject({
      message: 'Bad request: The message is not of the media type',
      httpCode: '400',
    });
  });

  it('validates the inputs', async () => {
    const empty = chatContext('downloadMedia', { messageId: '' });
    await expect(run(empty)).rejects.toThrow('Message ID is required');

    const invalid = chatContext('downloadMedia', { messageId: 'X', options: { message: '[1]' } });
    await expect(run(invalid)).rejects.toThrow('Full Message must be a JSON object');
    expect(invalid.http.calls).toHaveLength(0);
  });
});

describe('chat > get', () => {
  it('GET /chat/findChatByRemoteJid/:instance?remoteJid=', async () => {
    const ctx = chatContext('get', { remoteJid: GROUP });
    ctx.http.reply('GET', '/chat/findChatByRemoteJid/main', {
      id: 'c1',
      remoteJid: GROUP,
      name: 'Team',
      unreadMessages: 2,
    });

    const output = await run(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/chat/findChatByRemoteJid/main');
    expect(call.qs).toEqual({ remoteJid: GROUP });
    expect(call.body).toBeUndefined();
    expect(jsonOf(output)).toEqual([
      { id: 'c1', remoteJid: GROUP, name: 'Team', unreadMessages: 2 },
    ]);
  });

  it('returns no item for an unknown chat (null body)', async () => {
    const ctx = chatContext('get', { remoteJid: MX_INPUT });
    replyLookup(ctx);
    ctx.http.reply('GET', '/chat/findChatByRemoteJid/main', null);

    const output = await run(ctx);

    expect(ctx.http.calls[1].qs).toEqual({ remoteJid: MX_JID });
    expect(output).toEqual([]);
  });
});

describe('chat > getContacts', () => {
  it('filters by where.remoteJid (not where.id) and paginates with offset/page', async () => {
    const ctx = chatContext('getContacts', {
      limit: 2,
      filters: { remoteJid: MX_INPUT, pushName: ' Ana ' },
    });
    ctx.http.reply('POST', '/chat/findContacts/main', [
      { id: 'cuid1', remoteJid: MX_JID, pushName: 'Ana' },
      { id: 'cuid2', remoteJid: MX_JID, pushName: 'Ana' },
      { id: 'cuid3', remoteJid: MX_JID, pushName: 'Ana' },
    ]);

    const output = await run(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/chat/findContacts/main');
    expect(call.body).toEqual({
      where: { remoteJid: MX_NUMBER, pushName: 'Ana' },
      offset: 2,
      page: 1,
    });
    expect(jsonOf(output).map((c) => c.id)).toEqual(['cuid1', 'cuid2']);
  });

  it('returns every contact in one request with Return All', async () => {
    const ctx = chatContext('getContacts', { returnAll: true });
    ctx.http.reply('POST', '/chat/findContacts/main', [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);

    const output = await run(ctx);

    expect(ctx.http.calls[0].body).toBeUndefined();
    expect(output).toHaveLength(3);
  });
});

describe('chat > getMany', () => {
  it('POST /chat/findChats/:instance with take and a complete timestamp range', async () => {
    const ctx = chatContext('getMany', {
      limit: 10,
      filters: { remoteJid: LID, messagesAfter: '2026-09-01T00:00:00.000Z' },
    });
    ctx.http.reply('POST', '/chat/findChats/main', [{ remoteJid: LID, unreadCount: 1 }]);

    const output = await run(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/chat/findChats/main');
    const body = call.body as IDataObject;
    expect(Object.keys(body).sort()).toEqual(['take', 'where']);
    expect(body.take).toBe(10);
    const where = body.where as IDataObject;
    expect(where.remoteJid).toBe(LID);
    const range = where.messageTimestamp as IDataObject;
    expect(range.gte).toBe('2026-09-01T00:00:00.000Z');
    expect(typeof range.lte).toBe('string');
    expect(Number.isNaN(Date.parse(range.lte as string))).toBe(false);
    expect(jsonOf(output)).toEqual([{ remoteJid: LID, unreadCount: 1 }]);
  });

  it('sends no pagination with Return All and outputs one item per chat', async () => {
    const ctx = chatContext('getMany', { returnAll: true });
    ctx.http.reply('POST', '/chat/findChats/main', [{ remoteJid: 'a' }, { remoteJid: 'b' }]);

    const output = await run(ctx);

    expect(ctx.http.calls[0].body).toBeUndefined();
    expect(output).toHaveLength(2);
  });
});

describe('chat > getMessages', () => {
  it('filters with where.key (remoteJid + remoteJidAlt) and pages with page/offset', async () => {
    const ctx = chatContext('getMessages', {
      limit: 3,
      filters: {
        remoteJid: GROUP,
        messageId: 'K1',
        fromMeOnly: true,
        participant: LID,
        messageType: 'imageMessage',
        source: 'ios',
        messagesAfter: '2026-09-01T00:00:00.000Z',
        messagesBefore: '2026-09-02T00:00:00.000Z',
      },
    });
    ctx.http.reply(
      'POST',
      '/chat/findMessages/main',
      messagesPage([{ id: 'm1' }, { id: 'm2' }], 1, 1, 2),
    );

    const output = await run(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/chat/findMessages/main');
    expect(call.body).toEqual({
      page: 1,
      offset: 3,
      where: {
        key: {
          remoteJid: GROUP,
          remoteJidAlt: GROUP,
          id: 'K1',
          fromMe: true,
          participant: LID,
        },
        messageType: 'imageMessage',
        source: 'ios',
        messageTimestamp: {
          gte: '2026-09-01T00:00:00.000Z',
          lte: '2026-09-02T00:00:00.000Z',
        },
      },
    });
    expect(jsonOf(output)).toEqual([{ id: 'm1' }, { id: 'm2' }]);
  });

  it('walks every page with Return All', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: `p1-${index}` }));
    const ctx = chatContext('getMessages', { returnAll: true, filters: { remoteJid: MX_JID } });
    ctx.http
      .reply('POST', '/chat/findMessages/main', messagesPage(firstPage, 2, 1, 103))
      .reply(
        'POST',
        '/chat/findMessages/main',
        messagesPage([{ id: 'p2-0' }, { id: 'p2-1' }, { id: 'p2-2' }], 2, 2, 103),
      );

    const output = await run(ctx);

    expect(
      ctx.http.calls.map((c) => [(c.body as IDataObject).page, (c.body as IDataObject).offset]),
    ).toEqual([
      [1, 100],
      [2, 100],
    ]);
    expect(output).toHaveLength(103);
    expect(output[102].json).toEqual({ id: 'p2-2' });
    expect(new Set(output.map((item) => JSON.stringify(item.pairedItem)))).toEqual(
      new Set([JSON.stringify({ item: 0 })]),
    );
  });

  it('sends no where when there is no filter', async () => {
    const ctx = chatContext('getMessages', {});
    ctx.http.reply('POST', '/chat/findMessages/main', messagesPage([]));

    const output = await run(ctx);

    expect(ctx.http.calls[0].body).toEqual({ page: 1, offset: 50 });
    expect(output).toEqual([]);
  });
});

describe('chat > getStatusUpdates', () => {
  it('filters by where.id (message ID) and where.remoteJid', async () => {
    const ctx = chatContext('getStatusUpdates', {
      limit: 5,
      filters: { remoteJid: MX_JID, messageId: 'S1' },
    });
    ctx.http.reply('POST', '/chat/findStatusMessage/main', [
      { keyId: 'S1', status: 'DELIVERY_ACK' },
      { keyId: 'S1', status: 'READ' },
    ]);

    const output = await run(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/chat/findStatusMessage/main');
    expect(call.body).toEqual({ page: 1, offset: 5, where: { remoteJid: MX_JID, id: 'S1' } });
    expect(jsonOf(output).map((u) => u.status)).toEqual(['DELIVERY_ACK', 'READ']);
  });

  it('stops Return All on the first short page', async () => {
    const full = Array.from({ length: 100 }, (_, index) => ({ id: index }));
    const ctx = chatContext('getStatusUpdates', { returnAll: true });
    ctx.http
      .reply('POST', '/chat/findStatusMessage/main', full)
      .reply('POST', '/chat/findStatusMessage/main', [{ id: 100 }]);

    const output = await run(ctx);

    expect(ctx.http.calls.map((c) => (c.body as IDataObject).page)).toEqual([1, 2]);
    expect(output).toHaveLength(101);
  });
});

describe('chat > getChannels', () => {
  it('POST /chat/findChannels/:instance with page/limit (2.4+)', async () => {
    const ctx = chatContext('getChannels', { limit: 2 });
    ctx.http.reply('POST', '/chat/findChannels/main', {
      total: 3,
      pages: 2,
      currentPage: 1,
      limit: 2,
      records: [{ remoteJid: '1@newsletter' }, { remoteJid: '2@newsletter' }],
    });

    const output = await run(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/chat/findChannels/main');
    expect(call.body).toEqual({ page: 1, limit: 2 });
    expect(jsonOf(output)).toEqual([{ remoteJid: '1@newsletter' }, { remoteJid: '2@newsletter' }]);
  });

  it('follows the page count with Return All', async () => {
    const page1 = Array.from({ length: 100 }, (_, index) => ({ remoteJid: `${index}@newsletter` }));
    const ctx = chatContext('getChannels', { returnAll: true });
    ctx.http
      .reply('POST', '/chat/findChannels/main', { total: 101, pages: 2, records: page1 })
      .reply('POST', '/chat/findChannels/main', {
        total: 101,
        pages: 2,
        records: [{ remoteJid: 'last@newsletter' }],
      });

    const output = await run(ctx);

    expect(ctx.http.calls.map((c) => c.body)).toEqual([
      { page: 1, limit: 100 },
      { page: 2, limit: 100 },
    ]);
    expect(output).toHaveLength(101);
  });
});

describe('chat > getPollVotes', () => {
  it('POST /chat/getPollVote/:instance { message.key.id, remoteJid } (2.4+)', async () => {
    const ctx = chatContext('getPollVotes', { remoteJid: GROUP, messageId: 'POLL1' });
    const poll = {
      poll: { name: 'Lunch?', totalVotes: 2, results: { Yes: { votes: 2, voters: [] } } },
    };
    ctx.http.reply('POST', '/chat/getPollVote/main', poll);

    const output = await run(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/chat/getPollVote/main');
    expect(call.body).toEqual({ message: { key: { id: 'POLL1' } }, remoteJid: GROUP });
    expect(jsonOf(output)).toEqual([poll]);
  });

  it('requires the poll message ID', async () => {
    const ctx = chatContext('getPollVotes', { remoteJid: GROUP, messageId: '' });
    await expect(run(ctx)).rejects.toThrow('Poll Message ID is required');
  });
});

describe('chat > sendPresence', () => {
  it('POST /chat/sendPresence/:instance with the required delay and a longer timeout', async () => {
    const ctx = chatContext('sendPresence', {
      number: MX_INPUT,
      presence: 'recording',
      delay: 2500.4,
    });
    ctx.http.reply('POST', '/chat/sendPresence/main', { presence: 'recording' }, 201);

    const output = await run(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/chat/sendPresence/main');
    expect(call.body).toEqual({ number: MX_NUMBER, presence: 'recording', delay: 2500 });
    expect(call.options.timeout).toBe(62500);
    expect(jsonOf(output)).toEqual([{ presence: 'recording' }]);
  });

  it('uses the defaults (composing, 1000 ms) for every item', async () => {
    const ctx = chatContext(
      'sendPresence',
      {},
      {
        items: [{ json: {} }, { json: {} }],
        itemParams: [{ number: LID }, { number: GROUP }],
      },
    );
    ctx.http
      .reply('POST', '/chat/sendPresence/main', { presence: 'composing' }, 201)
      .reply('POST', '/chat/sendPresence/main', { presence: 'composing' }, 201);

    const output = await run(ctx);

    expect(ctx.http.calls.map((c) => c.body)).toEqual([
      { number: LID, presence: 'composing', delay: 1000 },
      { number: GROUP, presence: 'composing', delay: 1000 },
    ]);
    expect(output).toHaveLength(2);
  });

  it('requires a number', async () => {
    const ctx = chatContext('sendPresence', { number: '' });
    await expect(run(ctx)).rejects.toThrow('Number is required');
  });
});

describe('chat > updateBlockStatus', () => {
  it('POST /chat/updateBlockStatus/:instance { number, status }', async () => {
    const ctx = chatContext('updateBlockStatus', { number: MX_INPUT, blockAction: 'unblock' });
    ctx.http.reply('POST', '/chat/updateBlockStatus/main', { block: 'success' }, 201);

    const output = await run(ctx);

    const [call] = ctx.http.calls;
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/chat/updateBlockStatus/main');
    expect(call.body).toEqual({ number: MX_NUMBER, status: 'unblock' });
    expect(jsonOf(output)).toEqual([{ block: 'success' }]);
  });

  it('blocks by default', async () => {
    const ctx = chatContext('updateBlockStatus', { number: MX_JID });
    ctx.http.reply('POST', '/chat/updateBlockStatus/main', { block: 'success' }, 201);
    await execute.updateBlockStatus.call(ctx, 0);
    expect(ctx.http.calls[0].body).toEqual({ number: MX_JID, status: 'block' });
  });

  it('rejects an unknown action from an expression', async () => {
    const ctx = chatContext('updateBlockStatus', { number: MX_JID, blockAction: 'mute' });
    await expect(run(ctx)).rejects.toThrow('Unknown action "mute"');
  });
});

describe('chat > continueOnFail', () => {
  it('reports the failing item and continues with the next one', async () => {
    const ctx = chatContext(
      'markAsRead',
      {},
      {
        continueOnFail: true,
        items: [{ json: {} }, { json: {} }],
        itemParams: [
          { remoteJid: MX_JID, messageIds: '' },
          { remoteJid: MX_JID, messageIds: 'OK1' },
        ],
      },
    );
    ctx.http.reply('POST', '/chat/markMessageAsRead/main', { read: 'success' }, 201);

    const output = await run(ctx);

    expect(output).toEqual([
      { json: { error: 'At least one message ID is required' }, pairedItem: { item: 0 } },
      { json: { read: 'success' }, pairedItem: { item: 1 } },
    ]);
  });
});

describe('chat helpers', () => {
  it('fills the missing bound of a timestamp range', () => {
    expect(timestampRange('', '')).toBeUndefined();
    expect(timestampRange(undefined, '2026-01-02T00:00:00Z')).toEqual({
      gte: '1970-01-01T00:00:00.000Z',
      lte: '2026-01-02T00:00:00.000Z',
    });
    expect(toIsoDate('not a date')).toBeUndefined();
  });

  it('stops at the page count reported by the server', async () => {
    const page = Array.from({ length: 100 }, (_, index) => ({ id: index }));
    const fetchPage = jest.fn(async () => ({ records: page, pages: 3 }));
    const records = await collectPages(fetchPage);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(records).toHaveLength(300);
  });
});

describe('chat > review regressions', () => {
  it('uses the createJid MX rule when whatsappNumbers is unavailable (Cloud API)', async () => {
    // /chat/whatsappNumbers is Baileys-only; Cloud API instances store createJid(from).
    const ctx = chatContext('getMessages', { limit: 5, filters: { remoteJid: MX_INPUT } });
    ctx.http.reply(
      'POST',
      '/chat/whatsappNumbers/main',
      { status: 400, error: 'Bad Request', response: { message: ['Method not available'] } },
      400,
    );
    ctx.http.reply('POST', '/chat/findMessages/main', messagesPage([{ id: 'm1' }]));

    const output = await run(ctx);

    expect(ctx.http.calls[1].body).toEqual({
      page: 1,
      offset: 5,
      where: { key: { remoteJid: MX_JID, remoteJidAlt: MX_JID } },
    });
    expect(jsonOf(output)).toEqual([{ id: 'm1' }]);
  });

  it('validates the message IDs before looking a phone number up', async () => {
    for (const [operation, params, message] of [
      ['deleteMessage', { messageId: '' }, 'Message ID is required'],
      ['markAsRead', { messageIds: ' , ' }, 'At least one message ID is required'],
      ['markAsPlayed', { messageIds: '' }, 'At least one message ID is required'],
      ['getPollVotes', { messageId: ' ' }, 'Poll Message ID is required'],
    ] as Array<[string, IDataObject, string]>) {
      const ctx = chatContext(operation, { remoteJid: MX_INPUT, ...params });
      await expect(run(ctx)).rejects.toThrow(message);
      expect(ctx.http.calls).toHaveLength(0);
    }
  });

  it('archives a group with the given last message without any lookup', async () => {
    const ctx = chatContext('archive', {
      remoteJid: GROUP,
      options: { lastMessageId: 'G9' },
    });
    ctx.http.reply('POST', '/chat/archiveChat/main', { chatId: GROUP, archived: true }, 201);

    await run(ctx);

    expect(ctx.http.calls).toHaveLength(1);
    expect(ctx.http.calls[0].body).toEqual({
      archive: true,
      lastMessage: { key: { id: 'G9', fromMe: false, remoteJid: GROUP } },
    });
  });

  it('names converted voice notes .m4a instead of the original .oga', async () => {
    const ctx = chatContext('downloadMedia', {
      messageId: 'AUD2',
      options: { convertToMp4: true },
    });
    ctx.http.reply(
      'POST',
      '/chat/getBase64FromMediaMessage/main',
      {
        mediaType: 'audioMessage',
        fileName: 'AUD2.oga',
        size: { fileLength: '3' },
        mimetype: 'audio/mp4',
        base64: 'QUJD',
        buffer: null,
      },
      201,
    );

    const output = await run(ctx);

    expect(ctx.http.calls[0].body).toEqual({
      message: { key: { id: 'AUD2' } },
      convertToMp4: true,
    });
    expect(output[0].json.fileName).toBe('AUD2.m4a');
    expect(output[0].binary?.data).toMatchObject({
      fileName: 'AUD2.m4a',
      mimeType: 'audio/mp4',
      data: 'QUJD',
    });
  });

  it('downloads Cloud API media (no file name) for every item with its own binary', async () => {
    const data = (id: string) => ({
      key: { id, remoteJid: MX_JID, fromMe: false },
      messageType: 'imageMessage',
      message: { imageMessage: { id: `media-${id}`, mime_type: 'image/jpeg' } },
    });
    const ctx = chatContext(
      'downloadMedia',
      {},
      {
        items: [{ json: {} }, { json: {} }],
        itemParams: [
          { messageId: 'wamid.A1', options: { message: data('wamid.A1') } },
          { messageId: 'wamid.B2', options: { message: data('wamid.B2') } },
        ],
      },
    );
    const first = Buffer.from('JPEG-A').toString('base64');
    const second = Buffer.from('JPEG-B').toString('base64');
    ctx.http
      .reply(
        'POST',
        '/chat/getBase64FromMediaMessage/main',
        { mediaType: 'imageMessage', mimetype: 'image/jpeg', base64: first },
        201,
      )
      .reply(
        'POST',
        '/chat/getBase64FromMediaMessage/main',
        { mediaType: 'imageMessage', mimetype: 'image/jpeg', base64: second },
        201,
      );

    const output = await run(ctx);

    expect(ctx.http.calls.map((c) => c.body)).toEqual([
      { message: data('wamid.A1') },
      { message: data('wamid.B2') },
    ]);
    expect(output.map((item) => item.json.fileName)).toEqual(['wamid.A1.jpg', 'wamid.B2.jpg']);
    expect(output.map((item) => item.binary?.data?.data)).toEqual([first, second]);
    expect(output.map((item) => item.pairedItem)).toEqual([{ item: 0 }, { item: 1 }]);
  });

  it('fills a missing chat name from the last received message (EVOAPI-14)', async () => {
    const ctx = chatContext('getMany', { limit: 10 });
    ctx.http.reply('POST', '/chat/findChats/main', [
      {
        remoteJid: MX_JID,
        pushName: null,
        lastMessage: { key: { remoteJid: MX_JID, fromMe: false, id: 'A' }, pushName: 'Ana' },
      },
      {
        remoteJid: '5511999999999@s.whatsapp.net',
        pushName: null,
        lastMessage: { key: { fromMe: true, id: 'B' }, pushName: 'Você' },
      },
      { remoteJid: GROUP, pushName: 'Team', lastMessage: { key: { id: 'C' }, pushName: 'Bob' } },
      { remoteJid: LID, pushName: 'Carla', lastMessage: { key: { id: 'D' }, pushName: 'Old' } },
    ]);

    const output = await run(ctx);

    expect(jsonOf(output).map((chat) => chat.pushName)).toEqual(['Ana', null, 'Team', 'Carla']);
  });
});

describe('chat helpers > evolutionJid (createJid rules)', () => {
  it('mirrors Evolution createJid for phone numbers, groups and JIDs', () => {
    expect(evolutionJid(MX_INPUT)).toBe(MX_JID);
    expect(evolutionJid('525512345678')).toBe(MX_JID);
    expect(evolutionJid('5491123456789')).toBe('541123456789@s.whatsapp.net');
    // Brazil: the 9th digit is dropped only for DDD >= 31 and a first local digit >= 7.
    expect(evolutionJid('5531987654321')).toBe('553187654321@s.whatsapp.net');
    expect(evolutionJid('5511987654321')).toBe('5511987654321@s.whatsapp.net');
    expect(evolutionJid('5531912345678')).toBe('5531912345678@s.whatsapp.net');
    expect(evolutionJid('120363025246125486')).toBe(GROUP);
    // JIDs are never rewritten (EVONODE-13), not even a non-canonical MX JID.
    expect(evolutionJid('5215512345678@s.whatsapp.net')).toBe('5215512345678@s.whatsapp.net');
    expect(evolutionJid(LID)).toBe(LID);
    expect(evolutionJid('')).toBe('');
  });
});

describe('chat helpers > mediaFileName', () => {
  it('keeps a real file name and fixes the broken ones', () => {
    expect(
      mediaFileName({ fileName: 'invoice.pdf', mimetype: 'application/pdf' }, 'X', false),
    ).toBe('invoice.pdf');
    expect(
      mediaFileName({ fileName: 'X.oga', mimetype: 'audio/ogg; codecs=opus' }, 'X', false),
    ).toBe('X.oga');
    expect(mediaFileName({ fileName: 'X.oga', mimetype: 'audio/mp4' }, 'X', true)).toBe('X.m4a');
    expect(mediaFileName({ fileName: 'X.false', mimetype: 'image/webp' }, 'X', false)).toBe(
      'X.webp',
    );
    expect(mediaFileName({ fileName: 'X.false', mimetype: 'x/unknown' }, 'X', false)).toBe('X');
    expect(mediaFileName({ mimetype: 'video/mp4' }, 'wamid.HBg', false)).toBe('wamid.HBg.mp4');
    expect(mediaFileName({}, 'ID1', false)).toBe('ID1');
  });
});

describe('chat > withPushNameFallback', () => {
  it('only fills empty names of 1:1 chats from a received last message', () => {
    const received = { key: { fromMe: false }, pushName: ' Ana ' };
    expect(
      withPushNameFallback({ remoteJid: MX_JID, pushName: '', lastMessage: received }),
    ).toEqual({ remoteJid: MX_JID, pushName: 'Ana', lastMessage: received });
    expect(withPushNameFallback({ remoteJid: MX_JID })).toEqual({ remoteJid: MX_JID });
    const own = { key: { fromMe: 'true' }, pushName: 'Você' };
    expect(withPushNameFallback({ remoteJid: MX_JID, lastMessage: own }).pushName).toBeUndefined();
  });
});
