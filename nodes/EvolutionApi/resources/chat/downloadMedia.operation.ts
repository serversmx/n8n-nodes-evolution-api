import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import {
  base64ToBinary,
  evolutionApiRequest,
  isPlainObject,
  parseJsonParameter,
  resolveInstanceName,
} from '../../GenericFunctions';

const properties: INodeProperties[] = [
  {
    displayName: 'Message ID',
    name: 'messageId',
    type: 'string',
    default: '',
    placeholder: '3EB0C767D26A1D7B5C2A',
    description:
      'ID (key.id) of the image, video, audio, document or sticker message. Optional when Options > Full Message includes key.id. Otherwise Evolution loads it from its stored messages (DATABASE_SAVE_DATA_NEW_MESSAGE).',
  },
  {
    displayName: 'Put Output File in Field',
    name: 'binaryPropertyName',
    type: 'string',
    required: true,
    default: 'data',
    description: 'Name of the output binary field to put the downloaded file in',
  },
  {
    displayName: 'Options',
    name: 'options',
    type: 'collection',
    placeholder: 'Add Option',
    default: {},
    options: [
      {
        displayName: 'Convert Audio to MP4',
        name: 'convertToMp4',
        type: 'boolean',
        default: false,
        description:
          'Whether to convert voice messages (OGG/Opus) to audio/mp4 on the server, e.g. for transcription services that reject OGG',
      },
      {
        displayName: 'File Name',
        name: 'fileName',
        type: 'string',
        default: '',
        description:
          'File name of the output file. Default: the name sent by WhatsApp, or "<message ID>.<extension>" (".m4a" for audio converted to MP4).',
      },
      {
        displayName: 'Full Message',
        name: 'message',
        type: 'json',
        default: '',
        description:
          'The whole message object (with "key", "message" and "messageType"), e.g. the "data" of a MESSAGES_UPSERT webhook: {{ $json.data }}. Lets Evolution download the media without looking the message up in its database. Required for Cloud API (WhatsApp Business) instances, which cannot look messages up by ID.',
      },
      {
        displayName: 'Include Base64 in JSON',
        name: 'includeBase64',
        type: 'boolean',
        default: false,
        description:
          'Whether to also keep the file as a base64 string in the JSON output (can be large)',
      },
    ],
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['chat'], operation: ['downloadMedia'] } },
  properties,
);

/** File extensions of the media types WhatsApp sends (no mime-types dependency). */
const MEDIA_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/3gpp': '3gp',
  'video/mp4': 'mp4',
};

/**
 * Output file name. Evolution names the file after WhatsApp's `fileName` or "<id>.<ext>", with
 * three flaws fixed here: audio converted to MP4 keeps its ".oga" name, an unknown type gives
 * "<id>.false" (Baileys), and Cloud API answers no name at all (its IDs, "wamid.…", contain dots).
 */
export function mediaFileName(
  response: IDataObject,
  messageId: string,
  converted: boolean,
): string {
  const mimeType = typeof response.mimetype === 'string' ? response.mimetype : '';
  const extension = MEDIA_EXTENSIONS[mimeType.split(';')[0].trim().toLowerCase()];
  const name = typeof response.fileName === 'string' ? response.fileName.trim() : '';
  if (!name) return extension ? `${messageId}.${extension}` : messageId;
  if (/\.false$/.test(name)) {
    const base = name.slice(0, -'.false'.length);
    return extension ? `${base}.${extension}` : base;
  }
  if (extension && converted) return `${name.replace(/\.[^./\\]*$/, '')}.${extension}`;
  return name;
}

/**
 * POST /chat/getBase64FromMediaMessage/:instanceName { message: { key: { id } } | <full message>,
 * convertToMp4? } (no schema, 201) → { mediaType, fileName, caption, size, mimetype, base64,
 * buffer: null }. Baileys looks a bare key.id up in its database; Cloud API instances need the
 * full message (messageType + message). 400 "The message is not of the media type" for non-media
 * messages. The file becomes n8n binary data; the JSON keeps the metadata.
 */
export async function execute(
  this: IExecuteFunctions,
  itemIndex: number,
): Promise<INodeExecutionData[]> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
  const messageId = String(this.getNodeParameter('messageId', itemIndex, '') ?? '').trim();

  const fullMessage = parseJsonParameter(options.message, 'Full Message');
  if (fullMessage !== undefined && fullMessage !== null && !isPlainObject(fullMessage)) {
    throw new NodeOperationError(this.getNode(), 'Full Message must be a JSON object', {
      itemIndex,
      description: 'Pass the message object with "key" and "message", e.g. {{ $json.data }}.',
    });
  }

  let message: IDataObject;
  if (isPlainObject(fullMessage)) {
    const key = isPlainObject(fullMessage.key) ? fullMessage.key : {};
    const id = String(key.id ?? '').trim() || messageId;
    if (!id) {
      throw new NodeOperationError(this.getNode(), 'Message ID is required', { itemIndex });
    }
    message = { ...fullMessage, key: { ...key, id } };
  } else {
    if (!messageId) {
      throw new NodeOperationError(this.getNode(), 'Message ID is required', { itemIndex });
    }
    message = { key: { id: messageId } };
  }

  const body: IDataObject = { message };
  if (options.convertToMp4 === true) body.convertToMp4 = true;

  const response = (await evolutionApiRequest.call(
    this,
    'POST',
    `/chat/getBase64FromMediaMessage/${instance}`,
    body,
    {},
    { itemIndex, idempotent: true },
  )) as IDataObject;

  const base64 = typeof response.base64 === 'string' ? response.base64 : '';
  if (!base64) {
    throw new NodeOperationError(this.getNode(), 'The message has no downloadable media', {
      itemIndex,
      description:
        'Evolution returned no file for this message. Check that it is an image, video, audio, document or sticker message.',
    });
  }

  const id = String((message.key as IDataObject).id);
  const converted = options.convertToMp4 === true && response.mimetype === 'audio/mp4';
  const fileName = String(options.fileName || '').trim() || mediaFileName(response, id, converted);
  const mimeType = typeof response.mimetype === 'string' ? response.mimetype : undefined;

  const json: IDataObject = { messageId: id, ...response, fileName };
  delete json.base64;
  delete json.buffer;
  if (options.includeBase64 === true) json.base64 = base64;

  const propertyName =
    String(this.getNodeParameter('binaryPropertyName', itemIndex, 'data')).trim() || 'data';
  const binary = await base64ToBinary.call(this, base64, fileName, mimeType);
  return [{ json, binary: { [propertyName]: binary } }];
}
