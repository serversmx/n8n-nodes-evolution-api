import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';
import { parseComponents, TEMPLATE_CATEGORY_OPTIONS } from './helpers';

const properties: INodeProperties[] = [
  {
    displayName: 'Name',
    name: 'templateName',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'order_update',
    description: 'Template name: lowercase letters, numbers and underscores (Meta rule)',
  },
  {
    displayName: 'Category',
    name: 'templateCategory',
    type: 'options',
    options: TEMPLATE_CATEGORY_OPTIONS,
    default: 'UTILITY',
    description: 'Meta template category. It decides the price and the review rules.',
  },
  {
    displayName: 'Language',
    name: 'templateLanguage',
    type: 'string',
    required: true,
    default: 'en_US',
    placeholder: 'en_US',
    description: 'Language code of this template version, e.g. en_US, es_MX, pt_BR',
  },
  {
    displayName: 'Components (JSON)',
    name: 'templateComponents',
    type: 'json',
    required: true,
    default: '[\n  {\n    "type": "BODY",\n    "text": "Hello {{1}}, your order is ready."\n  }\n]',
    description:
      'Meta components array (HEADER, BODY, FOOTER, BUTTONS), as in the WhatsApp Cloud API "message_templates" endpoint. Variables are written {{1}}, {{2}}…',
  },
  {
    displayName: 'Additional Fields',
    name: 'additionalFields',
    type: 'collection',
    placeholder: 'Add Field',
    default: {},
    options: [
      {
        displayName: 'Allow Category Change',
        name: 'allowCategoryChange',
        type: 'boolean',
        default: false,
        description: 'Whether Meta may assign another category instead of rejecting the template',
      },
      {
        displayName: 'Status Webhook URL',
        name: 'webhookUrl',
        type: 'string',
        default: '',
        placeholder: 'https://n8n.example.com/webhook/template-status',
        description:
          'URL to which Evolution forwards the Meta review status updates (message_template_status_update) of this template',
      },
    ],
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['template'], operation: ['create'] } },
  properties,
);

/**
 * POST /template/create/:instanceName { name, category, language, components,
 * allowCategoryChange?, webhookUrl? } (templateSchema, identical in 2.3.7 and 2.4). WhatsApp
 * Cloud API instances only: Evolution forwards it to Meta with the instance token and Business
 * Account ID, then answers 201 with the stored Template row { id, templateId, name,
 * template (Meta answer: id, status, category), webhookUrl, instanceId, … }.
 * Every error (validation included) is a 400 { message, details: { whatsapp_error, … } }.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const name = String(this.getNodeParameter('templateName', itemIndex, '')).trim();
  const language = String(this.getNodeParameter('templateLanguage', itemIndex, '')).trim();
  const components = parseComponents(this.getNodeParameter('templateComponents', itemIndex, ''));
  if (!name || !language || !components?.length) {
    throw new NodeOperationError(this.getNode(), 'Name, Language and Components are required', {
      itemIndex,
      description: 'Components must be a non-empty JSON array.',
    });
  }

  const fields = this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject;
  const body: IDataObject = {
    name,
    category: this.getNodeParameter('templateCategory', itemIndex) as string,
    language,
    components: components as IDataObject[],
  };
  if (fields.allowCategoryChange !== undefined) {
    body.allowCategoryChange = fields.allowCategoryChange === true;
  }
  const webhookUrl = String(fields.webhookUrl ?? '').trim();
  if (webhookUrl) body.webhookUrl = webhookUrl;

  return (await evolutionApiRequest.call(
    this,
    'POST',
    `/template/create/${instance}`,
    body,
    {},
    { itemIndex },
  )) as IDataObject;
}
