import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';

/** No fields besides the shared "Instance Name". */
export const description: INodeProperties[] = [];

/**
 * GET /chat/fetchPrivacySettings/:instanceName (200) →
 * { readreceipts, profile, status, online, last, groupadd }.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  return (await evolutionApiRequest.call(
    this,
    'GET',
    `/chat/fetchPrivacySettings/${instance}`,
    {},
    {},
    { itemIndex },
  )) as IDataObject;
}
