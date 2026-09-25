import type { INodeProperties } from 'n8n-workflow';

import type { OperationHandler } from '../../types';
import * as get from './get.operation';
import * as getTransport from './getTransport.operation';
import * as set from './set.operation';
import * as setTransport from './setTransport.operation';

/**
 * Webhook resource: the instance webhook plus the other event transports.
 * Routes: src/api/integrations/event/{webhook,websocket,rabbitmq,sqs,nats,kafka,pusher}/*.router.ts
 * (identical in 2.3.7 and 2.4.0-rc2; 2.4 adds the MESSAGING_HISTORY_SET event).
 */
export const operations: INodeProperties = {
  displayName: 'Operation',
  name: 'operation',
  type: 'options',
  noDataExpression: true,
  displayOptions: {
    show: {
      resource: ['webhook'],
    },
  },
  options: [
    {
      name: 'Get',
      value: 'get',
      description: 'Get the webhook configuration of an instance (URL, events, headers, options)',
      action: 'Get the webhook configuration',
    },
    {
      name: 'Get Transport',
      value: 'getTransport',
      description:
        'Get the WebSocket, RabbitMQ, Amazon SQS, NATS, Kafka or Pusher event configuration of an instance',
      action: 'Get an event transport configuration',
    },
    {
      name: 'Set',
      value: 'set',
      description:
        'Set, change or disable the webhook of an instance (one webhook per instance: this replaces the current one)',
      action: 'Set the webhook configuration',
    },
    {
      name: 'Set Transport',
      value: 'setTransport',
      description:
        'Enable or disable the WebSocket, RabbitMQ, Amazon SQS, NATS, Kafka or Pusher events of an instance',
      action: 'Set an event transport configuration',
    },
  ],
  default: 'get',
};

export const fields: INodeProperties[] = [
  ...get.description,
  ...getTransport.description,
  ...set.description,
  ...setTransport.description,
];

export const execute: Record<string, OperationHandler> = {
  get: get.execute,
  getTransport: getTransport.execute,
  set: set.execute,
  setTransport: setTransport.execute,
};
