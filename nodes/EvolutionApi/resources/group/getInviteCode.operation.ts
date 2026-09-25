import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';
import { getGroupJid, groupJidProperty } from './helpers';

const properties: INodeProperties[] = [groupJidProperty()];

export const description = updateDisplayOptions(
  { show: { resource: ['group'], operation: ['getInviteCode'] } },
  properties,
);

/**
 * GET /group/inviteCode/:instanceName?groupJid= (groupJidSchema)
 * → { inviteUrl: 'https://chat.whatsapp.com/<code>', inviteCode }.
 * WhatsApp only gives the code to admins: otherwise 404 "No invite code".
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const groupJid = getGroupJid.call(this, itemIndex);
  return (await evolutionApiRequest.call(
    this,
    'GET',
    `/group/inviteCode/${instance}`,
    {},
    { groupJid },
    { itemIndex },
  )) as IDataObject;
}
