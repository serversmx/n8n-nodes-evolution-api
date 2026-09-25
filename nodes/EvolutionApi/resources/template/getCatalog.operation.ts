import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, normalizeNumber, resolveInstanceName } from '../../GenericFunctions';

/** "Number" of the catalog operations (optional: empty = the instance's own business). */
export const catalogNumberProperty: INodeProperties = {
  displayName: 'Number',
  name: 'number',
  type: 'string',
  default: '',
  placeholder: '5215512345678',
  description:
    'WhatsApp Business number (with country code) or JID whose catalog to read. Leave empty for the catalog of this instance.',
};

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
        displayName: 'Page Size',
        name: 'pageSize',
        type: 'number',
        typeOptions: { minValue: 1 },
        default: 10,
        description:
          'Products per request. Evolution reads up to 5 pages, so at most 5 × this number of products come back.',
      },
    ],
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['template'], operation: ['getCatalog'] } },
  properties,
);

/**
 * POST /business/getCatalog/:instanceName { number?, limit? } (catalogSchema, identical in 2.3.7
 * and 2.4). WhatsApp Baileys instances only. Answers 200 { wuid, numberExists, isBusiness,
 * catalogLength, catalog: [product] }; when WhatsApp fails to return it Evolution answers
 * 200 { wuid, name: null, isBusiness: false }. A number that is not on WhatsApp, and every other
 * error, is a 400 { message, details } (the router catches everything).
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const number = normalizeNumber(this.getNodeParameter('number', itemIndex, ''));
  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

  const body: IDataObject = {};
  if (number) body.number = number;
  if (options.pageSize !== undefined) {
    body.limit = Math.max(1, Math.round(Number(options.pageSize)));
  }

  return (await evolutionApiRequest.call(
    this,
    'POST',
    `/business/getCatalog/${instance}`,
    body,
    {},
    { itemIndex, idempotent: true },
  )) as IDataObject;
}
