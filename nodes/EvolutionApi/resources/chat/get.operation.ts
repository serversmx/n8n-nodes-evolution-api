import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRawRequest, isPlainObject, resolveInstanceName } from '../../GenericFunctions';
import { CHAT_JID_DESCRIPTION, requireChatJid } from './helpers';

const properties: INodeProperties[] = [
  {
    displayName: 'Chat',
    name: 'remoteJid',
    type: 'string',
    required: true,
    default: '',
    placeholder: '5215512345678@s.whatsapp.net',
    description: CHAT_JID_DESCRIPTION,
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['chat'], operation: ['get'] } },
  properties,
);

/**
 * GET /chat/findChatByRemoteJid/:instanceName?remoteJid=<exact JID> (200) →
 * { id, remoteJid, name, labels, unreadMessages, createdAt, updatedAt, instanceId } or null.
 * Reads Evolution's database (every channel). An unknown chat returns no item.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject[]> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const remoteJid = await requireChatJid.call(
    this,
    itemIndex,
    instance,
    this.getNodeParameter('remoteJid', itemIndex, ''),
  );

  const response = await evolutionApiRawRequest.call(
    this,
    'GET',
    `/chat/findChatByRemoteJid/${instance}`,
    {},
    { remoteJid },
    { itemIndex },
  );
  return isPlainObject(response.body) && Object.keys(response.body).length > 0
    ? [response.body]
    : [];
}
