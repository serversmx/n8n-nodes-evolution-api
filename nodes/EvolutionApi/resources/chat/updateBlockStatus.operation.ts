import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, normalizeNumber, resolveInstanceName } from '../../GenericFunctions';

const properties: INodeProperties[] = [
  {
    displayName: 'Number',
    name: 'number',
    type: 'string',
    required: true,
    default: '',
    placeholder: '5215512345678',
    description: 'Contact to block or unblock: phone number with country code, or a JID',
  },
  {
    displayName: 'Action',
    name: 'blockAction',
    type: 'options',
    options: [
      { name: 'Block', value: 'block', description: 'Block the contact' },
      { name: 'Unblock', value: 'unblock', description: 'Unblock the contact' },
    ],
    default: 'block',
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['chat'], operation: ['updateBlockStatus'] } },
  properties,
);

/**
 * POST /chat/updateBlockStatus/:instanceName { number, status: 'block' | 'unblock' }
 * (blockUserSchema, 201) → { block: 'success' }. A number that is not on WhatsApp answers
 * 500 "Error blocking user".
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const number = normalizeNumber(this.getNodeParameter('number', itemIndex, ''));
  if (!number) {
    throw new NodeOperationError(this.getNode(), 'Number is required', { itemIndex });
  }
  const status = this.getNodeParameter('blockAction', itemIndex, 'block') as string;
  if (status !== 'block' && status !== 'unblock') {
    throw new NodeOperationError(this.getNode(), `Unknown action "${status}"`, {
      itemIndex,
      description: 'Use "block" or "unblock".',
    });
  }

  return (await evolutionApiRequest.call(
    this,
    'POST',
    `/chat/updateBlockStatus/${instance}`,
    { number, status },
    {},
    { itemIndex },
  )) as IDataObject;
}
