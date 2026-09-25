import type { INodeProperties } from 'n8n-workflow';

import type { OperationHandler } from '../../types';
import * as create from './create.operation';
import * as deleteTemplate from './delete.operation';
import * as getCatalog from './getCatalog.operation';
import * as getCollections from './getCollections.operation';
import * as getMany from './getMany.operation';
import * as update from './update.operation';

/**
 * Template resource: WhatsApp Cloud API message templates (src/api/routes/template.router.ts)
 * plus the WhatsApp Business catalog of Baileys instances (src/api/routes/business.router.ts).
 * Both routers are identical in 2.3.7 and 2.4.0-rc2 and answer every error with
 * 400 { status, error, message, details: { whatsapp_error, … } }.
 */
export const operations: INodeProperties = {
  displayName: 'Operation',
  name: 'operation',
  type: 'options',
  noDataExpression: true,
  displayOptions: {
    show: {
      resource: ['template'],
    },
  },
  options: [
    {
      name: 'Create',
      value: 'create',
      description:
        'Submit a new message template to Meta for review (WhatsApp Cloud API instances only)',
      action: 'Create a template',
    },
    {
      name: 'Delete',
      value: 'delete',
      description:
        'Delete a message template by name, in every language or one version (WhatsApp Cloud API instances only)',
      action: 'Delete a template',
    },
    {
      name: 'Get Catalog',
      value: 'getCatalog',
      description:
        'Get the product catalog of a WhatsApp Business account (WhatsApp Baileys instances only)',
      action: 'Get a product catalog',
    },
    {
      name: 'Get Catalog Collections',
      value: 'getCollections',
      description:
        'Get the product collections of a WhatsApp Business catalog (WhatsApp Baileys instances only)',
      action: 'Get catalog collections',
    },
    {
      name: 'Get Many',
      value: 'getMany',
      description:
        'Get the message templates of a WhatsApp Cloud API instance with their status and components',
      action: 'Get many templates',
    },
    {
      name: 'Update',
      value: 'update',
      description:
        'Change the category, components or message TTL of a message template (WhatsApp Cloud API instances only)',
      action: 'Update a template',
    },
  ],
  default: 'getMany',
};

export const fields: INodeProperties[] = [
  ...create.description,
  ...deleteTemplate.description,
  ...getCatalog.description,
  ...getCollections.description,
  ...getMany.description,
  ...update.description,
];

export const execute: Record<string, OperationHandler> = {
  create: create.execute,
  delete: deleteTemplate.execute,
  getCatalog: getCatalog.execute,
  getCollections: getCollections.execute,
  getMany: getMany.execute,
  update: update.execute,
};
