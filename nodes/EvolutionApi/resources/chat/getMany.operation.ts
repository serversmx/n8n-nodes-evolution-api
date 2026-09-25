import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import {
  compactObject,
  evolutionApiRequest,
  isPlainObject,
  normalizeNumber,
  resolveInstanceName,
  toArray,
} from '../../GenericFunctions';
import { getLimit, paginationFields, timestampRange } from './helpers';

const properties: INodeProperties[] = [
  ...paginationFields('chats'),
  {
    displayName: 'Filters',
    name: 'filters',
    type: 'collection',
    placeholder: 'Add Filter',
    default: {},
    options: [
      {
        displayName: 'Chat',
        name: 'remoteJid',
        type: 'string',
        default: '',
        placeholder: '5215512345678',
        description:
          'Phone number with country code or JID (…@s.whatsapp.net, …@g.us, …@lid) of the chat',
      },
      {
        displayName: 'Messages After',
        name: 'messagesAfter',
        type: 'dateTime',
        default: '',
        description:
          'Only chats with a message sent after this date; lastMessage is then the latest message in the date range',
      },
      {
        displayName: 'Messages Before',
        name: 'messagesBefore',
        type: 'dateTime',
        default: '',
        description:
          'Only chats with a message sent before this date; lastMessage is then the latest message in the date range',
      },
    ],
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['chat'], operation: ['getMany'] } },
  properties,
);

/**
 * EVOAPI-14: `pushName` of a 1:1 chat can be null. 2.3.7 and 2.4 (PostgreSQL) select a second
 * "pushName" column, Chat.name, which overwrites the Contact/Message name and is null when the
 * chat row is missing or never got a name; develop keeps only Contact.pushName. The name is then
 * taken from the last message when the contact sent it (Evolution writes "Você" for own
 * messages). Groups keep their subject; the number stays available in `remoteJid`.
 */
export function withPushNameFallback(chat: IDataObject): IDataObject {
  if (typeof chat.pushName === 'string' && chat.pushName.trim()) return chat;
  if (String(chat.remoteJid ?? '').endsWith('@g.us')) return chat;
  const lastMessage = isPlainObject(chat.lastMessage) ? chat.lastMessage : {};
  const key = isPlainObject(lastMessage.key) ? lastMessage.key : {};
  const name = typeof lastMessage.pushName === 'string' ? lastMessage.pushName.trim() : '';
  if (!name || key.fromMe === true || key.fromMe === 'true') return chat;
  return { ...chat, pushName: name };
}

/**
 * POST /chat/findChats/:instanceName { where?: { remoteJid?, messageTimestamp?: { gte, lte } },
 * take?, skip? } (200) → [{ id, remoteJid, pushName, profilePicUrl, updatedAt, windowStart,
 * windowExpires, windowActive, lastMessage, unreadCount, isSaved }], newest first.
 * Pagination is `take`/`skip` (page/offset are ignored: EVONODE-5). Chats are built from stored
 * messages, so chats without stored messages are missing. A missing pushName is filled from the
 * last received message (EVOAPI-14).
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject[]> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
  const limit = getLimit.call(this, itemIndex);

  const where = compactObject({
    remoteJid: normalizeNumber(filters.remoteJid),
    messageTimestamp: timestampRange(filters.messagesAfter, filters.messagesBefore),
  });
  const body: IDataObject = {};
  if (Object.keys(where).length > 0) body.where = where;
  // Without take/skip Evolution returns every chat in one response.
  if (limit !== undefined) body.take = limit;

  const response = await evolutionApiRequest.call(
    this,
    'POST',
    `/chat/findChats/${instance}`,
    body,
    {},
    { itemIndex, idempotent: true },
  );
  const chats = toArray(response).map(withPushNameFallback);
  return limit === undefined ? chats : chats.slice(0, limit);
}
