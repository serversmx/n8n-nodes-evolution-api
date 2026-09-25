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
  operationError,
  postMessage,
  quotedOptions,
  resolveMediaInput,
  sendOptionsProperty,
} from './helpers';

const properties: INodeProperties[] = [
  numberProperty,
  ...mediaSourceProperties('image (PNG, JPEG, GIF or WebP)'),
  sendOptionsProperty([
    {
      displayName: 'Already WebP',
      name: 'notConvertSticker',
      type: 'boolean',
      default: false,
      description:
        'Whether the image already is a WebP sticker and must be sent as-is (keeps animated WebP). Only for Base64 or Binary File input. Without it, an animated GIF stays animated only when sent by URL (Evolution detects ".gif" in the URL).',
    },
    delayOption(),
    ...mentionOptions,
    messageIdOption,
    ...quotedOptions(),
  ]),
];

export const description = updateDisplayOptions(
  { show: { resource: ['message'], operation: ['sendSticker'] } },
  properties,
);

/**
 * POST /message/sendSticker/:instanceName (stickerMessageSchema, HTTP 201)
 * { number, sticker (URL or raw base64), notConvertSticker?, delay?, quoted?, mentionsEveryOne?,
 *   mentioned?, messageId? (2.4) }. WhatsApp Baileys only. Evolution converts the image to WebP
 * (animated when the URL contains ".gif").
 * Always JSON: the multipart path of this route is broken in 2.3.7 and 2.4 (mediaSticker reads
 * `data.sticker`, which is empty when a file is uploaded), so binaries are inlined as base64.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const number = getRecipient.call(this, itemIndex);
  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
  const media = await resolveMediaInput.call(this, itemIndex);

  const fields: IDataObject = { number };
  if (options.notConvertSticker === true) {
    if (media.type === 'url') {
      throw operationError(
        this.getNode(),
        itemIndex,
        'Already WebP needs Base64 or Binary File input',
        'Evolution reads the sticker as base64 when conversion is off; a URL is not downloaded.',
      );
    }
    fields.notConvertSticker = true;
  }
  applySendOptions(this.getNode(), itemIndex, options, fields);

  const body = buildMediaRequestBody(media, fields, { mediaField: 'sticker' });
  return await postMessage.call(this, itemIndex, 'sendSticker', body);
}
