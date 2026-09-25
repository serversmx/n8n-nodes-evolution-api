import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';

/** No fields besides the shared "Instance Name". */
export const description: INodeProperties[] = [];

/**
 * DELETE /chat/removeProfilePicture/:instanceName (no body, 200) → { update: 'success' }.
 * Evolution reloads the WhatsApp connection afterwards (a few seconds offline).
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  return (await evolutionApiRequest.call(
    this,
    'DELETE',
    `/chat/removeProfilePicture/${instance}`,
    {},
    {},
    { itemIndex },
  )) as IDataObject;
}
