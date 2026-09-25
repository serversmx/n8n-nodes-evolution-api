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
      'Invite link (https://chat.whatsapp.com/…) or only its code (22 letters and digits)',
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['group'], operation: ['getInviteInfo'] } },
  properties,
);

/**
 * GET /group/inviteInfo/:instanceName?inviteCode= (groupInviteSchema: ^[a-zA-Z0-9]{22}$)
 * → Baileys GroupMetadata of the invited group { id, subject, owner, desc, size, participants… }.
 * Read-only: the instance does not join. 404 "No invite info" for an expired or unknown code.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const inviteCode = getInviteCode.call(this, itemIndex);
  return (await evolutionApiRequest.call(
    this,
    'GET',
    `/group/inviteInfo/${instance}`,
    {},
    { inviteCode },
    { itemIndex },
  )) as IDataObject;
}
