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
      'Phone number with country code (or JID) of the profile to fetch. Leave empty for the profile of the instance itself.',
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['profile'], operation: ['get'] } },
  properties,
);

/**
 * POST /chat/fetchProfile/:instanceName { number? } →
 * { wuid, name, numberExists, picture, status, isBusiness, email, description, website }.
 * A number that is not on WhatsApp is answered 400 with the whatsappNumbers entry.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const number = normalizeNumber(this.getNodeParameter('number', itemIndex, ''));
  const body: IDataObject = number ? { number } : {};
  return (await evolutionApiRequest.call(
    this,
    'POST',
    `/chat/fetchProfile/${instance}`,
    body,
    {},
    {
      itemIndex,
      idempotent: true,
    },
  )) as IDataObject;
}
