import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';

/** No fields besides the shared "Instance Name". */
export const description: INodeProperties[] = [];

/**
 * DELETE /instance/delete/:instanceName → { status: 'SUCCESS', error: false, response: { message } }
 * A connected instance is logged out first. 2.4 keeps deleting even when that logout fails.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  return (await evolutionApiRequest.call(
    this,
    'DELETE',
    `/instance/delete/${instance}`,
    {},
    {},
    { itemIndex },
  )) as IDataObject;
}
