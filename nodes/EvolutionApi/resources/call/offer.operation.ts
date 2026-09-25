import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, normalizeNumber, resolveInstanceName } from '../../GenericFunctions';

const properties: INodeProperties[] = [
  {
    displayName: 'Number',
    name: 'number',
    type: 'string',
    required: true,
    default: '',
    placeholder: '5215512345678',
    description: 'Phone number with country code, or a JID',
  },
  {
    displayName: 'Video Call',
    name: 'isVideo',
    type: 'boolean',
    default: false,
    description: 'Whether to offer a video call instead of a voice call',
  },
  {
    displayName: 'Call Duration (Seconds)',
    name: 'callDuration',
    type: 'number',
    typeOptions: { minValue: 1, maxValue: 15 },
    default: 5,
    description: 'How long the call rings, between 1 and 15 seconds',
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['call'], operation: ['offer'] } },
  properties,
);

/**
 * POST /call/offer/:instanceName { number, isVideo, callDuration } (offerCallSchema, HTTP 201).
 * Note: in 2.3.7 and 2.4.0-rc2 the Baileys implementation is commented out upstream and answers
 * a placeholder { id: '123', jid, isVideo, callDuration } without placing a call; Cloud API and
 * Evolution channel instances answer 400.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const number = normalizeNumber(this.getNodeParameter('number', itemIndex));
  if (!number) {
    throw new NodeOperationError(this.getNode(), 'Number is required', { itemIndex });
  }
  const body: IDataObject = {
    number,
    isVideo: this.getNodeParameter('isVideo', itemIndex, false) as boolean,
    callDuration: Math.round(this.getNodeParameter('callDuration', itemIndex, 5) as number),
  };
  return (await evolutionApiRequest.call(
    this,
    'POST',
    `/call/offer/${instance}`,
    body,
    {},
    {
      itemIndex,
    },
  )) as IDataObject;
}
