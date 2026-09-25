import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import type { MediaInputType } from '../../GenericFunctions';
import { evolutionApiRequest, resolveInstanceName, resolveMedia } from '../../GenericFunctions';
import { getGroupJid, groupJidProperty } from './helpers';

const PICTURE_SOURCES: MediaInputType[] = ['base64', 'binary', 'url'];

const properties: INodeProperties[] = [
  groupJidProperty(),
  {
    displayName: 'Picture Source',
    name: 'groupPictureSource',
    type: 'options',
    options: [
      {
        name: 'Base64',
        value: 'base64',
        description: 'Base64-encoded image (a data: URI prefix is removed automatically)',
      },
      {
        name: 'Binary File',
        value: 'binary',
        description: 'Image in a binary property of the input item',
      },
      {
        name: 'URL',
        value: 'url',
        description: 'Public http(s) URL of the image, downloaded by the Evolution API server',
      },
    ],
    default: 'url',
    description:
      'Where the new group picture comes from. The image is cropped to a square JPEG before upload.',
  },
  {
    displayName: 'Picture URL',
    name: 'groupPictureUrl',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'e.g. https://example.com/logo.jpg',
    displayOptions: { show: { groupPictureSource: ['url'] } },
    description:
      'http(s) URL of the image, downloaded by the Evolution API server. Its host must be a domain name (e.g. example.com) or an IP address: names such as localhost or minio are rejected. Evolution adds a "timestamp" query parameter, which breaks pre-signed URLs (S3 and similar): use Binary File for those.',
  },
  {
    displayName: 'Picture (Base64)',
    name: 'groupPictureBase64',
    type: 'string',
    typeOptions: { rows: 4 },
    required: true,
    default: '',
    displayOptions: { show: { groupPictureSource: ['base64'] } },
    description: 'Base64-encoded image, with or without a data:image/…;base64, prefix',
  },
  {
    displayName: 'Input Binary Field',
    name: 'binaryPropertyName',
    type: 'string',
    required: true,
    default: 'data',
    displayOptions: { show: { groupPictureSource: ['binary'] } },
    hint: 'The name of the input binary field containing the image',
    description: 'Name of the binary property of the input item that holds the image',
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['group'], operation: ['updatePicture'] } },
  properties,
);

/**
 * POST /group/updateGroupPicture/:instanceName { groupJid, image } (updateGroupPictureSchema)
 * → { update: 'success' } (HTTP 201). JSON only (no multipart on this route): `image` is an http(s)
 * URL or raw base64 (class-validator isURL/isBase64; a data: URI fails with a 500), so binary
 * input is sent as base64. isURL requires a TLD or an IP host, and the service sets
 * `?timestamp=<now>` on the URL before downloading it. Admins only, unless the group is "unlocked".
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const groupJid = getGroupJid.call(this, itemIndex);

  // Expressions may send "URL" or "Binary": the option values are lower case.
  const source = String(this.getNodeParameter('groupPictureSource', itemIndex, 'url'))
    .trim()
    .toLowerCase() as MediaInputType;
  if (!PICTURE_SOURCES.includes(source)) {
    throw new NodeOperationError(this.getNode(), `Invalid picture source "${String(source)}"`, {
      itemIndex,
      description: `Use one of: ${PICTURE_SOURCES.join(', ')}.`,
    });
  }
  const media = await resolveMedia.call(this, itemIndex, {
    type: source,
    url:
      source === 'url' ? (this.getNodeParameter('groupPictureUrl', itemIndex, '') as string) : '',
    base64:
      source === 'base64'
        ? (this.getNodeParameter('groupPictureBase64', itemIndex, '') as string)
        : '',
    binaryPropertyName:
      source === 'binary'
        ? (this.getNodeParameter('binaryPropertyName', itemIndex, 'data') as string)
        : undefined,
  });

  const mimeType = (media.mimeType ?? '').toLowerCase();
  if (mimeType && !mimeType.startsWith('image/') && mimeType !== 'application/octet-stream') {
    throw new NodeOperationError(this.getNode(), `The picture must be an image, not ${mimeType}`, {
      itemIndex,
      description: 'Use a JPEG or PNG image.',
    });
  }

  return (await evolutionApiRequest.call(
    this,
    'POST',
    `/group/updateGroupPicture/${instance}`,
    { groupJid, image: media.value },
    {},
    { itemIndex },
  )) as IDataObject;
}
