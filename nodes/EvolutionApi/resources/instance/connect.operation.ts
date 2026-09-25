import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeProperties,
} from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import {
  assertNoSoftError,
  evolutionApiRequest,
  normalizeNumber,
  resolveInstanceName,
} from '../../GenericFunctions';
import { qrCodeBinaryOptions, withQrCodeBinary } from './helpers';

const properties: INodeProperties[] = [
  {
    displayName: 'Options',
    name: 'options',
    type: 'collection',
    placeholder: 'Add Option',
    default: {},
    options: [
      {
        displayName: 'Phone Number (Pairing Code)',
        name: 'number',
        type: 'string',
        default: '',
        placeholder: '5215512345678',
        description:
          'Phone number with country code. Evolution then also returns an 8-character pairing code to type in WhatsApp > Linked devices, instead of scanning the QR code (WhatsApp Baileys only).',
      },
      ...qrCodeBinaryOptions,
    ],
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['instance'], operation: ['connect'] } },
  properties,
);

/**
 * GET /instance/connect/:instanceName[?number=]
 * - state "close": starts the session and returns { pairingCode, code, base64, count }
 * - state "connecting": returns the current QR code (no new pairing code)
 * - state "open": returns { instance: { instanceName, state: 'open' } }
 * Errors are answered with HTTP 200 { error: true, message } (instance.controller.ts).
 */
export async function execute(
  this: IExecuteFunctions,
  itemIndex: number,
): Promise<IDataObject | INodeExecutionData[]> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

  const qs: IDataObject = {};
  const number = normalizeNumber(options.number);
  if (number) qs.number = number;

  const response = (await evolutionApiRequest.call(
    this,
    'GET',
    `/instance/connect/${instance}`,
    {},
    qs,
    { itemIndex },
  )) as IDataObject;

  assertNoSoftError(
    this.getNode(),
    response,
    itemIndex,
    'Evolution API could not start the connection of this instance',
  );

  return await withQrCodeBinary.call(this, response, options);
}
