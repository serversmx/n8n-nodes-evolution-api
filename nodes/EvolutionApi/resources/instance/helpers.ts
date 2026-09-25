import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeProperties,
} from 'n8n-workflow';

import { base64ToBinary, isPlainObject } from '../../GenericFunctions';

/** "Options" entries shared by Create and Connect to output the QR code as a PNG file. */
export const qrCodeBinaryOptions: INodeProperties[] = [
  {
    displayName: 'Put QR Code in Binary Property',
    name: 'qrCodeAsBinary',
    type: 'boolean',
    default: false,
    description:
      'Whether to also output the QR code as a PNG file, e.g. to send it by email or chat',
  },
  {
    displayName: 'Binary Property',
    name: 'binaryPropertyName',
    type: 'string',
    default: 'data',
    description: 'Name of the binary property that receives the QR code PNG',
  },
];

/** Find the QR code data URI in a create (`qrcode.base64`) or connect (`base64`) response. */
export function findQrCodeBase64(response: IDataObject): string | undefined {
  const nested = isPlainObject(response.qrcode) ? response.qrcode.base64 : undefined;
  const value = nested ?? response.base64;
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** Return the response, adding the QR code as binary when the option is on and a QR exists. */
export async function withQrCodeBinary(
  this: IExecuteFunctions,
  response: IDataObject,
  options: IDataObject,
): Promise<IDataObject | INodeExecutionData[]> {
  const base64 = findQrCodeBase64(response);
  if (!options.qrCodeAsBinary || !base64) return response;

  const propertyName = String(options.binaryPropertyName || 'data').trim() || 'data';
  const binary = await base64ToBinary.call(this, base64, 'qrcode.png', 'image/png');
  return [{ json: response, binary: { [propertyName]: binary } }];
}
