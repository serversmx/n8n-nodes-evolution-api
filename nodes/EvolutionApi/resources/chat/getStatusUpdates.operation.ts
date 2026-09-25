import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName, toArray } from '../../GenericFunctions';
import {
  CHAT_JID_DESCRIPTION,
  collectPages,
  getLimit,
  paginationFields,
  resolveChatJid,
} from './helpers';

const properties: INodeProperties[] = [
  ...paginationFields('status updates'),
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
        description: `Only updates of messages in this chat. ${CHAT_JID_DESCRIPTION}`,
      },
      {
        displayName: 'Message ID',
        name: 'messageId',
        type: 'string',
        default: '',
        placeholder: '3EB0C767D26A1D7B5C2A',
        description: 'Only updates of the message with this ID (key.id)',
      },
    ],
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['chat'], operation: ['getStatusUpdates'] } },
  properties,
);

/**
 * POST /chat/findStatusMessage/:instanceName { where?: { remoteJid?, id? }, page, offset }
 * (messageUpSchema, 200) → [{ id, keyId, remoteJid, fromMe, participant, pollUpdates, status,
 * messageId, instanceId }]. These are delivery/read receipts of messages (SERVER_ACK,
 * DELIVERY_ACK, READ, PLAYED, DELETED, EDITED), not WhatsApp Status stories. `where.id` matches the
 * WhatsApp message ID (keyId); Evolution ignores the fromMe/participant/status filters, so they
 * are not offered. Reads Evolution's database (DATABASE_SAVE_DATA_MESSAGE_UPDATE).
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject[]> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
  const limit = getLimit.call(this, itemIndex);

  const where: IDataObject = {};
  const remoteJid = await resolveChatJid.call(this, itemIndex, instance, filters.remoteJid);
  if (remoteJid) where.remoteJid = remoteJid;
  const messageId = String(filters.messageId ?? '').trim();
  if (messageId) where.id = messageId;

  return await collectPages(async (page, pageSize) => {
    const body: IDataObject = { page, offset: pageSize };
    if (Object.keys(where).length > 0) body.where = where;
    const response = await evolutionApiRequest.call(
      this,
      'POST',
      `/chat/findStatusMessage/${instance}`,
      body,
      {},
      { itemIndex, idempotent: true },
    );
    return { records: toArray(response) };
  }, limit);
}
