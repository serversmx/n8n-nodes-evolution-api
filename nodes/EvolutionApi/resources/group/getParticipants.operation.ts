import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';
import { getGroupJid, groupJidProperty } from './helpers';

const properties: INodeProperties[] = [groupJidProperty()];

export const description = updateDisplayOptions(
  { show: { resource: ['group'], operation: ['getParticipants'] } },
  properties,
);

/**
 * GET /group/participants/:instanceName?groupJid= (groupJidSchema)
 * → { participants: [{ id, admin: null | 'admin' | 'superadmin', name?, imgUrl?, … }] }.
 * `name`/`imgUrl` fall back to the instance's saved contacts; `id` may be an @lid JID, and
 * Baileys 7 participant fields such as `lid`/`phoneNumber` are passed through.
 * Output: one item per participant (the response has no other data).
 */
export async function execute(
  this: IExecuteFunctions,
  itemIndex: number,
): Promise<IDataObject | IDataObject[]> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const groupJid = getGroupJid.call(this, itemIndex);
  const response = (await evolutionApiRequest.call(
    this,
    'GET',
    `/group/participants/${instance}`,
    {},
    { groupJid },
    { itemIndex },
  )) as IDataObject;

  const participants = response.participants;
  if (!Array.isArray(participants)) return response;
  return participants.map((participant) =>
    typeof participant === 'object' && participant !== null
      ? (participant as IDataObject)
      : { id: participant as string },
  );
}
