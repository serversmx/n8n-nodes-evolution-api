import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';

/** No fields besides the shared "Instance Name". */
export const description: INodeProperties[] = [];

/**
 * GET /proxy/find/:instanceName
 * Returns { enabled, host, port, protocol, username, password } or an empty body (→ {}) when no proxy is set.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  return (await evolutionApiRequest.call(
    this,
    'GET',
    `/proxy/find/${instance}`,
    {},
    {},
    { itemIndex },
  )) as IDataObject;
}
