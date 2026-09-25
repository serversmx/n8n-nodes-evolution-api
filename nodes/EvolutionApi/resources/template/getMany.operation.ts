import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName, toArray } from '../../GenericFunctions';

/** No fields besides the shared "Instance Name". */
export const description: INodeProperties[] = [];

/**
 * GET /template/find/:instanceName → Meta message templates (`data` of the Graph API answer).
 * WhatsApp Cloud API instances only (needs businessId). Meta errors come back as HTTP 400
 * { status, error, message, details: { whatsapp_error, whatsapp_code, … } }.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject[]> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const response = await evolutionApiRequest.call(
    this,
    'GET',
    `/template/find/${instance}`,
    {},
    {},
    { itemIndex },
  );
  return toArray(response);
}
