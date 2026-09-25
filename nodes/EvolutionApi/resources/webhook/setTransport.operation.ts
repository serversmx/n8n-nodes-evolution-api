import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';
import { transportProperty } from './getTransport.operation';
import {
  getTransport,
  normalizeEvents,
  redactTransportSecrets,
  TRANSPORT_OPTIONS,
  WEBHOOK_EVENT_OPTIONS,
  withEventsHint,
} from './helpers';

const PUSHER_KEYS = ['appId', 'key', 'secret', 'cluster'] as const;

const properties: INodeProperties[] = [
  transportProperty,
  {
    displayName: 'Enabled',
    name: 'transportEnabled',
    type: 'boolean',
    default: true,
    description:
      'Whether this instance publishes events through the transport. Turning it off also clears the event list.',
  },
  {
    displayName: 'Events',
    name: 'transportEvents',
    type: 'multiOptions',
    options: WEBHOOK_EVENT_OPTIONS,
    default: [],
    displayOptions: { show: { transportEnabled: [true] } },
    description:
      'Events to publish. Leave empty to publish every event. Evolution API 2.3.x rejects "Messaging History Set" with a 400 error.',
  },
  {
    displayName: 'Pusher Settings',
    name: 'pusherConfig',
    type: 'collection',
    placeholder: 'Add Pusher Setting',
    default: {},
    displayOptions: { show: { eventTransport: ['pusher'] } },
    description:
      'Pusher Channels app of this instance. Settings not added here keep their current value; App ID, Key, Secret and Cluster are required to enable it.',
    options: [
      {
        displayName: 'App ID',
        name: 'appId',
        type: 'string',
        default: '',
      },
      {
        displayName: 'Cluster',
        name: 'cluster',
        type: 'string',
        default: '',
        placeholder: 'us2',
      },
      {
        displayName: 'Key',
        name: 'key',
        type: 'string',
        default: '',
        description: 'Public app key',
      },
      {
        displayName: 'Secret',
        name: 'secret',
        type: 'string',
        typeOptions: { password: true },
        default: '',
      },
      {
        displayName: 'Use TLS',
        name: 'useTLS',
        type: 'boolean',
        default: true,
        description: 'Whether to connect to Pusher over TLS',
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
          'Whether to keep the Pusher secret in the output. Off by default so it is not stored in execution logs.',
      },
    ],
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['webhook'], operation: ['setTransport'] } },
  properties,
);

/**
 * POST /{websocket|rabbitmq|sqs|nats|kafka}/set/:instanceName { <transport>: { enabled, events } }
 * (eventSchema) or POST /pusher/set/:instanceName { pusher: { enabled, appId, key, secret,
 * cluster, useTLS, events } } (pusherSchema: all Pusher fields required, so they are merged with
 * GET /pusher/find first). `events` is always sent: with enabled=true and no `events` the server
 * crashes (HTTP 500); `[]` means every event. Answers 201 with the stored row.
 * EventController#set returns nothing when the transport is off on the server (<NAME>_ENABLED,
 * or SQS_GLOBAL_ENABLED for SQS): that empty 201 is turned into an error.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const node = this.getNode();
  const instance = await resolveInstanceName.call(this, itemIndex);
  const transport = getTransport(this.getNodeParameter('eventTransport', itemIndex));
  if (!transport) {
    throw new NodeOperationError(node, 'Unknown transport', {
      itemIndex,
      description: `Use one of: ${TRANSPORT_OPTIONS.map((option) => option.value).join(', ')}.`,
    });
  }
  const enabled = this.getNodeParameter('transportEnabled', itemIndex, true) as boolean;
  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
  const events = enabled
    ? normalizeEvents(this.getNodeParameter('transportEvents', itemIndex, []))
    : [];

  const config: IDataObject = { enabled, events };
  if (transport.name === 'pusher') {
    const changes = this.getNodeParameter('pusherConfig', itemIndex, {}) as IDataObject;
    const current = (await evolutionApiRequest.call(
      this,
      'GET',
      `/pusher/find/${instance}`,
      {},
      {},
      { itemIndex },
    )) as IDataObject;
    for (const key of PUSHER_KEYS) {
      const value = changes[key] !== undefined ? changes[key] : current[key];
      config[key] = typeof value === 'string' ? value.trim() : '';
    }
    const useTls = changes.useTLS !== undefined ? changes.useTLS : current.useTLS;
    config.useTLS = typeof useTls === 'boolean' ? useTls : true;

    const missing = PUSHER_KEYS.filter((key) => !config[key]);
    if (enabled && missing.length > 0) {
      throw new NodeOperationError(node, `Missing Pusher settings: ${missing.join(', ')}`, {
        itemIndex,
        description: 'Add the missing values under "Pusher Settings".',
      });
    }
  }

  let response: IDataObject;
  try {
    response = (await evolutionApiRequest.call(
      this,
      'POST',
      `/${transport.name}/set/${instance}`,
      { [transport.name]: config },
      {},
      { itemIndex },
    )) as IDataObject;
  } catch (error) {
    throw withEventsHint(error, events);
  }

  if (Object.keys(response).length === 0) {
    const sqsNote = transport.name === 'sqs' ? ' (or SQS_GLOBAL_ENABLED is true)' : '';
    throw new NodeOperationError(
      node,
      `Evolution API did not save the ${transport.info.label} configuration`,
      {
        itemIndex,
        description: `The ${transport.info.label} integration is disabled on the server: set ${transport.info.env}=true in the Evolution API environment${sqsNote} and restart it.`,
      },
    );
  }

  return options.includeSecrets === true ? response : redactTransportSecrets(response);
}
