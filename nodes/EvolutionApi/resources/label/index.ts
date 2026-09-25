import type { INodeProperties } from 'n8n-workflow';

import type { OperationHandler, ResourceMethods } from '../../types';
import * as addToChat from './addToChat.operation';
import * as getMany from './getMany.operation';
import { labelSearchLabels } from './helpers';
import * as removeFromChat from './removeFromChat.operation';

/**
 * Label resource (WhatsApp Business labels). Routes: src/api/routes/label.router.ts
 * (findLabels, handleLabel), identical in 2.3.7 and 2.4.0-rc2.
 */
export const operations: INodeProperties = {
  displayName: 'Operation',
  name: 'operation',
  type: 'options',
  noDataExpression: true,
  displayOptions: {
    show: {
      resource: ['label'],
    },
  },
  options: [
    {
      name: 'Add to Chat',
      value: 'addToChat',
      description: 'Add a WhatsApp Business label to a chat',
      action: 'Add a label to a chat',
    },
    {
      name: 'Get Many',
      value: 'getMany',
      description: 'Get the labels of the WhatsApp Business account (ID, name, color)',
      action: 'Get many labels',
    },
    {
      name: 'Remove from Chat',
      value: 'removeFromChat',
      description: 'Remove a WhatsApp Business label from a chat',
      action: 'Remove a label from a chat',
    },
  ],
  default: 'getMany',
};

export const fields: INodeProperties[] = [
  ...addToChat.description,
  ...getMany.description,
  ...removeFromChat.description,
];

export const execute: Record<string, OperationHandler> = {
  addToChat: addToChat.execute,
  getMany: getMany.execute,
  removeFromChat: removeFromChat.execute,
};

export const methods: ResourceMethods = {
  listSearch: {
    labelSearchLabels,
  },
};
