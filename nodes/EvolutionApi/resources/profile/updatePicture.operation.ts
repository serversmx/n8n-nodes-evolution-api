import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import type { MediaInputType } from '../../GenericFunctions';
import { evolutionApiRequest, resolveInstanceName, resolveMedia } from '../../GenericFunctions';

const properties: INodeProperties[] = [
  {
    displayName: 'Picture Source',
    name: 'profilePictureSource',
    type: 'options',
    options: [
      {
        name: 'Base64',
        value: 'base64',
        description: 'Image as a base64 string (a data: URI prefix is removed)',
      },
      {
        name: 'Binary File',
        value: 'binary',
        description: 'Image from a binary field of the input item',
      },
      {
        name: 'URL',
        value: 'url',
        description: 'Public http(s) URL of the image, downloaded by the Evolution server',
      },
    ],
    default: 'url',
    description: 'Where the new profile picture comes from',
  },
  {
    displayName: 'Picture URL',
    name: 'profilePictureUrl',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'https://example.com/avatar.jpg',
    displayOptions: { show: { profilePictureSource: ['url'] } },
    description: 'Public http(s) URL of the image (JPEG or PNG)',
  },
  {
    displayName: 'Picture Base64',
    name: 'profilePictureBase64',
    type: 'string',
    required: true,
    default: '',
    typeOptions: { rows: 3 },
    displayOptions: { show: { profilePictureSource: ['base64'] } },
    description: 'Image (JPEG or PNG) encoded as base64',
  },
  {
    displayName: 'Input Binary Field',
    name: 'binaryPropertyName',
    type: 'string',
    required: true,
    default: 'data',
    displayOptions: { show: { profilePictureSource: ['binary'] } },
    description: 'Name of the binary field of the input item that contains the image',
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['profile'], operation: ['updatePicture'] } },
  properties,
);

const PICTURE_SOURCES: MediaInputType[] = ['url', 'base64', 'binary'];

/**
 * POST /chat/updateProfilePicture/:instanceName { picture: <http(s) URL | raw base64> }
 * (profilePictureSchema, 200) → { update: 'success' }. Anything else is answered 500
 * '"profilePicture" must be a url or a base64'. A binary file is sent as base64 (the route
 * takes no multipart). Evolution reloads the WhatsApp connection afterwards (a few seconds
 * offline).
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const source = this.getNodeParameter('profilePictureSource', itemIndex, 'url') as MediaInputType;
  if (!PICTURE_SOURCES.includes(source)) {
    throw new NodeOperationError(this.getNode(), `Unknown picture source "${source}"`, {
      itemIndex,
    });
  }

  const media = await resolveMedia.call(this, itemIndex, {
    type: source,
    url:
      source === 'url'
        ? (this.getNodeParameter('profilePictureUrl', itemIndex, '') as string)
        : undefined,
    base64:
      source === 'base64'
        ? (this.getNodeParameter('profilePictureBase64', itemIndex, '') as string)
        : undefined,
    binaryPropertyName:
      source === 'binary'
        ? (this.getNodeParameter('binaryPropertyName', itemIndex, 'data') as string)
        : undefined,
  });

  return (await evolutionApiRequest.call(
    this,
    'POST',
    `/chat/updateProfilePicture/${instance}`,
    { picture: media.value },
    {},
    { itemIndex },
  )) as IDataObject;
}
