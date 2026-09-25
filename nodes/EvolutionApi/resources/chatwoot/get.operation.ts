import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';

/** No fields besides the shared "Instance Name". */
export const description: INodeProperties[] = [];

/**
 * GET /chatwoot/find/:instanceName
 * Returns the Chatwoot settings plus webhook_url; { enabled: false, ... } when not configured. 400 "Chatwoot is disabled" when CHATWOOT_ENABLED=false. The output includes the Chatwoot access token (token).
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  return (await evolutionApiRequest.call(
    this,
    'GET',
    `/chatwoot/find/${instance}`,
    {},
    {},
    { itemIndex },
  )) as IDataObject;
}
