import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import {
  assertNoSoftError,
  evolutionApiRequest,
  resolveInstanceName,
} from '../../GenericFunctions';

/** No fields besides the shared "Instance Name". */
export const description: INodeProperties[] = [];

/**
 * POST /instance/restart/:instanceName (POST in 2.3.7, 2.4.0-rc2 and develop; not PUT).
 * Returns { instance: { instanceName, status } } or, for Baileys, the connect payload.
 * A closed instance is answered with HTTP 200 { error: true, message } → turned into an error.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const response = (await evolutionApiRequest.call(
    this,
    'POST',
    `/instance/restart/${instance}`,
    {},
    {},
    { itemIndex },
  )) as IDataObject;

  assertNoSoftError(
    this.getNode(),
    response,
    itemIndex,
    'Evolution API could not restart this instance. It must be connected or connecting; use "Connect" for a closed instance.',
  );

  return response;
}
