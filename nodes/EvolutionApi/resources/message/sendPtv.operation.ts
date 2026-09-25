import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { buildMediaRequestBody } from '../../GenericFunctions';
import {
  applySendOptions,
  delayOption,
  getRecipient,
  mediaSourceProperties,
  mentionOptions,
  messageIdOption,
  numberProperty,
  postMessage,
  quotedOptions,
  resolveMediaInput,
  sendOptionsProperty,
} from './helpers';

const properties: INodeProperties[] = [
  numberProperty,
  ...mediaSourceProperties('MP4 video'),
  sendOptionsProperty([delayOption(), ...mentionOptions, messageIdOption, ...quotedOptions()]),
];

export const description = updateDisplayOptions(
  { show: { resource: ['message'], operation: ['sendPtv'] } },
  properties,
);

/**
 * POST /message/sendPtv/:instanceName (ptvMessageSchema, HTTP 201)
 * { number, video (URL or raw base64), delay?, quoted?, mentionsEveryOne?, mentioned?,
 *   messageId? (2.4) } or multipart "file". WhatsApp Baileys only; Evolution probes the video
 * duration with ffprobe and answers 500 "Failed to get video duration" for invalid media.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const number = getRecipient.call(this, itemIndex);
  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
  const media = await resolveMediaInput.call(this, itemIndex);

  const fields = applySendOptions(this.getNode(), itemIndex, options, { number });
  const body = buildMediaRequestBody(media, fields, { mediaField: 'video', allowMultipart: true });
  return await postMessage.call(this, itemIndex, 'sendPtv', body);
}
