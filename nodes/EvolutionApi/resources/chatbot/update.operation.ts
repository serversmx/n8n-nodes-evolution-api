import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import {
  encodePathSegment,
  evolutionApiRequest,
  resolveInstanceName,
} from '../../GenericFunctions';
import { DIFY_BOT_TYPE_OPTIONS, OPENAI_BOT_TYPE_OPTIONS } from './create.operation';
import {
  BEHAVIOR_OPTIONS,
  N8N_AUTH_OPTIONS,
  OPENAI_MESSAGE_OPTIONS,
  sortOptions,
  TRIGGER_OPERATOR_OPTIONS,
  TRIGGER_TYPE_OPTIONS,
} from './fields';
import { fetchBot } from './get.operation';
import {
  collectBotFields,
  parseBotType,
  pickBotBody,
  redactBotSecrets,
  secretsOptionsProperty,
  validateBotBody,
  withChatbotHint,
} from './helpers';

const only = (...botTypes: string[]) => ({ show: { '/botType': botTypes } });

const properties: INodeProperties[] = [
  {
    displayName: 'Update Fields',
    name: 'updateFields',
    type: 'collection',
    placeholder: 'Add Field',
    default: {},
    description:
      'Only the fields added here change; the node reads the bot first and resends every other field, because Evolution validates updates like a new bot',
    options: sortOptions([
      {
        displayName: 'Description',
        name: 'description',
        type: 'string',
        default: '',
        description: 'Name shown for the bot in the Evolution manager and in bot lists',
      },
      {
        displayName: 'Enabled',
        name: 'enabled',
        type: 'boolean',
        default: true,
        description: 'Whether the bot answers messages',
      },
      {
        displayName: 'Trigger Type',
        name: 'triggerType',
        type: 'options',
        options: TRIGGER_TYPE_OPTIONS,
        default: 'keyword',
      },
      {
        displayName: 'Trigger Operator',
        name: 'triggerOperator',
        type: 'options',
        options: TRIGGER_OPERATOR_OPTIONS,
        default: 'contains',
        description: 'Used with Trigger Type "Keyword"',
      },
      {
        displayName: 'Trigger Value',
        name: 'triggerValue',
        type: 'string',
        default: '',
        description: 'Keyword ("Keyword") or filter ("Advanced") that starts the bot',
      },
      ...BEHAVIOR_OPTIONS,
      {
        displayName: 'Typebot URL',
        name: 'typebotUrl',
        type: 'string',
        default: '',
        displayOptions: only('typebot'),
        description: 'Base URL of the Typebot viewer',
      },
      {
        displayName: 'Typebot Public ID',
        name: 'typebotPublicId',
        type: 'string',
        default: '',
        displayOptions: only('typebot'),
      },
      {
        displayName: 'OpenAI Credential Name or ID',
        name: 'openaiCredsId',
        type: 'options',
        typeOptions: {
          loadOptionsMethod: 'chatbotGetOpenaiCredentials',
          loadOptionsDependsOn: ['instanceName.value'],
        },
        default: '',
        displayOptions: only('openai'),
        description:
          'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
      },
      {
        displayName: 'OpenAI Bot Type',
        name: 'openaiBotType',
        type: 'options',
        options: OPENAI_BOT_TYPE_OPTIONS,
        default: 'chatCompletion',
        displayOptions: only('openai'),
      },
      {
        displayName: 'Assistant ID',
        name: 'assistantId',
        type: 'string',
        default: '',
        displayOptions: only('openai'),
        description: 'ID of the OpenAI Assistant (OpenAI Bot Type "Assistant")',
      },
      {
        displayName: 'Model',
        name: 'model',
        type: 'string',
        default: '',
        displayOptions: only('openai'),
        description: 'OpenAI model ID (OpenAI Bot Type "Chat Completion")',
      },
      {
        displayName: 'Max Tokens',
        name: 'maxTokens',
        type: 'number',
        typeOptions: { minValue: 1 },
        default: 500,
        displayOptions: only('openai'),
        description: 'Maximum number of tokens of each reply (OpenAI Bot Type "Chat Completion")',
      },
      ...OPENAI_MESSAGE_OPTIONS,
      {
        displayName: 'Dify Bot Type',
        name: 'difyBotType',
        type: 'options',
        options: DIFY_BOT_TYPE_OPTIONS,
        default: 'chatBot',
        displayOptions: only('dify'),
      },
      {
        displayName: 'API URL',
        name: 'apiUrl',
        type: 'string',
        default: '',
        displayOptions: only('dify', 'flowise', 'evolutionBot'),
      },
      {
        displayName: 'API Key',
        name: 'apiKey',
        type: 'string',
        typeOptions: { password: true },
        default: '',
        displayOptions: only('dify', 'flowise', 'evolutionBot', 'evoai'),
      },
      {
        displayName: 'Agent URL',
        name: 'agentUrl',
        type: 'string',
        default: '',
        displayOptions: only('evoai'),
      },
      {
        displayName: 'Webhook URL',
        name: 'webhookUrl',
        type: 'string',
        default: '',
        displayOptions: only('n8n'),
        description: 'Production URL of the n8n Webhook node that receives the messages',
      },
      ...N8N_AUTH_OPTIONS,
    ]),
  },
  secretsOptionsProperty,
];

export const description = updateDisplayOptions(
  { show: { resource: ['chatbot'], operation: ['update'] } },
  properties,
);

/**
 * GET /:botType/fetch/:botId/:instanceName, merge, then PUT /:botType/update/:botId/:instanceName.
 * The update is validated with the create schema (enabled, triggerType and the bot's required
 * fields must be present), so every stored field is resent. Answers 200 with the updated row;
 * duplicate triggers or bots answer HTTP 500.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const node = this.getNode();
  const instance = await resolveInstanceName.call(this, itemIndex);
  const botType = parseBotType(node, this.getNodeParameter('botType', itemIndex), itemIndex);
  const botId = String(
    this.getNodeParameter('botId', itemIndex, '', { extractValue: true }),
  ).trim();
  const changes = this.getNodeParameter('updateFields', itemIndex, {}) as IDataObject;
  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

  if (Object.keys(changes).length === 0) {
    throw new NodeOperationError(node, 'Add at least one field to update', {
      itemIndex,
      description: 'Use "Update Fields" to choose what to change in the bot.',
    });
  }

  const current = await fetchBot.call(this, itemIndex, instance);
  const body = {
    ...pickBotBody(current, botType.value),
    ...collectBotFields(changes, botType.value),
  };
  validateBotBody(node, body, botType.value, itemIndex);

  let bot: IDataObject;
  try {
    bot = (await evolutionApiRequest.call(
      this,
      'PUT',
      `/${botType.value}/update/${encodePathSegment(botId, 'Bot ID')}/${instance}`,
      body,
      {},
      { itemIndex },
    )) as IDataObject;
  } catch (error) {
    throw withChatbotHint(
      error,
      `Evolution rejects a second enabled "All" ${botType.info.label} bot, a trigger used by another bot and a duplicate bot (same URL and key).`,
    );
  }
  return options.includeSecrets === true ? bot : redactBotSecrets(bot);
}
