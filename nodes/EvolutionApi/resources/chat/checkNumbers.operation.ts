import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import {
  evolutionApiRequest,
  normalizeNumberList,
  resolveInstanceName,
  toArray,
} from '../../GenericFunctions';

const properties: INodeProperties[] = [
  {
    displayName: 'Numbers',
    name: 'numbers',
    type: 'string',
    required: true,
    default: '',
    placeholder: '5215512345678, 5511999999999',
    description:
      'Phone numbers with country code (or JIDs), separated by commas or new lines. Outputs one item per number with "exists" and "jid" (the WhatsApp ID to use in other operations).',
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['chat'], operation: ['checkNumbers'] } },
  properties,
);

/**
 * POST /chat/whatsappNumbers/:instanceName { numbers: string[] } (whatsappNumberSchema).
 * Returns one entry per number: { exists, jid, number, name?, lid? }.
 * Errors are answered as HTTP 400 with the raw exception body (no `response` wrapper).
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject[]> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const numbers = normalizeNumberList(this.getNodeParameter('numbers', itemIndex));
  if (numbers.length === 0) {
    throw new NodeOperationError(this.getNode(), 'At least one number is required', { itemIndex });
  }
  const response = await evolutionApiRequest.call(
    this,
    'POST',
    `/chat/whatsappNumbers/${instance}`,
    { numbers },
    {},
    { itemIndex, idempotent: true },
  );
  return toArray(response);
}
