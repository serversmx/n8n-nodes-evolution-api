import type { INodeProperties } from 'n8n-workflow';

import type { OperationHandler } from '../../types';
import * as getMany from './getMany.operation';

/**
 * Template resource (STUB — owned by the template agent). Routes: src/api/routes/template.router.ts.
 * WhatsApp Cloud API (WHATSAPP-BUSINESS) instances only.
 */
export const operations: INodeProperties = {
  displayName: 'Operation',
  name: 'operation',
  type: 'options',
  noDataExpression: true,
  displayOptions: {
    show: {
      resource: ['template'],
    },
  },
  options: [
    {
      name: 'Get Many',
      value: 'getMany',
      description: 'Get the message templates of a WhatsApp Cloud API instance',
      action: 'Get many templates',
    },
  ],
  default: 'getMany',
};

export const fields: INodeProperties[] = [...getMany.description];

export const execute: Record<string, OperationHandler> = {
  getMany: getMany.execute,
};
