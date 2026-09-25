import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName, toArray } from '../../GenericFunctions';

/** No fields besides the shared "Instance Name". */
export const description: INodeProperties[] = [];

/**
 * GET /label/findLabels/:instanceName → [{ id, name, color, predefinedId }]
 * (labels are a WhatsApp Business app feature; other accounts return []).
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject[]> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const response = await evolutionApiRequest.call(
    this,
    'GET',
    `/label/findLabels/${instance}`,
    {},
    {},
    { itemIndex },
  );
  return toArray(response);
}
