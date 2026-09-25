import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { toJid } from '../../GenericFunctions';
import { getString, operationError, postMessage } from './helpers';

const properties: INodeProperties[] = [
  {
    displayName: 'Chat JID',
    name: 'remoteJid',
    type: 'string',
    required: true,
    default: '',
    placeholder: '5215512345678@s.whatsapp.net',
    description:
      'Chat of the message to react to (key.remoteJid of the webhook or send response): …@s.whatsapp.net, …@g.us or …@lid. A plain number becomes …@s.whatsapp.net.',
  },
  {
    displayName: 'Message ID',
    name: 'messageId',
    type: 'string',
    required: true,
    default: '',
    placeholder: '3EB0C767D26A1D8E5F2A',
    description: 'ID (key.id) of the message to react to',
  },
  {
    displayName: 'From Me',
    name: 'fromMe',
    type: 'boolean',
    default: false,
    description: 'Whether the message was sent by this instance (key.fromMe)',
  },
  {
    displayName: 'Reaction',
    name: 'reaction',
    type: 'string',
    default: '👍',
    description: 'Exactly one emoji. Leave empty to remove a previous reaction.',
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
          'Groups only: JID of the member who sent the message (key.participant). Needed to react to messages of other members.',
      },
    ],
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['message'], operation: ['sendReaction'] } },
  properties,
);

/**
 * POST /message/sendReaction/:instanceName (reactionMessageSchema, HTTP 201)
 * { key: { id, remoteJid, fromMe, participant? }, reaction }. There is no `number`: the reaction
 * goes to key.remoteJid. Evolution answers 400 "Reaction must be a single emoji or empty string".
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const node = this.getNode();
  const remoteJid = toJid(this.getNodeParameter('remoteJid', itemIndex, ''));
  const id = getString.call(this, 'messageId', itemIndex);
  if (!remoteJid) throw operationError(node, itemIndex, 'Chat JID is required');
  if (!id) throw operationError(node, itemIndex, 'Message ID is required');

  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
  const key: IDataObject = {
    id,
    remoteJid,
    fromMe: this.getNodeParameter('fromMe', itemIndex, false) === true,
  };
  const participant = String(options.participant ?? '').trim();
  if (participant) key.participant = toJid(participant);

  const reaction = String(this.getNodeParameter('reaction', itemIndex, '') ?? '').trim();
  return await postMessage.call(this, itemIndex, 'sendReaction', { key, reaction });
}
