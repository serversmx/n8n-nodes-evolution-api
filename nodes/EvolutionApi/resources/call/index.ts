import type { INodeProperties } from 'n8n-workflow';

import type { OperationHandler } from '../../types';
import * as offer from './offer.operation';

/**
 * Call resource (STUB — owned by the call agent). Routes: src/api/routes/call.router.ts.
 * /call/offer is the only call route in 2.3.7 and 2.4.0-rc2.
 */
export const operations: INodeProperties = {
  displayName: 'Operation',
  name: 'operation',
  type: 'options',
  noDataExpression: true,
  displayOptions: {
    show: {
      resource: ['call'],
    },
  },
  options: [
    {
      name: 'Offer',
      value: 'offer',
      description:
        'Offer a voice or video call. Evolution API 2.3/2.4 answer a placeholder and place no call.',
      action: 'Offer a call',
    },
  ],
  default: 'offer',
};

export const fields: INodeProperties[] = [...offer.description];

export const execute: Record<string, OperationHandler> = {
  offer: offer.execute,
};
