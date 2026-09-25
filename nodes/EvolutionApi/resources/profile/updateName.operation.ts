import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';

const properties: INodeProperties[] = [
  {
    displayName: 'Name',
    name: 'profileName',
    type: 'string',
    required: true,
    default: '',
    description: 'New display name (push name) of the WhatsApp account of the instance',
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['profile'], operation: ['updateName'] } },
  properties,
);

/** POST /chat/updateProfileName/:instanceName { name } (profileNameSchema, 200) → { update: 'success' }. */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const name = String(this.getNodeParameter('profileName', itemIndex, '') ?? '').trim();
  if (!name) {
    throw new NodeOperationError(this.getNode(), 'Name is required', { itemIndex });
  }
  return (await evolutionApiRequest.call(
    this,
    'POST',
    `/chat/updateProfileName/${instance}`,
    { name },
    {},
    { itemIndex },
  )) as IDataObject;
}
