import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';

/** No fields besides the shared "Instance Name". */
export const description: INodeProperties[] = [];

/**
 * GET /instance/connectionState/:instanceName → { instance: { instanceName, state } }
 * state: "open" | "connecting" | "close" (undefined when the instance is not loaded).
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  return (await evolutionApiRequest.call(
    this,
    'GET',
    `/instance/connectionState/${instance}`,
    {},
    {},
    { itemIndex },
  )) as IDataObject;
}
