import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';

/** No fields besides the shared "Instance Name". */
export const description: INodeProperties[] = [];

/**
 * GET /webhook/find/:instanceName
 * Returns { enabled, url, headers, events, webhookByEvents, webhookBase64 } or an empty body (→ {}) when no webhook is set.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  return (await evolutionApiRequest.call(
    this,
    'GET',
    `/webhook/find/${instance}`,
    {},
    {},
    { itemIndex },
  )) as IDataObject;
}
