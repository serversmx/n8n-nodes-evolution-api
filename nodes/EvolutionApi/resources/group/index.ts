import type { INodeProperties } from 'n8n-workflow';

import type { OperationHandler } from '../../types';
import * as getMany from './getMany.operation';

/**
 * Group resource (STUB — owned by the group agent). Routes: src/api/routes/group.router.ts.
 */
export const operations: INodeProperties = {
  displayName: 'Operation',
  name: 'operation',
  type: 'options',
  noDataExpression: true,
  displayOptions: {
    show: {
      resource: ['group'],
    },
  },
  options: [
    {
      name: 'Get Many',
      value: 'getMany',
      description: 'Get the groups the instance belongs to',
      action: 'Get many groups',
    },
  ],
  default: 'getMany',
};

export const fields: INodeProperties[] = [...getMany.description];

export const execute: Record<string, OperationHandler> = {
  getMany: getMany.execute,
};
