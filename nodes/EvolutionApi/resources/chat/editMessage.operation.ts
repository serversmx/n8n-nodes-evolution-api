import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';
import { CHAT_JID_DESCRIPTION, requireChatJid, requireString } from './helpers';

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
    displayName: 'Message ID',
    name: 'messageId',
    type: 'string',
    required: true,
    default: '',
    placeholder: '3EB0C767D26A1D7B5C2A',
    description: 'ID (key.id) of the message to edit. It must have been sent by this instance.',
  },
  {
    displayName: 'Text',
    name: 'text',
    type: 'string',
    required: true,
    default: '',
    typeOptions: { rows: 4 },
    description:
      'New text of the message, or new caption of an image or video. WhatsApp only accepts edits for about 15 minutes after sending.',
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['chat'], operation: ['editMessage'] } },
  properties,
);

/**
 * POST /chat/updateMessage/:instanceName { number, key: { id, fromMe: true, remoteJid }, text }
 * (updateMessageSchema, 200) → Baileys WAMessage of the edit (protocolMessage).
 * Only text messages and image/video captions are editable (400 "Message not compatible").
 * With message storage on, createJid(number) must equal the stored key.remoteJid
 * (400 "RemoteJid does not match"), so the resolved chat JID is sent as both.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  // Validate first: a phone number costs a whatsappNumbers lookup.
  const id = requireString.call(this, itemIndex, 'messageId', 'Message ID');
  const text = String(this.getNodeParameter('text', itemIndex, '') ?? '');
  if (!text.trim()) {
    throw new NodeOperationError(this.getNode(), 'Text is required', { itemIndex });
  }
  const remoteJid = await requireChatJid.call(
    this,
    itemIndex,
    instance,
    this.getNodeParameter('remoteJid', itemIndex, ''),
  );

  return (await evolutionApiRequest.call(
    this,
    'POST',
    `/chat/updateMessage/${instance}`,
    { number: remoteJid, key: { id, fromMe: true, remoteJid }, text },
    {},
    { itemIndex },
  )) as IDataObject;
}
