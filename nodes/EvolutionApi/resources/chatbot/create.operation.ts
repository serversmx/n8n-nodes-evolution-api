import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';
import {
  BEHAVIOR_OPTIONS,
  N8N_AUTH_OPTIONS,
  OPENAI_MESSAGE_OPTIONS,
  openaiCredentialProperty,
  sortOptions,
  TRIGGER_OPERATOR_OPTIONS,
  TRIGGER_TYPE_OPTIONS,
} from './fields';
import {
  collectBotFields,
  parseBotType,
  redactBotSecrets,
  secretsOptionsProperty,
  validateBotBody,
  withChatbotHint,
} from './helpers';

/** OpenAI bot kinds (openaiSchema botType). */
export const OPENAI_BOT_TYPE_OPTIONS = [
  {
    name: 'Assistant',
    value: 'assistant',
    description: 'An OpenAI Assistant (Assistants API) identified by its ID',
  },
  {
    name: 'Chat Completion',
    value: 'chatCompletion',
    description: 'Chat completions with a model, max tokens and seed messages',
  },
];

/** Dify app kinds (DifyBotType). */
export const DIFY_BOT_TYPE_OPTIONS = [
  { name: 'Agent', value: 'agent' },
  { name: 'Chat Bot', value: 'chatBot' },
  { name: 'Text Generator', value: 'textGenerator' },
  { name: 'Workflow', value: 'workflow' },
];

const properties: INodeProperties[] = [
  {
    displayName: 'Enabled',
    name: 'botEnabled',
    type: 'boolean',
    default: true,
    description: 'Whether the bot answers messages right away',
  },
  {
    displayName: 'Trigger Type',
    name: 'triggerType',
    type: 'options',
    options: TRIGGER_TYPE_OPTIONS,
    default: 'keyword',
    description: 'Which messages start a session with this bot',
  },
  {
    displayName: 'Trigger Operator',
    name: 'triggerOperator',
    type: 'options',
    options: TRIGGER_OPERATOR_OPTIONS,
    default: 'contains',
    displayOptions: { show: { triggerType: ['keyword'] } },
    description: 'How the message is compared with Trigger Value (case-sensitive)',
  },
  {
    displayName: 'Trigger Value',
    name: 'triggerValue',
    type: 'string',
    required: true,
    default: '',
    displayOptions: { show: { triggerType: ['keyword', 'advanced'] } },
    description:
      'Keyword or filter that starts the bot. The Trigger Operator + Trigger Value pair must be unique per instance.',
  },
  {
    displayName: 'Typebot URL',
    name: 'typebotUrl',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'https://typebot.example.com',
    displayOptions: { show: { botType: ['typebot'] } },
    description: 'Base URL of the Typebot viewer (the server that serves the published bot)',
  },
  {
    displayName: 'Typebot Public ID',
    name: 'typebotPublicId',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'my-typebot-abc123',
    displayOptions: { show: { botType: ['typebot'] } },
    description: 'Public ID of the published Typebot (Share > the last part of the link)',
  },
  { ...openaiCredentialProperty, displayOptions: { show: { botType: ['openai'] } } },
  {
    displayName: 'OpenAI Bot Type',
    name: 'openaiBotType',
    type: 'options',
    options: OPENAI_BOT_TYPE_OPTIONS,
    default: 'chatCompletion',
    displayOptions: { show: { botType: ['openai'] } },
  },
  {
    displayName: 'Assistant ID',
    name: 'openaiAssistantId',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'asst_abc123',
    displayOptions: { show: { botType: ['openai'], openaiBotType: ['assistant'] } },
    description: 'ID of the OpenAI Assistant',
  },
  {
    displayName: 'Model',
    name: 'openaiModel',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'gpt-4o-mini',
    displayOptions: { show: { botType: ['openai'], openaiBotType: ['chatCompletion'] } },
    description: 'OpenAI model ID (see Get OpenAI Models)',
  },
  {
    displayName: 'Max Tokens',
    name: 'openaiMaxTokens',
    type: 'number',
    required: true,
    typeOptions: { minValue: 1 },
    default: 500,
    displayOptions: { show: { botType: ['openai'], openaiBotType: ['chatCompletion'] } },
    description: 'Maximum number of tokens of each reply',
  },
  {
    displayName: 'Dify Bot Type',
    name: 'difyBotType',
    type: 'options',
    options: DIFY_BOT_TYPE_OPTIONS,
    default: 'chatBot',
    displayOptions: { show: { botType: ['dify'] } },
    description: 'Type of the Dify app',
  },
  {
    displayName: 'API URL',
    name: 'botApiUrl',
    type: 'string',
    required: true,
    default: '',
    displayOptions: { show: { botType: ['dify', 'flowise', 'evolutionBot'] } },
    description:
      'Dify: API base URL (e.g. https://api.dify.ai/v1). Flowise: prediction URL of the chatflow (…/api/v1/prediction/<ID>). Evolution Bot: URL that receives each message.',
  },
  {
    displayName: 'Agent URL',
    name: 'evoaiAgentUrl',
    type: 'string',
    required: true,
    default: '',
    displayOptions: { show: { botType: ['evoai'] } },
    description: 'URL of the EvoAI agent',
  },
  {
    displayName: 'Webhook URL',
    name: 'n8nWebhookUrl',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'https://n8n.example.com/webhook/whatsapp-bot',
    displayOptions: { show: { botType: ['n8n'] } },
    description:
      'Production URL of an n8n Webhook node (POST). Evolution sends { chatInput, sessionId, remoteJid, pushName, keyId, fromMe, quotedMessage, instanceName, serverUrl, apiKey } and replies with the "output" (or "answer") field of the response. apiKey is the instance token: add Basic Auth User and Password (Additional Fields), check them in the Webhook node and avoid saving those executions.',
  },
  {
    displayName: 'API Key',
    name: 'botApiKey',
    type: 'string',
    typeOptions: { password: true },
    default: '',
    displayOptions: { show: { botType: ['dify', 'flowise', 'evolutionBot', 'evoai'] } },
    description: 'API key of the bot service (required by Dify; optional for the others)',
  },
  {
    displayName: 'Additional Fields',
    name: 'additionalFields',
    type: 'collection',
    placeholder: 'Add Field',
    default: {},
    description:
      'Behavior fields not added here use the default settings of this bot type (Get Settings)',
    options: sortOptions([
      {
        displayName: 'Description',
        name: 'description',
        type: 'string',
        default: '',
        description: 'Name shown for the bot in the Evolution manager and in bot lists',
      },
      ...BEHAVIOR_OPTIONS,
      ...N8N_AUTH_OPTIONS,
      ...OPENAI_MESSAGE_OPTIONS,
    ]),
  },
  secretsOptionsProperty,
];

export const description = updateDisplayOptions(
  { show: { resource: ['chatbot'], operation: ['create'] } },
  properties,
);

/**
 * POST /:botType/create/:instanceName (the <bot>Schema of each integration, identical in 2.3.7
 * and 2.4) → 201 with the stored bot row. Evolution fills the behavior fields that are not sent
 * from the default settings (and creates those settings when missing). A second enabled "All"
 * bot, a duplicate trigger or a duplicate bot (same URL/key) is answered with HTTP 500.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const node = this.getNode();
  const instance = await resolveInstanceName.call(this, itemIndex);
  const botType = parseBotType(node, this.getNodeParameter('botType', itemIndex), itemIndex);
  const param = (name: string, fallback: unknown = '') =>
    this.getNodeParameter(name, itemIndex, fallback);
  const text = (name: string) => String(param(name) ?? '').trim();

  const triggerType = text('triggerType') || 'keyword';
  const body: IDataObject = { enabled: param('botEnabled', true) === true, triggerType };
  if (triggerType === 'keyword') body.triggerOperator = text('triggerOperator') || 'contains';
  if (triggerType === 'keyword' || triggerType === 'advanced') {
    body.triggerValue = text('triggerValue');
  }

  switch (botType.value) {
    case 'typebot':
      body.url = text('typebotUrl');
      body.typebot = text('typebotPublicId');
      break;
    case 'openai':
      body.openaiCredsId = text('openaiCredsId');
      body.botType = text('openaiBotType') || 'chatCompletion';
      if (body.botType === 'assistant') {
        body.assistantId = text('openaiAssistantId');
      } else {
        body.model = text('openaiModel');
        body.maxTokens = Math.round(Number(param('openaiMaxTokens', 0)));
      }
      break;
    case 'dify':
      body.botType = text('difyBotType') || 'chatBot';
      body.apiUrl = text('botApiUrl');
      break;
    case 'flowise':
    case 'evolutionBot':
      body.apiUrl = text('botApiUrl');
      break;
    case 'evoai':
      body.agentUrl = text('evoaiAgentUrl');
      break;
    case 'n8n':
      body.webhookUrl = text('n8nWebhookUrl');
      break;
  }
  if (['dify', 'flowise', 'evolutionBot', 'evoai'].includes(botType.value)) {
    const apiKey = text('botApiKey');
    if (apiKey) body.apiKey = apiKey;
  }

  const fields = this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject;
  Object.assign(body, collectBotFields(fields, botType.value));
  validateBotBody(node, body, botType.value, itemIndex);

  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
  let bot: IDataObject;
  try {
    bot = (await evolutionApiRequest.call(
      this,
      'POST',
      `/${botType.value}/create/${instance}`,
      body,
      {},
      { itemIndex },
    )) as IDataObject;
  } catch (error) {
    throw withChatbotHint(
      error,
      `Evolution rejects a second enabled "All" ${botType.info.label} bot, a trigger that already exists and a duplicate bot (same URL and key).`,
    );
  }
  return options.includeSecrets === true ? bot : redactBotSecrets(bot);
}
