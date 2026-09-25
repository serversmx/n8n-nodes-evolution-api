import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import { REQUIRES_24 } from '../../constants';
import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';
import { getGroupJid, groupJidProperty } from './helpers';

const MEMBER_ADD_MODES = ['admin_add', 'all_member_add'];

const properties: INodeProperties[] = [
  groupJidProperty(),
  {
    displayName: 'Who Can Add Members',
    name: 'groupMemberAddMode',
    type: 'options',
    options: [
      {
        name: 'All Members',
        value: 'all_member_add',
        description: 'Every member can add participants ("all_member_add")',
      },
      {
        name: 'Only Admins',
        value: 'admin_add',
        description: 'Only admins can add participants ("admin_add")',
      },
    ],
    default: 'admin_add',
    description: `Who can add participants to the group. The instance must be a group admin of a WhatsApp Baileys instance (Cloud API instances answer HTTP 500). ${REQUIRES_24}`,
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['group'], operation: ['updateMemberAddMode'] } },
  properties,
);

/**
 * POST /group/updateMemberAddMode/:instanceName { groupJid, mode } (updateMemberAddModeSchema)
 * → { update: 'success', mode } (HTTP 201). New in 2.4: 2.3.x answers 404
 * "Cannot POST /group/updateMemberAddMode/…" (explained by the 404 hint). Only the Baileys
 * service implements it: other channels fail with a TypeError (500), not the usual 400.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const groupJid = getGroupJid.call(this, itemIndex);
  const mode = String(this.getNodeParameter('groupMemberAddMode', itemIndex, 'admin_add'))
    .trim()
    .toLowerCase();
  if (!MEMBER_ADD_MODES.includes(mode)) {
    throw new NodeOperationError(this.getNode(), `Invalid member add mode "${mode}"`, {
      itemIndex,
      description: `Use one of: ${MEMBER_ADD_MODES.join(', ')}.`,
    });
  }
  return (await evolutionApiRequest.call(
    this,
    'POST',
    `/group/updateMemberAddMode/${instance}`,
    { groupJid, mode },
    {},
    { itemIndex },
  )) as IDataObject;
}
