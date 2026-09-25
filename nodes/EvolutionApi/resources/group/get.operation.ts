import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';
import { getGroupJid, groupJidProperty } from './helpers';

const properties: INodeProperties[] = [groupJidProperty()];

export const description = updateDisplayOptions(
  { show: { resource: ['group'], operation: ['get'] } },
  properties,
);

/**
 * GET /group/findGroupInfos/:instanceName?groupJid= (groupJidSchema)
 * → { id, subject, subjectOwner, subjectTime, pictureUrl, size, creation, owner, desc, descId,
 * restrict, announce, participants, isCommunity, isCommunityAnnounce, linkedParent }.
 * 404 "Error fetching group" when the instance is not a member or the JID does not exist.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const groupJid = getGroupJid.call(this, itemIndex);
  return (await evolutionApiRequest.call(
    this,
    'GET',
    `/group/findGroupInfos/${instance}`,
    {},
    { groupJid },
    { itemIndex },
  )) as IDataObject;
}
