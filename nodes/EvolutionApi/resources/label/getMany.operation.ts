import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName, toArray } from '../../GenericFunctions';

/** No fields besides the shared "Instance Name". */
export const description: INodeProperties[] = [];

/**
 * GET /label/findLabels/:instanceName (200) → [{ id, name, color, predefinedId }], one item per
 * label. `id` is the WhatsApp label ID used by Add to Chat / Remove from Chat; `color` is a
 * WhatsApp palette index. Read from Evolution's database (synced from LABELS_EDIT events): only
 * WhatsApp Business accounts have labels, other accounts return no items.
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
