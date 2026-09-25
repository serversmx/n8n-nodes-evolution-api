import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';
import {
  CHAT_JID_DESCRIPTION,
  chatKeyFilter,
  collectPages,
  extractMessageRecords,
  getLimit,
  paginationFields,
  resolveChatJid,
  timestampRange,
} from './helpers';

const properties: INodeProperties[] = [
  ...paginationFields('messages'),
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
        placeholder: '5215512345678@s.whatsapp.net',
        description: `Only messages of this chat. ${CHAT_JID_DESCRIPTION}`,
      },
      {
        displayName: 'Message ID',
        name: 'messageId',
        type: 'string',
        default: '',
        placeholder: '3EB0C767D26A1D7B5C2A',
        description: 'Only the message with this ID (key.id)',
      },
      {
        displayName: 'Message Type',
        name: 'messageType',
        type: 'string',
        default: '',
        placeholder: 'imageMessage',
        description:
          'Only messages of this type, e.g. conversation, extendedTextMessage, imageMessage, videoMessage, audioMessage, documentMessage, stickerMessage, reactionMessage, pollCreationMessage',
      },
      {
        displayName: 'Messages After',
        name: 'messagesAfter',
        type: 'dateTime',
        default: '',
        description: 'Only messages sent after this date',
      },
      {
        displayName: 'Messages Before',
        name: 'messagesBefore',
        type: 'dateTime',
        default: '',
        description: 'Only messages sent before this date',
      },
      {
        displayName: 'Only Sent by Me',
        name: 'fromMeOnly',
        type: 'boolean',
        default: false,
        description: 'Whether to return only messages sent by this instance (key.fromMe)',
      },
      {
        displayName: 'Participant',
        name: 'participant',
        type: 'string',
        default: '',
        placeholder: '5215512345678@s.whatsapp.net',
        description: 'Groups only: JID of the member who sent the messages (key.participant)',
      },
      {
        displayName: 'Source',
        name: 'source',
        type: 'options',
        options: [
          { name: 'Android', value: 'android' },
          { name: 'Desktop', value: 'desktop' },
          { name: 'iOS', value: 'ios' },
          { name: 'Unknown', value: 'unknown' },
          { name: 'Web', value: 'web' },
        ],
        default: 'android',
        description: 'Only messages sent from this kind of device',
      },
    ],
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['chat'], operation: ['getMessages'] } },
  properties,
);

/**
 * POST /chat/findMessages/:instanceName { where?: { key?: { id?, remoteJid?, remoteJidAlt?,
 * fromMe?, participant? }, messageType?, source?, messageTimestamp?: { gte, lte } }, page, offset }
 * (messageValidateSchema, 200) → { messages: { total, pages, currentPage, records } }, newest first.
 * `offset` is the page size and `page` starts at 1. `key.fromMe: false` is ignored by Evolution
 * (truthy check), so only "sent by me" can be filtered. Outputs one item per message.
 * Reads Evolution's database (DATABASE_SAVE_DATA_NEW_MESSAGE).
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject[]> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
  const limit = getLimit.call(this, itemIndex);

  const key: IDataObject = {};
  const remoteJid = await resolveChatJid.call(this, itemIndex, instance, filters.remoteJid);
  if (remoteJid) Object.assign(key, chatKeyFilter(remoteJid));
  const messageId = String(filters.messageId ?? '').trim();
  if (messageId) key.id = messageId;
  if (filters.fromMeOnly === true) key.fromMe = true;
  const participant = await resolveChatJid.call(this, itemIndex, instance, filters.participant);
  if (participant) key.participant = participant;

  const where: IDataObject = {};
  if (Object.keys(key).length > 0) where.key = key;
  const messageType = String(filters.messageType ?? '').trim();
  if (messageType) where.messageType = messageType;
  if (typeof filters.source === 'string' && filters.source) where.source = filters.source;
  const messageTimestamp = timestampRange(filters.messagesAfter, filters.messagesBefore);
  if (messageTimestamp) where.messageTimestamp = messageTimestamp;

  return await collectPages(async (page, pageSize) => {
    const body: IDataObject = { page, offset: pageSize };
    if (Object.keys(where).length > 0) body.where = where;
    const response = await evolutionApiRequest.call(
      this,
      'POST',
      `/chat/findMessages/${instance}`,
      body,
      {},
      { itemIndex, idempotent: true },
    );
    return extractMessageRecords(response);
  }, limit);
}
