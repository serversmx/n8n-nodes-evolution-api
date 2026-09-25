import type { INodeProperties } from 'n8n-workflow';

import type { OperationHandler } from '../../types';
import * as get from './get.operation';

/**
 * Settings resource (STUB — owned by the settings agent). Routes: src/api/routes/settings.router.ts.
 */
export const operations: INodeProperties = {
  displayName: 'Operation',
  name: 'operation',
  type: 'options',
  noDataExpression: true,
  displayOptions: {
    show: {
      resource: ['settings'],
    },
  },
  options: [
    {
      name: 'Get',
      value: 'get',
      description: 'Get the behavior settings of an instance',
      action: 'Get instance settings',
    },
  ],
  default: 'get',
};

export const fields: INodeProperties[] = [...get.description];

export const execute: Record<string, OperationHandler> = {
  get: get.execute,
};
