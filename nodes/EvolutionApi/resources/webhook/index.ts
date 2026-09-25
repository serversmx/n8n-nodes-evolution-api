import type { INodeProperties } from 'n8n-workflow';

import type { OperationHandler } from '../../types';
import * as get from './get.operation';

/**
 * Webhook resource (STUB — owned by the webhook agent). Routes: src/api/integrations/event/webhook/webhook.router.ts.
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
      description: 'Get the webhook configuration of an instance',
      action: 'Get the webhook configuration',
    },
  ],
  default: 'get',
};

export const fields: INodeProperties[] = [...get.description];

export const execute: Record<string, OperationHandler> = {
  get: get.execute,
};
