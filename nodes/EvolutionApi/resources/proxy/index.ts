import type { INodeProperties } from 'n8n-workflow';

import type { OperationHandler } from '../../types';
import * as get from './get.operation';
import * as set from './set.operation';

/**
 * Proxy resource. Routes: src/api/routes/proxy.router.ts (identical in 2.3.7 and 2.4.0-rc2).
 */
export const operations: INodeProperties = {
  displayName: 'Operation',
  name: 'operation',
  type: 'options',
  noDataExpression: true,
  displayOptions: {
    show: {
      resource: ['proxy'],
    },
  },
  options: [
    {
      name: 'Get',
      value: 'get',
      description: 'Get the proxy configuration of an instance',
      action: 'Get the proxy configuration',
    },
    {
      name: 'Set',
      value: 'set',
      description:
        'Set or disable the proxy of an instance; Evolution tests an enabled proxy before saving it',
      action: 'Set the proxy configuration',
    },
  ],
  default: 'get',
};

export const fields: INodeProperties[] = [...get.description, ...set.description];

export const execute: Record<string, OperationHandler> = {
  get: get.execute,
  set: set.execute,
};
