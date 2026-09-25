import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import {
  applySendOptions,
  delayOption,
  getRecipient,
  getString,
  mentionOptions,
  numberProperty,
  operationError,
  postMessage,
  quotedOptions,
  sendOptionsProperty,
} from './helpers';

const properties: INodeProperties[] = [
  numberProperty,
  {
    displayName: 'Latitude',
    name: 'latitude',
    type: 'number',
    required: true,
    default: 0,
    typeOptions: { minValue: -90, maxValue: 90, numberPrecision: 7 },
    placeholder: '19.4326077',
    description: 'Latitude in decimal degrees (-90 to 90)',
  },
  {
    displayName: 'Longitude',
    name: 'longitude',
    type: 'number',
    required: true,
    default: 0,
    typeOptions: { minValue: -180, maxValue: 180, numberPrecision: 7 },
    placeholder: '-99.133208',
    description: 'Longitude in decimal degrees (-180 to 180)',
  },
  {
    displayName: 'Name',
    name: 'locationName',
    type: 'string',
    default: '',
    placeholder: 'Main office',
    description: 'Name of the place shown above the map',
  },
  {
    displayName: 'Address',
    name: 'locationAddress',
    type: 'string',
    default: '',
    placeholder: 'Av. Reforma 222, Mexico City',
    description: 'Address shown under the name',
  },
  sendOptionsProperty([delayOption(), ...mentionOptions, ...quotedOptions()]),
];

export const description = updateDisplayOptions(
  { show: { resource: ['message'], operation: ['sendLocation'] } },
  properties,
);

function readCoordinate(
  this: IExecuteFunctions,
  itemIndex: number,
  name: 'latitude' | 'longitude',
  limit: number,
): number {
  const raw = this.getNodeParameter(name, itemIndex, '');
  const value = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  if (raw === '' || raw === null || !Number.isFinite(value) || Math.abs(value) > limit) {
    throw operationError(
      this.getNode(),
      itemIndex,
      `${name === 'latitude' ? 'Latitude' : 'Longitude'} must be a number between -${limit} and ${limit}`,
    );
  }
  return value;
}

/**
 * POST /message/sendLocation/:instanceName (locationMessageSchema, HTTP 201)
 * { number, latitude, longitude, name, address, delay?, quoted?, mentionsEveryOne?, mentioned? }.
 * `name` and `address` are schema-required keys, so they are always sent (possibly empty).
 * A custom messageId is not honoured by this route.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const number = getRecipient.call(this, itemIndex);
  const latitude = readCoordinate.call(this, itemIndex, 'latitude', 90);
  const longitude = readCoordinate.call(this, itemIndex, 'longitude', 180);
  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

  const body = applySendOptions(this.getNode(), itemIndex, options, {
    number,
    latitude,
    longitude,
    name: getString.call(this, 'locationName', itemIndex),
    address: getString.call(this, 'locationAddress', itemIndex),
  });
  return await postMessage.call(this, itemIndex, 'sendLocation', body);
}
