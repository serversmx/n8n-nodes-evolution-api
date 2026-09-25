import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { buildMediaRequestBody, normalizeNumberList } from '../../GenericFunctions';
import { evolutionJid } from '../chat/helpers';
import {
  getString,
  mediaSourceProperties,
  operationError,
  postMessage,
  resolveMediaInput,
} from './helpers';

const properties: INodeProperties[] = [
  {
    displayName: 'Status Type',
    name: 'statusType',
    type: 'options',
    options: [
      {
        name: 'Audio',
        value: 'audio',
        description: 'Voice status from a URL, base64 or binary file (converted by Evolution)',
      },
      {
        name: 'Image',
        value: 'image',
        description: 'Image from a URL, base64 or binary file',
      },
      { name: 'Text', value: 'text', description: 'Text on a colored background' },
      {
        name: 'Video',
        value: 'video',
        description: 'Video from a URL, base64 or binary file',
      },
    ],
    default: 'text',
    description: 'Kind of status (story) to post',
  },
  {
    displayName: 'Text',
    name: 'text',
    type: 'string',
    required: true,
    default: '',
    typeOptions: { rows: 3 },
    description: 'Text of the status',
    displayOptions: { show: { statusType: ['text'] } },
  },
  {
    displayName: 'Background Color',
    name: 'statusBackgroundColor',
    type: 'color',
    default: '#008000',
    description: 'Background color of a text status (hex, e.g. #008000)',
    displayOptions: { show: { statusType: ['text'] } },
  },
  {
    displayName: 'Font',
    name: 'statusFont',
    type: 'number',
    default: 1,
    typeOptions: { minValue: 1, maxValue: 5 },
    description: 'Font style of a text status, from 1 to 5',
    displayOptions: { show: { statusType: ['text'] } },
  },
  ...mediaSourceProperties('image, video or audio', { statusType: ['image', 'video', 'audio'] }),
  {
    displayName: 'Caption',
    name: 'caption',
    type: 'string',
    default: '',
    description: 'Text shown with the image or video',
    displayOptions: { show: { statusType: ['image', 'video'] } },
  },
  {
    displayName: 'All Contacts',
    name: 'statusAllContacts',
    type: 'boolean',
    default: false,
    description:
      "Whether to show the status to every contact stored in Evolution's database that has a name",
  },
  {
    displayName: 'Recipients',
    name: 'statusRecipients',
    type: 'string',
    required: true,
    default: '',
    placeholder: '5215512345678, 5511999999999@s.whatsapp.net',
    description:
      'Numbers or JIDs that can see the status, separated by commas. The node converts plain numbers using Evolution’s Mexico, Argentina and Brazil digit rules. Full JIDs, including …@lid, are kept unchanged; prefer the JID from a webhook or from Chat > Check Numbers.',
    displayOptions: { show: { statusAllContacts: [false] } },
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['message'], operation: ['sendStatus'] } },
  properties,
);

const DEFAULT_MIME_TYPE: Record<string, string> = { image: 'image/jpeg', video: 'video/mp4' };

/**
 * POST /message/sendStatus/:instanceName (statusMessageSchema, HTTP 201; WhatsApp Baileys only)
 * { type: text|image|video|audio, content, caption?, backgroundColor?, font?, statusJidList?,
 *   allContacts? } (+ multipart "file" for audio). The response is the sent message
 * (remoteJid "status@broadcast"); delay, quoted and mentions do not apply.
 * - text: backgroundColor and a font 1-5 are required (0 is rejected by the service).
 * - image/video: `content` goes to Baileys as `{ url: content }`. Baileys' getStream() reads a
 *   "data:" URL as inline base64, so base64 and binary files are sent as a data: URI in JSON.
 *   Raw base64 (and therefore a multipart upload, which Evolution turns into raw base64) would
 *   be opened as a local file path on the server.
 * - audio: `content` is a URL or raw base64 (processAudioMp4), so a binary can go as multipart.
 * - statusJidList is used verbatim: convert plain numbers with evolutionJid first. Evolution
 *   sends in batches of 10.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const node = this.getNode();
  const type = getString.call(this, 'statusType', itemIndex) || 'text';
  const fields: IDataObject = { type };

  const allContacts = this.getNodeParameter('statusAllContacts', itemIndex, false) === true;
  if (allContacts) {
    fields.allContacts = true;
  } else {
    const recipients = normalizeNumberList(this.getNodeParameter('statusRecipients', itemIndex, ''))
      .map((recipient) => evolutionJid(recipient))
      .filter((recipient, index, list) => list.indexOf(recipient) === index);
    if (recipients.length === 0) {
      throw operationError(
        node,
        itemIndex,
        'Add at least one recipient or enable All Contacts',
        'WhatsApp only shows a status to the listed contacts.',
      );
    }
    fields.statusJidList = recipients;
  }

  if (type === 'text') {
    const text = String(this.getNodeParameter('text', itemIndex, '') ?? '');
    if (!text.trim()) throw operationError(node, itemIndex, 'Text is required');
    const backgroundColor = getString.call(this, 'statusBackgroundColor', itemIndex);
    if (!backgroundColor) throw operationError(node, itemIndex, 'Background Color is required');
    const font = Math.round(Number(this.getNodeParameter('statusFont', itemIndex, 1)));
    if (!Number.isFinite(font) || font < 1 || font > 5) {
      throw operationError(node, itemIndex, 'Font must be a number from 1 to 5');
    }
    return await postMessage.call(this, itemIndex, 'sendStatus', {
      ...fields,
      content: text,
      backgroundColor,
      font,
    });
  }

  if (type !== 'image' && type !== 'video' && type !== 'audio') {
    throw operationError(node, itemIndex, `Unsupported status type "${type}"`);
  }
  const media = await resolveMediaInput.call(this, itemIndex);

  if (type === 'audio') {
    const body = buildMediaRequestBody(media, fields, {
      mediaField: 'content',
      allowMultipart: true,
    });
    return await postMessage.call(this, itemIndex, 'sendStatus', body);
  }

  fields.content =
    media.type === 'url'
      ? media.value
      : `data:${media.mimeType || DEFAULT_MIME_TYPE[type]};base64,${media.value}`;
  const caption = getString.call(this, 'caption', itemIndex);
  if (caption) fields.caption = caption;
  return await postMessage.call(this, itemIndex, 'sendStatus', fields);
}
