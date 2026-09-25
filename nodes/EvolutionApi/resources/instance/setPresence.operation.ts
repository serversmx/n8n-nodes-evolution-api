import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { PRESENCE_OPTIONS } from '../../constants';
import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';

const properties: INodeProperties[] = [
  {
    displayName: 'Presence',
    name: 'presence',
    type: 'options',
    options: PRESENCE_OPTIONS,
    default: 'available',
    description: 'Global presence of the account (presenceOnlySchema)',
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['instance'], operation: ['setPresence'] } },
  properties,
);

/**
 * POST /instance/setPresence/:instanceName { presence } → { presence } (HTTP 201).
 * WhatsApp Baileys only: Cloud API and Evolution channel instances answer 400.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const presence = this.getNodeParameter('presence', itemIndex) as string;
  return (await evolutionApiRequest.call(
    this,
    'POST',
    `/instance/setPresence/${instance}`,
    { presence },
    {},
    { itemIndex },
  )) as IDataObject;
}
