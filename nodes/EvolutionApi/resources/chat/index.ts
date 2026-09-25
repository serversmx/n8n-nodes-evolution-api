import type { INodeProperties } from 'n8n-workflow';

import type { OperationHandler } from '../../types';
import * as checkNumbers from './checkNumbers.operation';

/**
 * Chat resource (STUB — owned by the chat agent). Routes: src/api/routes/chat.router.ts
 * (profile routes of the same router belong to the "profile" resource).
 */
export const operations: INodeProperties = {
  displayName: 'Operation',
  name: 'operation',
  type: 'options',
  noDataExpression: true,
  displayOptions: {
    show: {
      resource: ['chat'],
    },
  },
  options: [
    {
      name: 'Check Numbers',
      value: 'checkNumbers',
      description: 'Check whether phone numbers have WhatsApp',
      action: 'Check whether numbers are on WhatsApp',
    },
  ],
  default: 'checkNumbers',
};

export const fields: INodeProperties[] = [...checkNumbers.description];

export const execute: Record<string, OperationHandler> = {
  checkNumbers: checkNumbers.execute,
};
