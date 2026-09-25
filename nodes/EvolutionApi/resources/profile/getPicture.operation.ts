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
    description: 'Phone number with country code, or a JID (…@s.whatsapp.net, group …@g.us)',
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['profile'], operation: ['getPicture'] } },
  properties,
);

/**
 * POST /chat/fetchProfilePictureUrl/:instanceName { number } (profilePictureSchema, 200) →
 * { wuid, profilePictureUrl: string | null }. The URL is a temporary WhatsApp CDN link; it is
 * null when the contact hides its picture, has none, or on Cloud API / Evolution channel instances.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const number = normalizeNumber(this.getNodeParameter('number', itemIndex, ''));
  if (!number) {
    throw new NodeOperationError(this.getNode(), 'Number is required', { itemIndex });
  }
  return (await evolutionApiRequest.call(
    this,
    'POST',
    `/chat/fetchProfilePictureUrl/${instance}`,
    { number },
    {},
    { itemIndex, idempotent: true },
  )) as IDataObject;
}
