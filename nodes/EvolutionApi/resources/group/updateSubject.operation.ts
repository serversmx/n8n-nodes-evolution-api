import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';
import { getGroupJid, groupJidProperty } from './helpers';

const properties: INodeProperties[] = [
  groupJidProperty(),
  {
    displayName: 'Subject',
    name: 'groupSubject',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'e.g. Sales Team',
    description: 'New name of the group',
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['group'], operation: ['updateSubject'] } },
  properties,
);

/**
 * POST /group/updateGroupSubject/:instanceName { groupJid, subject } (updateGroupSubjectSchema)
 * → { update: 'success' } (HTTP 201). Admins only, unless the group is "unlocked";
 * WhatsApp errors come back as 500 "Error updating group subject".
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const groupJid = getGroupJid.call(this, itemIndex);
  const subject = String(this.getNodeParameter('groupSubject', itemIndex, '') ?? '').trim();
  if (!subject) {
    throw new NodeOperationError(this.getNode(), 'Subject is required', { itemIndex });
  }
  return (await evolutionApiRequest.call(
    this,
    'POST',
    `/group/updateGroupSubject/${instance}`,
    { groupJid, subject },
    {},
    { itemIndex },
  )) as IDataObject;
}
