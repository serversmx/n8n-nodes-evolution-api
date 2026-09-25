import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, normalizeNumber, resolveInstanceName } from '../../GenericFunctions';
import { catalogNumberProperty } from './getCatalog.operation';

const properties: INodeProperties[] = [
  catalogNumberProperty,
  {
    displayName: 'Options',
    name: 'options',
    type: 'collection',
    placeholder: 'Add Option',
    default: {},
    options: [
      {
        displayName: 'Max Collections',
        name: 'maxCollections',
        type: 'number',
        typeOptions: { minValue: 1, maxValue: 20 },
        default: 20,
        description: 'Maximum number of collections to return (Evolution caps it at 20)',
      },
    ],
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['template'], operation: ['getCollections'] } },
  properties,
);

/**
 * POST /business/getCollections/:instanceName { number?, limit? } (collectionsSchema, identical
 * in 2.3.7 and 2.4; limit above 20, or missing, becomes 20). WhatsApp Baileys instances only.
 * Answers 200 { wuid, name, numberExists, isBusiness, collectionsLength, collections: [...] },
 * or 200 { wuid, name: null, isBusiness: false } when WhatsApp fails to return them.
 * Errors are a 400 { message, details } (the router catches everything).
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const number = normalizeNumber(this.getNodeParameter('number', itemIndex, ''));
  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

  const body: IDataObject = {};
  if (number) body.number = number;
  if (options.maxCollections !== undefined) {
    body.limit = Math.min(20, Math.max(1, Math.round(Number(options.maxCollections))));
  }

  return (await evolutionApiRequest.call(
    this,
    'POST',
    `/business/getCollections/${instance}`,
    body,
    {},
    { itemIndex, idempotent: true },
  )) as IDataObject;
}
