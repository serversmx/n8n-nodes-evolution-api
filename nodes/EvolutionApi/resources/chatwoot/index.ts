import type { INodeProperties } from 'n8n-workflow';

import type { OperationHandler } from '../../types';
import * as get from './get.operation';
import * as set from './set.operation';

/**
 * Chatwoot resource. Routes: src/api/integrations/chatbot/chatwoot/routes/chatwoot.router.ts
 * (identical in 2.3.7 and 2.4.0-rc2). The inbound POST /chatwoot/webhook/:instanceName is called
 * by Chatwoot itself and is not an operation.
 */
export const operations: INodeProperties = {
  displayName: 'Operation',
  name: 'operation',
  type: 'options',
  noDataExpression: true,
  displayOptions: {
    show: {
      resource: ['chatwoot'],
    },
  },
  options: [
    {
      name: 'Get',
      value: 'get',
      description: 'Get the Chatwoot integration settings of an instance',
      action: 'Get the Chatwoot integration',
    },
    {
      name: 'Set',
      value: 'set',
      description:
        'Configure, enable or disable the Chatwoot integration of an instance; fields you do not add keep their current value',
      action: 'Set the Chatwoot integration',
    },
  ],
  default: 'get',
};

export const fields: INodeProperties[] = [...get.description, ...set.description];

export const execute: Record<string, OperationHandler> = {
  get: get.execute,
  set: set.execute,
};
