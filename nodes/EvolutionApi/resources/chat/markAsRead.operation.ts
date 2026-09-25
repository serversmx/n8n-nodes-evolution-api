import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';
import { CHAT_JID_DESCRIPTION, requireChatJid, splitList } from './helpers';

const properties: INodeProperties[] = [
  {
    displayName: 'Chat',
    name: 'remoteJid',
    type: 'string',
    required: true,
    default: '',
    placeholder: '5215512345678@s.whatsapp.net',
    description: `${CHAT_JID_DESCRIPTION} On Evolution API 2.3.x, …@lid chats are skipped without an error (the server still answers success): use the phone JID (key.remoteJidAlt).`,
  },
  {
    displayName: 'Message IDs',
    name: 'messageIds',
    type: 'string',
    required: true,
    default: '',
    placeholder: '3EB0C767D26A1D7B5C2A',
    description:
      'ID (key.id) of the message to mark as read. Separate several IDs of the same chat with commas.',
  },
  {
    displayName: 'From Me',
    name: 'fromMe',
    type: 'boolean',
    default: false,
    description:
      'Whether the messages were sent by this instance (key.fromMe). Usually off: you mark received messages as read.',
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['chat'], operation: ['markAsRead'] } },
  properties,
);

/**
 * POST /chat/markMessageAsRead/:instanceName { readMessages: [{ id, fromMe, remoteJid }] }
 * (readMessageSchema, 201) → { message: 'Read messages', read: 'success' }.
 * remoteJid is used verbatim. 2.3.7 keeps only group and phone JIDs (EVOAPI-12: @lid keys are
 * dropped silently); 2.4 keeps everything except broadcast and newsletter JIDs.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  // Validate first: a phone number costs a whatsappNumbers lookup.
  const ids = splitList(this.getNodeParameter('messageIds', itemIndex, ''));
  if (ids.length === 0) {
    throw new NodeOperationError(this.getNode(), 'At least one message ID is required', {
      itemIndex,
    });
  }
  const remoteJid = await requireChatJid.call(
    this,
    itemIndex,
    instance,
    this.getNodeParameter('remoteJid', itemIndex, ''),
  );
  const fromMe = this.getNodeParameter('fromMe', itemIndex, false) as boolean;

  return (await evolutionApiRequest.call(
    this,
    'POST',
    `/chat/markMessageAsRead/${instance}`,
    { readMessages: ids.map((id) => ({ id, fromMe, remoteJid })) },
    {},
    { itemIndex },
  )) as IDataObject;
}
