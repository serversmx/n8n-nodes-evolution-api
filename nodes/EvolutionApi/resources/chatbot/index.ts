import type { INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import type { OperationHandler } from '../../types';
import * as changeStatus from './changeStatus.operation';
import * as create from './create.operation';
import * as createCredential from './createCredential.operation';
import * as deleteBot from './delete.operation';
import * as deleteCredential from './deleteCredential.operation';
import { botIdProperty, botTypeProperty } from './fields';
import * as get from './get.operation';
import * as getCredentials from './getCredentials.operation';
import * as getMany from './getMany.operation';
import * as getModels from './getModels.operation';
import * as getSessions from './getSessions.operation';
import * as getSettings from './getSettings.operation';
import * as ignoreJid from './ignoreJid.operation';
import * as setSettings from './setSettings.operation';
import * as start from './start.operation';
import * as update from './update.operation';

export { methods } from './methods';

/**
 * Chatbot resource: the dify, evoai, evolutionBot, flowise, n8n, openai and typebot integrations
 * (src/api/integrations/chatbot/<bot>/routes/<bot>.router.ts, identical in 2.3.7 and 2.4.0-rc2).
 * They share BaseChatbotController, so one set of operations with a "Bot Type" selector covers
 * all of them (EVONODE-2: hand-written per-bot code broke Flowise and Dify in the community
 * node). OpenAI credentials/models and Typebot Start only exist for their integration.
 * Chatwoot has its own resource.
 */
export const operations: INodeProperties = {
  displayName: 'Operation',
  name: 'operation',
  type: 'options',
  noDataExpression: true,
  displayOptions: {
    show: {
      resource: ['chatbot'],
    },
  },
  options: [
    {
      name: 'Change Session Status',
      value: 'changeStatus',
      description:
        "Pause, resume, close or delete a contact's bot session. Pause hands the chat to a human; Close and Delete affect that contact's sessions on every instance of the server.",
      action: 'Change the status of a bot session',
    },
    {
      name: 'Create',
      value: 'create',
      description: 'Create a bot with its trigger and behavior settings',
      action: 'Create a bot',
    },
    {
      name: 'Create OpenAI Credential',
      value: 'createCredential',
      description: 'Store an OpenAI API key in Evolution for the OpenAI bots of an instance',
      action: 'Create an OpenAI credential',
    },
    {
      name: 'Delete',
      value: 'delete',
      description: 'Delete a bot and all its sessions',
      action: 'Delete a bot',
    },
    {
      name: 'Delete OpenAI Credential',
      value: 'deleteCredential',
      description: 'Delete an OpenAI API key stored in Evolution',
      action: 'Delete an OpenAI credential',
    },
    {
      name: 'Get',
      value: 'get',
      description: 'Get a bot by ID',
      action: 'Get a bot',
    },
    {
      name: 'Get Many',
      value: 'getMany',
      description: 'Get the bots of a chatbot integration',
      action: 'Get many bots',
    },
    {
      name: 'Get OpenAI Credentials',
      value: 'getCredentials',
      description: 'Get the OpenAI credentials stored for an instance and the bots that use them',
      action: 'Get OpenAI credentials',
    },
    {
      name: 'Get OpenAI Models',
      value: 'getModels',
      description: 'List the OpenAI models available to a stored OpenAI credential',
      action: 'Get OpenAI models',
    },
    {
      name: 'Get Sessions',
      value: 'getSessions',
      description:
        'Get the sessions of a bot (contact, status opened/paused/closed, whether it awaits the user)',
      action: 'Get bot sessions',
    },
    {
      name: 'Get Settings',
      value: 'getSettings',
      description:
        'Get the default settings of a chatbot integration (timeouts, finish keyword, ignored JIDs, fallback bot)',
      action: 'Get default bot settings',
    },
    {
      name: 'Ignore JID',
      value: 'ignoreJid',
      description: 'Add a chat to, or remove it from, the list of chats the bots of a type ignore',
      action: 'Add or remove an ignored JID',
    },
    {
      name: 'Set Settings',
      value: 'setSettings',
      description:
        'Change some default settings of a chatbot integration; the settings you do not add keep their current value',
      action: 'Set default bot settings',
    },
    {
      name: 'Start Typebot',
      value: 'start',
      description: 'Start a Typebot flow for a contact, optionally with prefilled variables',
      action: 'Start a Typebot flow',
    },
    {
      name: 'Update',
      value: 'update',
      description:
        'Change some fields of a bot; the fields you do not add keep their current value',
      action: 'Update a bot',
    },
  ],
  default: 'getMany',
};

/** Operations that act on one integration (OpenAI credentials/models and Start are fixed). */
const BOT_TYPE_OPERATIONS = [
  'changeStatus',
  'create',
  'delete',
  'get',
  'getMany',
  'getSessions',
  'getSettings',
  'ignoreJid',
  'setSettings',
  'update',
];

export const fields: INodeProperties[] = [
  ...updateDisplayOptions({ show: { resource: ['chatbot'], operation: BOT_TYPE_OPERATIONS } }, [
    botTypeProperty,
  ]),
  ...updateDisplayOptions(
    { show: { resource: ['chatbot'], operation: ['delete', 'get', 'getSessions', 'update'] } },
    [botIdProperty],
  ),
  ...changeStatus.description,
  ...create.description,
  ...createCredential.description,
  ...deleteBot.description,
  ...deleteCredential.description,
  ...get.description,
  ...getCredentials.description,
  ...getMany.description,
  ...getModels.description,
  ...getSessions.description,
  ...getSettings.description,
  ...ignoreJid.description,
  ...setSettings.description,
  ...start.description,
  ...update.description,
];

export const execute: Record<string, OperationHandler> = {
  changeStatus: changeStatus.execute,
  create: create.execute,
  createCredential: createCredential.execute,
  delete: deleteBot.execute,
  deleteCredential: deleteCredential.execute,
  get: get.execute,
  getCredentials: getCredentials.execute,
  getMany: getMany.execute,
  getModels: getModels.execute,
  getSessions: getSessions.execute,
  getSettings: getSettings.execute,
  ignoreJid: ignoreJid.execute,
  setSettings: setSettings.execute,
  start: start.execute,
  update: update.execute,
};
