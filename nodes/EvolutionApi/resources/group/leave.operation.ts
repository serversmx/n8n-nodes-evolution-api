import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';
import { getGroupJid, groupJidProperty } from './helpers';

const properties: INodeProperties[] = [groupJidProperty()];

export const description = updateDisplayOptions(
  { show: { resource: ['group'], operation: ['leave'] } },
  properties,
);

/**
 * DELETE /group/leaveGroup/:instanceName?groupJid= → { groupJid, leave: true }.
 * 400 "Unable to leave the group" when the instance is no longer a member (so a 504 is not
 * retried: the first request may already have left the group).
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const groupJid = getGroupJid.call(this, itemIndex);
  return (await evolutionApiRequest.call(
    this,
    'DELETE',
    `/group/leaveGroup/${instance}`,
    {},
    { groupJid },
    { itemIndex },
  )) as IDataObject;
}
