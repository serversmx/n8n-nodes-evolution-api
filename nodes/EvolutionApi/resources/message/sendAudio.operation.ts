import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { REQUIRES_24 } from '../../constants';
import { buildMediaRequestBody } from '../../GenericFunctions';
import {
  applySendOptions,
  delayOption,
  getRecipient,
  mediaSourceProperties,
  numberProperty,
  postMessage,
  quotedOptions,
  resolveMediaInput,
  sendOptionsProperty,
} from './helpers';

const properties: INodeProperties[] = [
  numberProperty,
  ...mediaSourceProperties('audio'),
  sendOptionsProperty([
    delayOption('recording audio…'),
    {
      displayName: 'Convert to Voice Note',
      name: 'encoding',
      type: 'boolean',
      default: true,
      description:
        'Whether Evolution converts the audio to OGG/Opus with ffmpeg so it plays as a voice note. Turn it off only when the file already is OGG/Opus.',
    },
    ...quotedOptions(`${REQUIRES_24} Older versions send the voice note without the quote.`),
  ]),
];

export const description = updateDisplayOptions(
  { show: { resource: ['message'], operation: ['sendAudio'] } },
  properties,
);

/**
 * POST /message/sendWhatsAppAudio/:instanceName (audioMessageSchema, HTTP 201)
 * { number, audio (URL or raw base64), encoding?, delay?, quoted? (honoured since 2.4) } or
 * multipart "file". Sent as a voice note (PTT) with the "recording" presence; mentions and
 * messageId are not applied to audio.
 * `encoding` defaults to true server side and is only sent when false: in multipart the string
 * "false" is truthy, so a boolean false also forces the JSON body.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const number = getRecipient.call(this, itemIndex);
  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
  const media = await resolveMediaInput.call(this, itemIndex);

  const fields: IDataObject = { number };
  if (options.encoding === false) fields.encoding = false;
  applySendOptions(this.getNode(), itemIndex, options, fields);

  const body = buildMediaRequestBody(media, fields, { mediaField: 'audio', allowMultipart: true });
  return await postMessage.call(this, itemIndex, 'sendWhatsAppAudio', body);
}
