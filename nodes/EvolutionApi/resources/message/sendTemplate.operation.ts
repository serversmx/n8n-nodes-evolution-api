import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { parseJsonParameter } from '../../GenericFunctions';
import {
  getRecipient,
  getString,
  numberProperty,
  operationError,
  postMessage,
  sendOptionsProperty,
} from './helpers';

const properties: INodeProperties[] = [
  numberProperty,
  {
    displayName: 'Template Name',
    name: 'templateName',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'order_confirmation',
    description: 'Name of an approved WhatsApp Business template (see Template > Get Many)',
  },
  {
    displayName: 'Language',
    name: 'templateLanguage',
    type: 'string',
    required: true,
    default: 'en_US',
    placeholder: 'es_MX',
    description: 'Language code of the approved template, e.g. en_US, es_MX, pt_BR',
  },
  {
    displayName: 'Components (JSON)',
    name: 'templateComponents',
    type: 'json',
    default: '[]',
    description:
      'Meta "components" array with the values of the template variables, passed as-is to the Cloud API, e.g. [{ "type": "body", "parameters": [{ "type": "text", "text": "Jane" }] }]. Use [] for templates without variables.',
  },
  sendOptionsProperty([
    {
      displayName: 'Reply To Message ID',
      name: 'quotedMessageId',
      type: 'string',
      default: '',
      description: 'ID (wamid) of the message to reply to',
    },
    {
      displayName: 'Status Webhook URL',
      name: 'webhookUrl',
      type: 'string',
      default: '',
      placeholder: 'https://example.com/whatsapp-status',
      description:
        'URL that Evolution notifies with the delivery status updates (sent, delivered, read) of this message',
    },
  ]),
];

export const description = updateDisplayOptions(
  { show: { resource: ['message'], operation: ['sendTemplate'] } },
  properties,
);

/**
 * POST /message/sendTemplate/:instanceName (templateMessageSchema, HTTP 201)
 * { number, name, language, components?, webhookUrl?, quoted? }. WhatsApp Cloud API
 * (WHATSAPP-BUSINESS) instances only: Baileys answers "Method not available in the Baileys
 * service". Meta errors come back with HTTP 201 and are turned into errors by postMessage().
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const node = this.getNode();
  const number = getRecipient.call(this, itemIndex);
  const name = getString.call(this, 'templateName', itemIndex);
  const language = getString.call(this, 'templateLanguage', itemIndex);
  if (!name) throw operationError(node, itemIndex, 'Template Name is required');
  if (!language) throw operationError(node, itemIndex, 'Language is required');

  const body: IDataObject = { number, name, language };

  let components: unknown;
  try {
    components = parseJsonParameter(
      this.getNodeParameter('templateComponents', itemIndex, ''),
      'Components (JSON)',
    );
  } catch (error) {
    throw operationError(node, itemIndex, (error as Error).message);
  }
  if (components !== undefined && components !== null) {
    if (!Array.isArray(components)) {
      throw operationError(node, itemIndex, 'Components (JSON) must be a JSON array');
    }
    if (components.length > 0) body.components = components as IDataObject[];
  }

  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
  const quotedMessageId = String(options.quotedMessageId ?? '').trim();
  if (quotedMessageId) body.quoted = { key: { id: quotedMessageId } };
  const webhookUrl = String(options.webhookUrl ?? '').trim();
  if (webhookUrl) {
    if (!/^https?:\/\//i.test(webhookUrl)) {
      throw operationError(
        node,
        itemIndex,
        'Status Webhook URL must start with http:// or https://',
      );
    }
    body.webhookUrl = webhookUrl;
  }

  return await postMessage.call(this, itemIndex, 'sendTemplate', body);
}
