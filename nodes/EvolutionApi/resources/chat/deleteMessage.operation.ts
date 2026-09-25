import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';
import { CHAT_JID_DESCRIPTION, requireChatJid, requireString, resolveChatJid } from './helpers';

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
    description: 'ID (key.id) of the message to delete',
  },
  {
    displayName: 'From Me',
    name: 'fromMe',
    type: 'boolean',
    default: true,
    description:
      'Whether the message was sent by this instance (key.fromMe). Turn it off to delete a message of another participant in a group where this instance is an admin.',
  },
  {
    displayName: 'Options',
    name: 'options',
    type: 'collection',
    placeholder: 'Add Option',
    default: {},
    options: [
      {
        displayName: 'Participant',
        name: 'participant',
        type: 'string',
        default: '',
        placeholder: '5215512345678@s.whatsapp.net',
        description:
          'Groups only: JID of the member who sent the message (key.participant). Needed to delete the message of another member.',
      },
    ],
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['chat'], operation: ['deleteMessage'] } },
  properties,
);

/**
 * DELETE /chat/deleteMessageForEveryone/:instanceName { id, fromMe, remoteJid, participant? }
 * (deleteMessageSchema, 201, JSON body on DELETE) → Baileys WAMessage of the REVOKE message.
 * remoteJid and participant are used verbatim: JIDs (@lid included) are never rewritten.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  // Validate first: a phone number costs a whatsappNumbers lookup.
  const id = requireString.call(this, itemIndex, 'messageId', 'Message ID');
  const remoteJid = await requireChatJid.call(
    this,
    itemIndex,
    instance,
    this.getNodeParameter('remoteJid', itemIndex, ''),
  );
  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

  const body: IDataObject = {
    id,
    fromMe: this.getNodeParameter('fromMe', itemIndex, true) as boolean,
    remoteJid,
  };
  const participant = await resolveChatJid.call(this, itemIndex, instance, options.participant);
  if (participant) body.participant = participant;

  return (await evolutionApiRequest.call(
    this,
    'DELETE',
    `/chat/deleteMessageForEveryone/${instance}`,
    body,
    {},
    { itemIndex },
  )) as IDataObject;
}
