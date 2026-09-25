import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { REQUIRES_24 } from '../../constants';
import { buildMediaRequestBody, compactObject, isMultipartSafe } from '../../GenericFunctions';
import {
  applySendOptions,
  delayOption,
  ensureFileExtension,
  fileNameFromUrl,
  getRecipient,
  getString,
  hasFileExtension,
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
  {
    displayName: 'Media Type',
    name: 'mediatype',
    type: 'options',
    options: [
      {
        name: 'Audio File',
        value: 'audio',
        description: 'Regular audio file. Use "Send Audio" for a voice note.',
      },
      { name: 'Document', value: 'document', description: 'Any file (PDF, spreadsheet, ZIP…)' },
      { name: 'Image', value: 'image', description: 'Converted to JPEG by Evolution' },
      { name: 'Video', value: 'video', description: 'MP4 video' },
    ],
    default: 'image',
    description: 'Kind of media to send',
  },
  ...mediaSourceProperties('file'),
  {
    displayName: 'Caption',
    name: 'caption',
    type: 'string',
    default: '',
    typeOptions: { rows: 2 },
    description: 'Text shown under the media',
    displayOptions: { show: { mediatype: ['image', 'video', 'document'] } },
  },
  sendOptionsProperty([
    delayOption(),
    {
      displayName: 'File Name',
      name: 'fileName',
      type: 'string',
      default: '',
      placeholder: 'invoice.pdf',
      description:
        'File name shown to the recipient, including the extension (Evolution derives the MIME type from it). Defaults to the name of the binary file, or for documents to the last part of the URL; required for documents sent as base64 or from a URL without a file extension.',
    },
    {
      displayName: 'GIF Attribution',
      name: 'gifAttribution',
      type: 'options',
      options: [
        { name: 'None', value: 0 },
        { name: 'GIPHY', value: 1 },
        { name: 'Tenor', value: 2 },
      ],
      default: 0,
      description: `Source badge shown on a GIF (video sent with GIF Playback). ${REQUIRES_24}`,
      displayOptions: { show: { '/mediatype': ['video'] } },
    },
    {
      displayName: 'GIF Playback',
      name: 'gifPlayback',
      type: 'boolean',
      default: false,
      description: `Whether to play the video as a looping GIF without sound. ${REQUIRES_24}`,
      displayOptions: { show: { '/mediatype': ['video'] } },
    },
    ...mentionOptions,
    messageIdOption,
    {
      displayName: 'MIME Type',
      name: 'mimetype',
      type: 'string',
      default: '',
      placeholder: 'audio/mpeg',
      description:
        'MIME type of the file, e.g. application/pdf. Evolution derives the MIME type from the file name extension whenever there is a file name, so this value mainly adds a missing extension to the file name; it is sent as-is only when there is no file name.',
    },
    ...quotedOptions(),
  ]),
];

export const description = updateDisplayOptions(
  { show: { resource: ['message'], operation: ['sendMedia'] } },
  properties,
);

const FALLBACK_EXTENSION: Record<string, string> = { image: '.jpg', video: '.mp4' };

/**
 * POST /message/sendMedia/:instanceName (mediaMessageSchema, HTTP 201)
 * { number, mediatype, media (URL or raw base64), caption?, fileName?, mimetype?, delay?, quoted?,
 *   mentionsEveryOne?, mentioned?, messageId? (2.4), gifPlayback? / gifAttribution? (2.4, video) }
 * An n8n binary is uploaded as multipart "file" when every other field is a string (multer
 * delivers form fields as strings, so numbers/booleans such as delay fail the schema there);
 * otherwise it is inlined as base64 in JSON.
 * `fileName` always gets an extension when one can be found (MIME type, URL): whenever a file
 * name is set, Evolution replaces `mimetype` with mimeTypes.lookup(fileName) (2.3.7 and 2.4).
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const node = this.getNode();
  const number = getRecipient.call(this, itemIndex);
  const mediatype = getString.call(this, 'mediatype', itemIndex) || 'image';
  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

  const media = await resolveMediaInput.call(this, itemIndex, {
    fileName: String(options.fileName ?? '').trim(),
    mimeType: String(options.mimetype ?? '').trim(),
  });
  let fileName = ensureFileExtension(media.fileName ?? '', media.mimeType);
  const urlFileName = media.type === 'url' ? fileNameFromUrl(media.value) : '';
  // Evolution recomputes the MIME type from the file name extension ("false" without one).
  if (fileName && !hasFileExtension(fileName) && urlFileName) {
    fileName += urlFileName.substring(urlFileName.lastIndexOf('.'));
  }
  // Images are always re-encoded to JPEG; videos otherwise default to "video.mp4".
  if (fileName && !hasFileExtension(fileName) && FALLBACK_EXTENSION[mediatype]) {
    fileName += FALLBACK_EXTENSION[mediatype];
  }

  if (mediatype === 'document' && !fileName) {
    // Evolution needs the name of a document sent as base64 or file (400 "For base64 the file
    // name must be informed", or a 500 when it tries to read it from the content). For a URL it
    // takes the text before the first dot of the last segment and sends the MIME type "false",
    // so the name is derived here from the URL (or from the MIME Type option).
    if (media.type === 'url') {
      fileName = urlFileName || ensureFileExtension('document', media.mimeType);
      if (!hasFileExtension(fileName)) {
        throw operationError(
          node,
          itemIndex,
          'A file name is required to send a document from a URL without a file extension',
          'Set Options > File Name, including the extension (e.g. invoice.pdf).',
        );
      }
    } else {
      throw operationError(
        node,
        itemIndex,
        'A file name is required to send a document from base64 or binary data',
        'Set Options > File Name, including the extension (e.g. invoice.pdf).',
      );
    }
  }

  const fields: IDataObject = compactObject({
    number,
    mediatype,
    caption: mediatype === 'audio' ? '' : getString.call(this, 'caption', itemIndex),
    fileName,
    mimetype: media.mimeType,
  });
  if (mediatype === 'video') {
    if (options.gifPlayback !== undefined) fields.gifPlayback = options.gifPlayback === true;
    const gifAttribution = Number(options.gifAttribution);
    if (
      options.gifAttribution !== undefined &&
      options.gifAttribution !== '' &&
      [0, 1, 2].includes(gifAttribution)
    ) {
      fields.gifAttribution = gifAttribution;
    }
  }
  applySendOptions(node, itemIndex, options, fields);

  // 2.4 also accepts the GIF options as strings ("true", "2"), which keeps multipart possible.
  const multipartFields: IDataObject = { ...fields };
  if (fields.gifPlayback !== undefined) multipartFields.gifPlayback = String(fields.gifPlayback);
  if (fields.gifAttribution !== undefined) {
    multipartFields.gifAttribution = String(fields.gifAttribution);
  }
  const body =
    media.type === 'binary' && isMultipartSafe(multipartFields)
      ? buildMediaRequestBody(media, multipartFields, { mediaField: 'media', allowMultipart: true })
      : buildMediaRequestBody(media, fields, { mediaField: 'media' });
  return await postMessage.call(this, itemIndex, 'sendMedia', body);
}
