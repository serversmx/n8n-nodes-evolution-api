import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import {
  encodePathSegment,
  evolutionApiRequest,
  resolveInstanceName,
  toArray,
  toJid,
} from '../../GenericFunctions';
import { parseBotType, redactBotSecrets } from './helpers';

const properties: INodeProperties[] = [
  {
    displayName: 'Filters',
    name: 'filters',
    type: 'collection',
    placeholder: 'Add Filter',
    default: {},
    description: 'Applied by the node to the sessions Evolution returns',
    options: [
      {
        displayName: 'Remote JID',
        name: 'remoteJid',
        type: 'string',
        default: '',
        placeholder: '5215512345678@s.whatsapp.net',
        description: 'Only the session of this contact or group (number or JID)',
      },
      {
        displayName: 'Status',
        name: 'status',
        type: 'options',
        options: [
          { name: 'Closed', value: 'closed' },
          { name: 'Opened', value: 'opened' },
          { name: 'Paused', value: 'paused' },
        ],
        default: 'opened',
      },
    ],
  },
  {
    displayName: 'Options',
    name: 'options',
    type: 'collection',
    placeholder: 'Add Option',
    default: {},
    options: [
      {
        displayName: 'Include Secrets',
        name: 'includeSecrets',
        type: 'boolean',
        default: false,
        description:
          'Whether to keep the API keys stored in the session parameters. Typebot sessions store the global API key of the Evolution server there, so it is removed by default.',
      },
    ],
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['chatbot'], operation: ['getSessions'] } },
  properties,
);

/**
 * GET /:botType/fetchSessions/:botId/:instanceName → array of IntegrationSession
 * { id, sessionId, remoteJid, pushName, status: opened|closed|paused, awaitUser, context, type,
 * parameters, botId, instanceId, createdAt, updatedAt }, one item each. A bot ID that matches no
 * bot returns the sessions of every bot of this type on the instance.
 * Typebot sessions keep { ...prefilledVariables, remoteJid, pushName, instanceName, serverUrl,
 * apiKey: AUTHENTICATION_API_KEY (the global key), ownerJid } in `parameters`
 * (typebot.service.ts): apiKey is removed unless "Include Secrets" is on.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject[]> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const botType = parseBotType(
    this.getNode(),
    this.getNodeParameter('botType', itemIndex),
    itemIndex,
  );
  const botId = String(
    this.getNodeParameter('botId', itemIndex, '', { extractValue: true }),
  ).trim();
  const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

  const response = await evolutionApiRequest.call(
    this,
    'GET',
    `/${botType.value}/fetchSessions/${encodePathSegment(botId, 'Bot ID')}/${instance}`,
    {},
    {},
    { itemIndex },
  );

  const remoteJid = toJid(filters.remoteJid);
  const status = String(filters.status ?? '').trim();
  const sessions = toArray(response).filter(
    (session) =>
      (!remoteJid || session.remoteJid === remoteJid) && (!status || session.status === status),
  );
  return options.includeSecrets === true ? sessions : redactBotSecrets(sessions);
}
