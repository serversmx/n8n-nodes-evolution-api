import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import {
  applySendOptions,
  delayOption,
  getRecipient,
  linkPreviewOption,
  mentionOptions,
  messageIdOption,
  numberProperty,
  operationError,
  postMessage,
  quotedOptions,
  sendOptionsProperty,
} from './helpers';

const properties: INodeProperties[] = [
  numberProperty,
  {
    displayName: 'Text',
    name: 'text',
    type: 'string',
    required: true,
    default: '',
    typeOptions: { rows: 4 },
    description: 'Message text. WhatsApp formatting (*bold*, _italic_, ~strike~) is supported.',
  },
  sendOptionsProperty([
    delayOption(),
    linkPreviewOption,
    ...mentionOptions,
    messageIdOption,
    ...quotedOptions(),
  ]),
];

export const description = updateDisplayOptions(
  { show: { resource: ['message'], operation: ['sendText'] } },
  properties,
);

/**
 * POST /message/sendText/:instanceName
 * { number, text, delay?, linkPreview?, quoted?, mentionsEveryOne?, mentioned?, messageId? (2.4) }
 * (textMessageSchema, HTTP 201). Returns the sent message ({ key, message, messageTimestamp, … }).
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const number = getRecipient.call(this, itemIndex);
  const text = String(this.getNodeParameter('text', itemIndex, '') ?? '');
  if (!text.trim()) {
    throw operationError(this.getNode(), itemIndex, 'Text is required');
  }

  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
  const body = applySendOptions(this.getNode(), itemIndex, options, { number, text });
  return await postMessage.call(this, itemIndex, 'sendText', body);
}
