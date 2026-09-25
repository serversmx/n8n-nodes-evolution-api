import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import { REQUIRES_24 } from '../../constants';
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
    description: `${CHAT_JID_DESCRIPTION} …@lid chats are skipped without an error (the server still answers success): use the phone JID. ${REQUIRES_24}`,
  },
  {
    displayName: 'Message IDs',
    name: 'messageIds',
    type: 'string',
    required: true,
    default: '',
    placeholder: '3EB0C767D26A1D7B5C2A',
    description:
      'ID (key.id) of the voice message to mark as played. Separate several IDs of the same chat with commas.',
  },
  {
    displayName: 'From Me',
    name: 'fromMe',
    type: 'boolean',
    default: false,
    description:
      'Whether the messages were sent by this instance (key.fromMe). Usually off: you mark received voice messages as played.',
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['chat'], operation: ['markAsPlayed'] } },
  properties,
);

/**
 * POST /chat/markMessageAsPlayed/:instanceName { playedMessages: [{ id, fromMe, remoteJid }] }
 * (markMessageAsPlayedSchema, 201, new in 2.4) → { message: 'Played messages', played: 'success' }.
 * Sends the "played" receipt (blue microphone). Keys whose remoteJid is not a group or phone JID
 * (@lid) are skipped silently. 2.3.x answers 404 "Cannot POST".
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
    `/chat/markMessageAsPlayed/${instance}`,
    { playedMessages: ids.map((id) => ({ id, fromMe, remoteJid })) },
    {},
    { itemIndex },
  )) as IDataObject;
}
