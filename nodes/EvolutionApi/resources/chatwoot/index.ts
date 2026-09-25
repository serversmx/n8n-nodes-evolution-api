import type { INodeProperties } from 'n8n-workflow';

import type { OperationHandler } from '../../types';
import * as get from './get.operation';

/**
 * Chatwoot resource (STUB — owned by the chatwoot agent). Routes: src/api/integrations/chatbot/chatwoot/routes/chatwoot.router.ts.
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
  ],
  default: 'get',
};

export const fields: INodeProperties[] = [...get.description];

export const execute: Record<string, OperationHandler> = {
  get: get.execute,
};
