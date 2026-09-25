import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';
import { getInviteCode } from './helpers';

const properties: INodeProperties[] = [
  {
    displayName: 'Invite Code',
    name: 'inviteCode',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'e.g. https://chat.whatsapp.com/F1EX5QZxO181L3TMVP31gY',
    description:
      'Invite link (https://chat.whatsapp.com/…) or only its code (22 letters and digits) of the group to join',
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['group'], operation: ['acceptInvite'] } },
  properties,
);

/**
 * GET /group/acceptInviteCode/:instanceName?inviteCode= (AcceptGroupInviteSchema)
 * → { accepted: true, groupJid }. 404 "Accept invite error" for an invalid or revoked code.
 * A GET with a side effect (the instance joins the group): never retried on 5xx.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const inviteCode = getInviteCode.call(this, itemIndex);
  return (await evolutionApiRequest.call(
    this,
    'GET',
    `/group/acceptInviteCode/${instance}`,
    {},
    { inviteCode },
    { itemIndex, idempotent: false },
  )) as IDataObject;
}
