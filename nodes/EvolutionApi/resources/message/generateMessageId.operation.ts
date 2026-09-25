import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { REQUIRES_24 } from '../../constants';
import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';

const properties: INodeProperties[] = [
  {
    displayName: `Returns { "id" }: pass it as Options > Custom Message ID of a send operation to retry without duplicates or to know the message ID in advance. ${REQUIRES_24} Older servers answer 404 "Cannot GET /baileys/generateMessageID".`,
    name: 'generateMessageIdNotice',
    type: 'notice',
    default: '',
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['message'], operation: ['generateMessageId'] } },
  properties,
);

/**
 * GET /baileys/generateMessageID/:instanceName → 200 { id } (Evolution API 2.4+, WhatsApp
 * Baileys only: generateMessageIDV2 bound to the connected account). Nothing is sent to
 * WhatsApp. The ID is what the `messageId` send option of sendText, sendMedia, sendPtv,
 * sendSticker and sendPoll expects.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  return (await evolutionApiRequest.call(
    this,
    'GET',
    `/baileys/generateMessageID/${instance}`,
    {},
    {},
    { itemIndex },
  )) as IDataObject;
}
