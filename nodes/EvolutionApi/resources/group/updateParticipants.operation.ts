import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import {
  evolutionApiRequest,
  isPlainObject,
  normalizeNumberList,
  resolveInstanceName,
} from '../../GenericFunctions';
import { getGroupJid, groupJidProperty, participantsProperty } from './helpers';

const PARTICIPANT_ACTIONS = ['add', 'demote', 'promote', 'remove'];

const properties: INodeProperties[] = [
  groupJidProperty(),
  {
    displayName: 'Action',
    name: 'groupParticipantAction',
    type: 'options',
    options: [
      {
        name: 'Add',
        value: 'add',
        description:
          'Add the participants to the group (WhatsApp may refuse people whose privacy settings require an invite)',
      },
      {
        name: 'Demote',
        value: 'demote',
        description: 'Remove admin rights from the participants',
      },
      {
        name: 'Promote',
        value: 'promote',
        description: 'Make the participants group admins',
      },
      {
        name: 'Remove',
        value: 'remove',
        description: 'Remove the participants from the group',
      },
    ],
    default: 'add',
    description: 'What to do with the participants. The instance must be a group admin.',
  },
  participantsProperty(
    'Phone numbers with country code or JIDs (…@s.whatsapp.net, …@lid), separated by commas or new lines',
  ),
];

export const description = updateDisplayOptions(
  { show: { resource: ['group'], operation: ['updateParticipants'] } },
  properties,
);

/**
 * POST /group/updateParticipant/:instanceName { groupJid, action, participants }
 * (updateParticipantsSchema) → { updateParticipants: [{ status, jid, content }] } (HTTP 201).
 * The request succeeds even when WhatsApp refuses some participants: every entry has its own
 * status ("200" done; e.g. "403" privacy settings require an invite, "409" already a member).
 * Output: one item per participant result, so failures can be routed with an IF node.
 */
export async function execute(
  this: IExecuteFunctions,
  itemIndex: number,
): Promise<IDataObject | IDataObject[]> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const groupJid = getGroupJid.call(this, itemIndex);
  const action = String(this.getNodeParameter('groupParticipantAction', itemIndex, 'add'))
    .trim()
    .toLowerCase();
  if (!PARTICIPANT_ACTIONS.includes(action)) {
    throw new NodeOperationError(this.getNode(), `Invalid participant action "${action}"`, {
      itemIndex,
      description: `Use one of: ${PARTICIPANT_ACTIONS.join(', ')}.`,
    });
  }
  const participants = normalizeNumberList(this.getNodeParameter('groupParticipants', itemIndex));
  if (participants.length === 0) {
    throw new NodeOperationError(this.getNode(), 'At least one participant is required', {
      itemIndex,
    });
  }

  const response = (await evolutionApiRequest.call(
    this,
    'POST',
    `/group/updateParticipant/${instance}`,
    { groupJid, action, participants },
    {},
    { itemIndex },
  )) as IDataObject;

  const results = response.updateParticipants;
  if (!Array.isArray(results) || results.length === 0) return response;
  return results.map((result) => (isPlainObject(result) ? result : { value: result as string }));
}
