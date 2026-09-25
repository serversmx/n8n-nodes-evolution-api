import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';

/** No fields besides the shared "Instance Name". */
export const description: INodeProperties[] = [];

/**
 * GET /settings/find/:instanceName
 * Returns { rejectCall, msgCall, groupsIgnore, alwaysOnline, readMessages, readStatus, syncFullHistory, wavoipToken } or an empty body (→ {}).
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  return (await evolutionApiRequest.call(
    this,
    'GET',
    `/settings/find/${instance}`,
    {},
    {},
    { itemIndex },
  )) as IDataObject;
}
