import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';
import { parseComponents, TEMPLATE_CATEGORY_OPTIONS } from './helpers';

const properties: INodeProperties[] = [
  {
    displayName: 'Template ID',
    name: 'templateId',
    type: 'string',
    required: true,
    default: '',
    placeholder: '1234567890123456',
    description: 'Meta ID of the template (the "id" returned by Get Many or Create)',
  },
  {
    displayName: 'Update Fields',
    name: 'updateFields',
    type: 'collection',
    placeholder: 'Add Field',
    default: {},
    description: 'Only the fields added here are sent to Meta',
    options: [
      {
        displayName: 'Allow Category Change',
        name: 'allowCategoryChange',
        type: 'boolean',
        default: false,
        description: 'Whether Meta may assign another category instead of rejecting the change',
      },
      {
        displayName: 'Category',
        name: 'category',
        type: 'options',
        options: TEMPLATE_CATEGORY_OPTIONS,
        default: 'UTILITY',
      },
      {
        displayName: 'Components (JSON)',
        name: 'components',
        type: 'json',
        default: '[]',
        description:
          'New Meta components array (HEADER, BODY, FOOTER, BUTTONS). It replaces all current components.',
      },
      {
        displayName: 'Message TTL (Seconds)',
        name: 'ttl',
        type: 'number',
        typeOptions: { minValue: 0 },
        default: 86400,
        description:
          'How long WhatsApp keeps trying to deliver messages that use this template (sent to Meta as time_to_live)',
      },
    ],
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['template'], operation: ['update'] } },
  properties,
);

/**
 * POST /template/edit/:instanceName { templateId, category?, allowCategoryChange?, ttl?,
 * components? } (templateEditSchema, identical in 2.3.7 and 2.4). Evolution sends the fields to
 * POST <graph>/<templateId> and answers 200 with Meta's response (e.g. { success: true }).
 * Every error is a 400 { message, details: { whatsapp_error, … } }.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const node = this.getNode();
  const instance = await resolveInstanceName.call(this, itemIndex);
  const templateId = String(this.getNodeParameter('templateId', itemIndex, '')).trim();
  if (!templateId) {
    throw new NodeOperationError(node, 'Template ID is required', { itemIndex });
  }

  const fields = this.getNodeParameter('updateFields', itemIndex, {}) as IDataObject;
  const body: IDataObject = { templateId };
  if (fields.category) body.category = String(fields.category);
  if (fields.allowCategoryChange !== undefined) {
    body.allowCategoryChange = fields.allowCategoryChange === true;
  }
  if (fields.ttl !== undefined && fields.ttl !== null && fields.ttl !== '') {
    body.ttl = Number(fields.ttl);
  }
  if (fields.components !== undefined) {
    // Evolution forwards any array, and Meta rejects an empty one: [] (the default) is not sent.
    const components = parseComponents(fields.components);
    if (components?.length) body.components = components as IDataObject[];
  }
  if (Object.keys(body).length === 1) {
    throw new NodeOperationError(node, 'Add at least one field to update', {
      itemIndex,
      description: 'Use "Update Fields" to choose what to change in the template.',
    });
  }

  return (await evolutionApiRequest.call(
    this,
    'POST',
    `/template/edit/${instance}`,
    body,
    {},
    { itemIndex },
  )) as IDataObject;
}
