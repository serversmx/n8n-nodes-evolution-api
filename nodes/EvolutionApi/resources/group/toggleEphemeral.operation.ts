import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';
import { getGroupJid, groupJidProperty } from './helpers';

/** Expirations accepted by toggleEphemeralSchema, in seconds. */
const EXPIRATIONS = [0, 86400, 604800, 7776000];

const properties: INodeProperties[] = [
  groupJidProperty(),
  {
    displayName: 'Disappearing Messages',
    name: 'groupEphemeralExpiration',
    type: 'options',
    options: [
      { name: '24 Hours', value: 86400, description: 'New messages disappear after 24 hours' },
      { name: '7 Days', value: 604800, description: 'New messages disappear after 7 days' },
      { name: '90 Days', value: 7776000, description: 'New messages disappear after 90 days' },
      { name: 'Off', value: 0, description: 'Turn disappearing messages off' },
    ],
    default: 604800,
    description:
      'How long new messages stay in the group (expiration in seconds: 0, 86400, 604800 or 7776000)',
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['group'], operation: ['toggleEphemeral'] } },
  properties,
);

/**
 * POST /group/toggleEphemeral/:instanceName { groupJid, expiration } (toggleEphemeralSchema:
 * a number in [0, 86400, 604800, 7776000]) → { success: true } (HTTP 201).
 * Expression values such as "86400" are converted to numbers (a string fails the schema).
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const groupJid = getGroupJid.call(this, itemIndex);
  const raw = this.getNodeParameter('groupEphemeralExpiration', itemIndex, 604800);
  const expiration =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && /^\d+$/.test(raw.trim())
        ? Number(raw.trim())
        : NaN;
  if (!EXPIRATIONS.includes(expiration)) {
    throw new NodeOperationError(
      this.getNode(),
      `Invalid disappearing messages duration "${String(raw)}"`,
      {
        itemIndex,
        description: `Use one of these values in seconds: ${EXPIRATIONS.join(', ')} (0 turns disappearing messages off).`,
      },
    );
  }
  return (await evolutionApiRequest.call(
    this,
    'POST',
    `/group/toggleEphemeral/${instance}`,
    { groupJid, expiration },
    {},
    { itemIndex },
  )) as IDataObject;
}
