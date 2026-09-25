import type { INodeProperties } from 'n8n-workflow';

import type { OperationHandler } from '../../types';
import * as sendText from './sendText.operation';

/**
 * Message resource (STUB — owned by the message agent). Routes: src/api/routes/sendMessage.router.ts.
 * Keep 'sendText' as the default operation: 'message' is the node's default resource.
 */
export const operations: INodeProperties = {
  displayName: 'Operation',
  name: 'operation',
  type: 'options',
  noDataExpression: true,
  displayOptions: {
    show: {
      resource: ['message'],
    },
  },
  options: [
    {
      name: 'Send Text',
      value: 'sendText',
      description: 'Send a text message',
      action: 'Send a text message',
    },
  ],
  default: 'sendText',
};

export const fields: INodeProperties[] = [...sendText.description];

export const execute: Record<string, OperationHandler> = {
  sendText: sendText.execute,
};
