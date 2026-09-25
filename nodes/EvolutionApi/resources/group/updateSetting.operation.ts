import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';
import { getGroupJid, groupJidProperty } from './helpers';

const GROUP_SETTINGS = ['announcement', 'locked', 'not_announcement', 'unlocked'];

const properties: INodeProperties[] = [
  groupJidProperty(),
  {
    displayName: 'Setting',
    name: 'groupSetting',
    type: 'options',
    options: [
      {
        name: 'All Members Can Edit Group Info',
        value: 'unlocked',
        description: 'Every member can change the subject, description and picture ("unlocked")',
      },
      {
        name: 'All Members Can Send Messages',
        value: 'not_announcement',
        description: 'Every member can send messages ("not_announcement")',
      },
      {
        name: 'Only Admins Can Edit Group Info',
        value: 'locked',
        description: 'Only admins can change the subject, description and picture ("locked")',
      },
      {
        name: 'Only Admins Can Send Messages',
        value: 'announcement',
        description: 'Announcement group: only admins can send messages ("announcement")',
      },
    ],
    default: 'announcement',
    description: 'Setting to apply. The instance must be a group admin.',
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['group'], operation: ['updateSetting'] } },
  properties,
);

/**
 * POST /group/updateSetting/:instanceName { groupJid, action } (updateSettingsSchema)
 * → { updateSetting: <Baileys result, undefined> }, i.e. `{}` on the wire (HTTP 201).
 * The output adds { update: 'success', groupJid, action } so it is never empty.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const groupJid = getGroupJid.call(this, itemIndex);
  const action = String(this.getNodeParameter('groupSetting', itemIndex, 'announcement'))
    .trim()
    .toLowerCase();
  if (!GROUP_SETTINGS.includes(action)) {
    throw new NodeOperationError(this.getNode(), `Invalid group setting "${action}"`, {
      itemIndex,
      description: `Use one of: ${GROUP_SETTINGS.join(', ')}.`,
    });
  }
  const response = (await evolutionApiRequest.call(
    this,
    'POST',
    `/group/updateSetting/${instance}`,
    { groupJid, action },
    {},
    { itemIndex },
  )) as IDataObject;
  return { update: 'success', groupJid, action, ...response };
}
