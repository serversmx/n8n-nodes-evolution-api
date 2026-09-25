import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, normalizeNumber, resolveInstanceName } from '../../GenericFunctions';

const properties: INodeProperties[] = [
  {
    displayName: 'Number',
    name: 'number',
    type: 'string',
    default: '',
    placeholder: '5215512345678',
    description:
      'Phone number with country code (or JID) of the business. Leave empty for the business profile of the instance itself.',
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['profile'], operation: ['getBusinessProfile'] } },
  properties,
);

/**
 * POST /chat/fetchBusinessProfile/:instanceName { number? } (profilePictureSchema, 200) →
 * { isBusiness: true, wid, description, email, website[], category, address, business_hours… }
 * or { isBusiness: false, message: 'Not is business profile', jid, exists, number, name }.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const number = normalizeNumber(this.getNodeParameter('number', itemIndex, ''));
  const body: IDataObject = number ? { number } : {};
  return (await evolutionApiRequest.call(
    this,
    'POST',
    `/chat/fetchBusinessProfile/${instance}`,
    body,
    {},
    { itemIndex, idempotent: true },
  )) as IDataObject;
}
