import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';

const properties: INodeProperties[] = [
  {
    displayName: 'About Text',
    name: 'profileStatus',
    type: 'string',
    required: true,
    default: '',
    typeOptions: { rows: 2 },
    description: 'New "About" text of the WhatsApp account of the instance',
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['profile'], operation: ['updateStatus'] } },
  properties,
);

/**
 * POST /chat/updateProfileStatus/:instanceName { status } (profileStatusSchema, 200) →
 * { update: 'success' }. "Status" here is the profile's about text, not a Status (story) post.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const status = String(this.getNodeParameter('profileStatus', itemIndex, '') ?? '').trim();
  if (!status) {
    throw new NodeOperationError(this.getNode(), 'About text is required', { itemIndex });
  }
  return (await evolutionApiRequest.call(
    this,
    'POST',
    `/chat/updateProfileStatus/${instance}`,
    { status },
    {},
    { itemIndex },
  )) as IDataObject;
}
