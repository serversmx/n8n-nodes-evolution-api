import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import {
  evolutionApiRequest,
  normalizeNumberList,
  resolveInstanceName,
} from '../../GenericFunctions';
import { getGroupJid, groupJidProperty } from './helpers';

const properties: INodeProperties[] = [
  groupJidProperty(),
  {
    displayName: 'Numbers',
    name: 'numbers',
    type: 'string',
    required: true,
    default: '',
    placeholder: '5215512345678, 5511999999999',
    description:
      'Recipients: phone numbers with country code (or JIDs), separated by commas or new lines. Each one receives its own message, in order; a number that is not on WhatsApp stops the remaining sends.',
  },
  {
    displayName: 'Message',
    name: 'text',
    type: 'string',
    typeOptions: { rows: 3 },
    required: true,
    default: '',
    placeholder: 'e.g. Join our group!',
    description:
      'Text sent before the invite link: each recipient gets this text, a blank line and the link',
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['group'], operation: ['sendInvite'] } },
  properties,
);

/**
 * POST /group/sendInvite/:instanceName { groupJid, description, numbers } (groupSendInviteSchema)
 * → { send: true, inviteUrl } (HTTP 200). groupNoValidate: no ?groupJid fallback and no @g.us
 * appended server side, so the JID is always sent complete. Evolution reads the invite code
 * (admins only) and sends "<description>\n\n<inviteUrl>" to the numbers one by one (no typing
 * delay). Any failure (not admin, number not on WhatsApp…) stops the loop and becomes
 * 404 "No send invite"; the numbers before it have already received the message.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const groupJid = getGroupJid.call(this, itemIndex);
  const numbers = normalizeNumberList(this.getNodeParameter('numbers', itemIndex));
  if (numbers.length === 0) {
    throw new NodeOperationError(this.getNode(), 'At least one number is required', { itemIndex });
  }
  const text = String(this.getNodeParameter('text', itemIndex, '') ?? '');
  if (!text.trim()) {
    throw new NodeOperationError(this.getNode(), 'Message is required', {
      itemIndex,
      description: 'Evolution API rejects an invite without a text before the link.',
    });
  }

  return (await evolutionApiRequest.call(
    this,
    'POST',
    `/group/sendInvite/${instance}`,
    { groupJid, description: text, numbers },
    {},
    { itemIndex },
  )) as IDataObject;
}
