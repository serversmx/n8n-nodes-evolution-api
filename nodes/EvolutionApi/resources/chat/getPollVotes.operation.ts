import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { REQUIRES_24 } from '../../constants';
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
    description: `Chat where the poll was sent. ${CHAT_JID_DESCRIPTION} ${REQUIRES_24}`,
  },
  {
    displayName: 'Poll Message ID',
    name: 'messageId',
    type: 'string',
    required: true,
    default: '',
    placeholder: '3EB0C767D26A1D7B5C2A',
    description: `ID (key.id) of the poll message itself (not of a vote). ${REQUIRES_24}`,
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['chat'], operation: ['getPollVotes'] } },
  properties,
);

/**
 * POST /chat/getPollVote/:instanceName { message: { key: { id } }, remoteJid }
 * (decryptPollVoteSchema, 200, new in 2.4) →
 * { poll: { name, totalVotes, results: { <option>: { votes, voters: [jid] } } } }.
 * Needs the poll message (with its messageSecret) and the votes stored in Evolution's database;
 * otherwise 500 "Error decrypting poll votes". 2.3.x answers 404 "Cannot POST".
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  // Validate first: a phone number costs a whatsappNumbers lookup.
  const id = requireString.call(this, itemIndex, 'messageId', 'Poll Message ID');
  const remoteJid = await requireChatJid.call(
    this,
    itemIndex,
    instance,
    this.getNodeParameter('remoteJid', itemIndex, ''),
  );

  return (await evolutionApiRequest.call(
    this,
    'POST',
    `/chat/getPollVote/${instance}`,
    { message: { key: { id } }, remoteJid },
    {},
    { itemIndex, idempotent: true },
  )) as IDataObject;
}
