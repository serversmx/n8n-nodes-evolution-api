import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';

/** No fields besides the shared "Instance Name". */
export const description: INodeProperties[] = [];

/**
 * DELETE /instance/logout/:instanceName → { status: 'SUCCESS', error: false, response: { message } }
 * Already disconnected: 2.3.x answers 400 'The "<name>" instance is not connected',
 * 2.4+ answers 200 with message 'Instance was already disconnected'.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  return (await evolutionApiRequest.call(
    this,
    'DELETE',
    `/instance/logout/${instance}`,
    {},
    {},
    { itemIndex },
  )) as IDataObject;
}
