import type { INodeProperties } from 'n8n-workflow';

import type { OperationHandler } from '../../types';
import * as get from './get.operation';

/**
 * Proxy resource (STUB — owned by the proxy agent). Routes: src/api/routes/proxy.router.ts.
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
  ],
  default: 'get',
};

export const fields: INodeProperties[] = [...get.description];

export const execute: Record<string, OperationHandler> = {
  get: get.execute,
};
