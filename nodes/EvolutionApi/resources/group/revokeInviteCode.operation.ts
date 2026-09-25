import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';
import { getGroupJid, groupJidProperty } from './helpers';

const properties: INodeProperties[] = [groupJidProperty()];

export const description = updateDisplayOptions(
  { show: { resource: ['group'], operation: ['revokeInviteCode'] } },
  properties,
);

/**
 * POST /group/revokeInviteCode/:instanceName { groupJid } (groupJidSchema)
 * → { revoked: true, inviteCode: <new code> } (HTTP 201). Admins only: 404 "Revoke error".
 * `inviteUrl` is added to the output, built like Get Invite Code does
 * (https://chat.whatsapp.com/<code>), so the new link can be shared directly.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const groupJid = getGroupJid.call(this, itemIndex);
  const response = (await evolutionApiRequest.call(
    this,
    'POST',
    `/group/revokeInviteCode/${instance}`,
    { groupJid },
    {},
    { itemIndex },
  )) as IDataObject;

  const { inviteCode } = response;
  if (typeof inviteCode === 'string' && inviteCode && response.inviteUrl === undefined) {
    return { ...response, inviteUrl: `https://chat.whatsapp.com/${inviteCode}` };
  }
  return response;
}
