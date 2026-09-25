import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName, toArray } from '../../GenericFunctions';
import { TEMPLATE_CATEGORY_OPTIONS } from './helpers';

const properties: INodeProperties[] = [
  {
    displayName: 'Return All',
    name: 'returnAll',
    type: 'boolean',
    default: false,
    description:
      'Whether to return all results in the first Meta page instead of applying a limit. Evolution API 2.3.7 and 2.4.0-rc2 discard pagination cursors; use the Meta Graph API directly to retrieve additional pages.',
  },
  {
    displayName: 'Limit',
    name: 'limit',
    type: 'number',
    typeOptions: { minValue: 1 },
    default: 50,
    displayOptions: { show: { returnAll: [false] } },
    description: 'Max number of results to return from the first Meta page',
  },
  {
    displayName: 'Filters',
    name: 'filters',
    type: 'collection',
    placeholder: 'Add Filter',
    default: {},
    description: 'Applied by the node only to the first Meta page returned by Evolution API',
    options: [
      {
        displayName: 'Category',
        name: 'category',
        type: 'options',
        options: TEMPLATE_CATEGORY_OPTIONS,
        default: 'UTILITY',
      },
      {
        displayName: 'Language',
        name: 'language',
        type: 'string',
        default: '',
        placeholder: 'en_US',
        description: 'Exact language code of the template',
      },
      {
        displayName: 'Name Contains',
        name: 'name',
        type: 'string',
        default: '',
        description: 'Case-insensitive part of the template name',
      },
      {
        displayName: 'Status',
        name: 'status',
        type: 'options',
        options: [
          { name: 'Approved', value: 'APPROVED' },
          { name: 'Disabled', value: 'DISABLED' },
          { name: 'In Appeal', value: 'IN_APPEAL' },
          { name: 'Paused', value: 'PAUSED' },
          { name: 'Pending', value: 'PENDING' },
          { name: 'Pending Deletion', value: 'PENDING_DELETION' },
          { name: 'Rejected', value: 'REJECTED' },
        ],
        default: 'APPROVED',
        description: 'Review status of the template at Meta. Only approved templates can be sent.',
      },
    ],
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['template'], operation: ['getMany'] } },
  properties,
);

function matches(template: IDataObject, filters: IDataObject): boolean {
  const name = String(filters.name ?? '')
    .trim()
    .toLowerCase();
  if (
    name &&
    !String(template.name ?? '')
      .toLowerCase()
      .includes(name)
  )
    return false;
  for (const key of ['language', 'status', 'category']) {
    const wanted = String(filters[key] ?? '').trim();
    if (wanted && String(template[key] ?? '').toLowerCase() !== wanted.toLowerCase()) return false;
  }
  return true;
}

/**
 * GET /template/find/:instanceName → array of Meta message templates
 * ({ id, name, language, status, category, components, … }), one item each.
 * WhatsApp Cloud API instances only (uses the instance token and Business Account ID).
 * Evolution returns only the first page of Meta's list. When Meta rejects the call (e.g. no
 * Business Account ID, or a Baileys instance) TemplateService#find returns `undefined` and the
 * body is empty: that is turned into an error. Thrown errors come back as HTTP 400
 * { status, error, message, details: { whatsapp_error, whatsapp_code, … } }.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject[]> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
  const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;

  const response = await evolutionApiRequest.call(
    this,
    'GET',
    `/template/find/${instance}`,
    {},
    {},
    { itemIndex },
  );
  if (!Array.isArray(response) && Object.keys(response).length === 0) {
    throw new NodeOperationError(this.getNode(), 'Meta did not return the message templates', {
      itemIndex,
      description:
        'Evolution API answered with no data, which means the WhatsApp Cloud API request failed. Templates only exist on WhatsApp Cloud API instances created with a Business Account ID and a valid access token.',
    });
  }

  const templates = toArray(response).filter((template) => matches(template, filters));
  if (returnAll) return templates;
  const limit = this.getNodeParameter('limit', itemIndex, 50) as number;
  return templates.slice(0, limit);
}
