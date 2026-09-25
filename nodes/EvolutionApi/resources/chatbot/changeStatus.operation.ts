import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName, toJid } from '../../GenericFunctions';
import { parseBotType, withChatbotHint } from './helpers';

/** "Remote JID" of the session operations (a phone number is turned into a full JID). */
export function remoteJidProperty(description: string): INodeProperties {
  return {
    displayName: 'Remote JID',
    name: 'remoteJid',
    type: 'string',
    required: true,
    default: '',
    placeholder: '5215512345678@s.whatsapp.net',
    description,
  };
}

/** Read and validate the "Remote JID" parameter. */
export function getRemoteJid(this: IExecuteFunctions, itemIndex: number): string {
  const remoteJid = toJid(this.getNodeParameter('remoteJid', itemIndex, ''));
  if (!remoteJid) {
    throw new NodeOperationError(this.getNode(), 'Remote JID is required', { itemIndex });
  }
  return remoteJid;
}

const properties: INodeProperties[] = [
  remoteJidProperty(
    'Contact or group of the session. Best: the exact JID from the incoming message (data.key.remoteJid, e.g. …@s.whatsapp.net, …@g.us, …@lid). A phone number is turned into …@s.whatsapp.net as typed, but this route does not apply WhatsApp number rules, so e.g. a Mexican 521… number will not match a session stored as 52….',
  ),
  {
    displayName: 'Status',
    name: 'sessionStatus',
    type: 'options',
    options: [
      {
        name: 'Close',
        value: 'closed',
        description:
          'End the session. With "Keep Open" in the settings it is kept as closed: on 2.3.x the bot then stays silent for the contact, while Evolution API v2.4 and later start the bot again on the next message. Otherwise it is deleted. Applies to the bot sessions of this contact of every bot type on every instance of the server.',
      },
      {
        name: 'Delete',
        value: 'delete',
        description:
          'Delete the bot sessions of this contact of every bot type on every instance of the server; the next message can start a bot again',
      },
      {
        name: 'Open',
        value: 'opened',
        description:
          'Resume a paused session (bot sessions of this contact of every bot type on this instance)',
      },
      {
        name: 'Pause',
        value: 'paused',
        description:
          'The bot ignores the contact until the session is opened again. Use it to hand the chat over to a human (bot sessions of this contact of every bot type on this instance).',
      },
    ],
    default: 'paused',
    description:
      'New session status. Use Pause for a human handoff: Close does not keep the bot silent on Evolution API v2.4 and later.',
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['chatbot'], operation: ['changeStatus'] } },
  properties,
);

/**
 * POST /:botType/changeStatus/:instanceName { remoteJid, status } (<bot>StatusSchema, identical
 * in 2.3.7 and 2.4). Scope (base-chatbot.controller.ts#changeStatus): opened/paused update the
 * sessions of that remoteJid on this instance; closed/delete run WHERE remoteJid AND botId NOT
 * NULL with no instance or type filter. Answers 200:
 * delete { bot: { remoteJid, status } }; closed { bot: { instanceName, bot: { remoteJid, status } } };
 * opened/paused { bot: { instanceName, bot: { remoteJid, status, session: { count } } } }.
 * Typebot also emits TYPEBOT_CHANGE_STATUS. Errors answer 500 "Error changing <Integration> status".
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const botType = parseBotType(
    this.getNode(),
    this.getNodeParameter('botType', itemIndex),
    itemIndex,
  );
  const remoteJid = getRemoteJid.call(this, itemIndex);
  const status = this.getNodeParameter('sessionStatus', itemIndex, 'paused') as string;
  try {
    return (await evolutionApiRequest.call(
      this,
      'POST',
      `/${botType.value}/changeStatus/${instance}`,
      { remoteJid, status },
      {},
      { itemIndex },
    )) as IDataObject;
  } catch (error) {
    throw withChatbotHint(error, 'Check the Remote JID and that the integration is enabled.');
  }
}
