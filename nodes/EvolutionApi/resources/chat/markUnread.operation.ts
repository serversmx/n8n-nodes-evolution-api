import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';
import {
  CHAT_JID_DESCRIPTION,
  lastMessageOptions,
  requireChatJid,
  requireLastMessage,
} from './helpers';

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
  {
    displayName: 'Options',
    name: 'options',
    type: 'collection',
    placeholder: 'Add Option',
    default: {},
    options: [...lastMessageOptions],
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['chat'], operation: ['markUnread'] } },
  properties,
);

/**
 * POST /chat/markChatUnread/:instanceName { lastMessage: { key, messageTimestamp? } }
 * (markChatUnreadSchema requires lastMessage, 201) → { chatId, markedChatUnread: true }.
 * Without "Last Message ID" the latest stored message of the chat is looked up first.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const chat = await requireChatJid.call(
    this,
    itemIndex,
    instance,
    this.getNodeParameter('remoteJid', itemIndex, ''),
  );
  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
  const lastMessage = await requireLastMessage.call(this, itemIndex, instance, chat, options);

  return (await evolutionApiRequest.call(
    this,
    'POST',
    `/chat/markChatUnread/${instance}`,
    { lastMessage },
    {},
    { itemIndex },
  )) as IDataObject;
}
