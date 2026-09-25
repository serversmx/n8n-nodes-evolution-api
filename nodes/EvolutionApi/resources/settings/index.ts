import type { INodeProperties } from 'n8n-workflow';

import type { OperationHandler } from '../../types';
import * as get from './get.operation';
import * as set from './set.operation';

/**
 * Settings resource. Routes: src/api/routes/settings.router.ts (identical in 2.3.7 and 2.4.0-rc2).
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
      description:
        'Get the behavior settings of an instance (reject calls, ignore groups, always online, auto read…)',
      action: 'Get instance settings',
    },
    {
      name: 'Set',
      value: 'set',
      description:
        'Change some behavior settings of an instance; the settings you do not add keep their current value',
      action: 'Set instance settings',
    },
  ],
  default: 'get',
};

export const fields: INodeProperties[] = [...get.description, ...set.description];

export const execute: Record<string, OperationHandler> = {
  get: get.execute,
  set: set.execute,
};
