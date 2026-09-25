import type { INodeProperties } from 'n8n-workflow';

import type { OperationHandler } from '../../types';
import * as getMany from './getMany.operation';

/**
 * Chatbot resource (STUB — owned by the chatbot agent). Routes:
 * src/api/integrations/chatbot/<bot>/routes/<bot>.router.ts for dify, evoai, evolutionBot,
 * flowise, n8n, openai and typebot (Chatwoot has its own resource).
 */
export const operations: INodeProperties = {
  displayName: 'Operation',
  name: 'operation',
  type: 'options',
  noDataExpression: true,
  displayOptions: {
    show: {
      resource: ['chatbot'],
    },
  },
  options: [
    {
      name: 'Get Many',
      value: 'getMany',
      description: 'Get the bots of a chatbot integration',
      action: 'Get many bots',
    },
  ],
  default: 'getMany',
};

export const fields: INodeProperties[] = [...getMany.description];

export const execute: Record<string, OperationHandler> = {
  getMany: getMany.execute,
};
