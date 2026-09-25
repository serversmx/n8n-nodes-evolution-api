import type { INodeProperties } from 'n8n-workflow';

import type { OperationHandler } from '../../types';
import * as getMany from './getMany.operation';

/**
 * Label resource (STUB — owned by the label agent). Routes: src/api/routes/label.router.ts.
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
      name: 'Get Many',
      value: 'getMany',
      description: 'Get the labels of the account',
      action: 'Get many labels',
    },
  ],
  default: 'getMany',
};

export const fields: INodeProperties[] = [...getMany.description];

export const execute: Record<string, OperationHandler> = {
  getMany: getMany.execute,
};
