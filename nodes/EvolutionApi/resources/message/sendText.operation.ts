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
    description:
      'Recipient: phone number with country code, or a JID (…@s.whatsapp.net, …@g.us, …@lid)',
  },
  {
    displayName: 'Text',
    name: 'text',
    type: 'string',
    required: true,
    default: '',
    typeOptions: { rows: 4 },
    description: 'Message text. WhatsApp formatting (*bold*, _italic_, ~strike~) is supported.',
  },
  {
    displayName: 'Options',
    name: 'options',
    type: 'collection',
    placeholder: 'Add Option',
    default: {},
    options: [
      {
        displayName: 'Delay (Ms)',
        name: 'delay',
        type: 'number',
        typeOptions: { minValue: 0 },
        default: 0,
        description: 'Milliseconds to show "typing…" before sending',
      },
      {
        displayName: 'Link Preview',
        name: 'linkPreview',
        type: 'boolean',
        default: true,
        description: 'Whether to show a preview of the first link in the text',
      },
    ],
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['message'], operation: ['sendText'] } },
  properties,
);

/**
 * POST /message/sendText/:instanceName { number, text, delay?, linkPreview? }
 * (textMessageSchema, HTTP 201). Returns the sent message ({ key, message, messageTimestamp, … }).
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const number = normalizeNumber(this.getNodeParameter('number', itemIndex));
  const text = this.getNodeParameter('text', itemIndex, '') as string;
  if (!number) {
    throw new NodeOperationError(this.getNode(), 'Number is required', { itemIndex });
  }
  if (!text.trim()) {
    throw new NodeOperationError(this.getNode(), 'Text is required', { itemIndex });
  }

  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
  const body: IDataObject = { number, text };
  if (options.delay !== undefined) body.delay = Math.round(Number(options.delay));
  if (options.linkPreview !== undefined) body.linkPreview = options.linkPreview === true;

  return (await evolutionApiRequest.call(
    this,
    'POST',
    `/message/sendText/${instance}`,
    body,
    {},
    {
      itemIndex,
    },
  )) as IDataObject;
}
