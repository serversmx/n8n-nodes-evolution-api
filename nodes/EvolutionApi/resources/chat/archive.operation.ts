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
    displayName: 'Archive',
    name: 'archive',
    type: 'boolean',
    default: true,
    description: 'Whether to archive the chat (on) or move it out of the archive (off)',
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
  { show: { resource: ['chat'], operation: ['archive'] } },
  properties,
);

/**
 * POST /chat/archiveChat/:instanceName { archive, lastMessage: { key, messageTimestamp? } }
 * (archiveChatSchema, 201) → { chatId, archived: true }.
 *
 * WhatsApp needs the chat's latest message to archive it. Without "Last Message ID" the node
 * reads it from Evolution's stored messages (findMessages) and sends it as `lastMessage`:
 * Evolution 2.3.7 cannot look it up itself when only `chat` is sent (broken JSON filter, fixed in
 * 2.4), and 2.4 would search the same table. Nothing stored fails with a clear error.
 * Evolution reports `archived: true` for unarchive too; the output reflects the request instead.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const chat = await requireChatJid.call(
    this,
    itemIndex,
    instance,
    this.getNodeParameter('remoteJid', itemIndex, ''),
  );
  const archive = this.getNodeParameter('archive', itemIndex, true) as boolean;
  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
  const lastMessage = await requireLastMessage.call(this, itemIndex, instance, chat, options);

  const response = (await evolutionApiRequest.call(
    this,
    'POST',
    `/chat/archiveChat/${instance}`,
    { archive, lastMessage },
    {},
    { itemIndex },
  )) as IDataObject;
  return { ...response, archived: archive };
}
