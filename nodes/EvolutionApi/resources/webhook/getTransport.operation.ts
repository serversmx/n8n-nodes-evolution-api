import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';
import { getTransport, redactTransportSecrets, TRANSPORT_OPTIONS } from './helpers';

/** "Transport" selector shared by Get Transport and Set Transport. */
export const transportProperty: INodeProperties = {
  displayName: 'Transport',
  name: 'eventTransport',
  type: 'options',
  options: TRANSPORT_OPTIONS,
  default: 'rabbitmq',
  description:
    'Event transport to configure for this instance. Connection details (URIs, brokers, queues, regions) are server settings; per instance you only choose whether it is enabled and which events it receives.',
};

const properties: INodeProperties[] = [
  transportProperty,
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
  { show: { resource: ['webhook'], operation: ['getTransport'] } },
  properties,
);

/**
 * GET /{websocket|rabbitmq|sqs|nats|kafka|pusher}/find/:instanceName
 * Returns the transport row { id, enabled, events, createdAt, updatedAt, instanceId } (Pusher adds
 * appId, key, secret, cluster, useTLS). The body is empty (→ {}) when nothing is configured or
 * when the transport is disabled on the server (<NAME>_ENABLED is not true).
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const transport = getTransport(this.getNodeParameter('eventTransport', itemIndex));
  if (!transport) {
    throw new NodeOperationError(this.getNode(), 'Unknown transport', {
      itemIndex,
      description: `Use one of: ${TRANSPORT_OPTIONS.map((option) => option.value).join(', ')}.`,
    });
  }
  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
  const response = (await evolutionApiRequest.call(
    this,
    'GET',
    `/${transport.name}/find/${instance}`,
    {},
    {},
    { itemIndex },
  )) as IDataObject;
  return options.includeSecrets === true ? response : redactTransportSecrets(response);
}
