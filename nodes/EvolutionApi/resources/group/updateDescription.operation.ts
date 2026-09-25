import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';
import { getGroupJid, groupJidProperty } from './helpers';

const properties: INodeProperties[] = [
  groupJidProperty(),
  {
    displayName: 'Description',
    name: 'groupDescription',
    type: 'string',
    typeOptions: { rows: 4 },
    required: true,
    default: '',
    description:
      'New description of the group. It cannot be empty: Evolution API has no way to clear it.',
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['group'], operation: ['updateDescription'] } },
  properties,
);

/**
 * POST /group/updateGroupDescription/:instanceName { groupJid, description }
 * (updateGroupDescriptionSchema: non-empty) → { update: 'success' } (HTTP 201).
 * Admins only, unless the group is "unlocked"; WhatsApp errors come back as 500.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const groupJid = getGroupJid.call(this, itemIndex);
  const groupDescription = String(this.getNodeParameter('groupDescription', itemIndex, '') ?? '');
  if (!groupDescription.trim()) {
    throw new NodeOperationError(this.getNode(), 'Description is required', {
      itemIndex,
      description: 'Evolution API rejects an empty group description.',
    });
  }
  return (await evolutionApiRequest.call(
    this,
    'POST',
    `/group/updateGroupDescription/${instance}`,
    { groupJid, description: groupDescription },
    {},
    { itemIndex },
  )) as IDataObject;
}
