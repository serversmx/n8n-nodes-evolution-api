import type { IDataObject, INode, INodeProperties, INodePropertyOptions } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import { BOT_TYPE_OPTIONS } from '../../constants';
import { isPlainObject, parseJsonParameter, toJid } from '../../GenericFunctions';

// ============================================================================
// Bot types
// ============================================================================

export type BotType = 'dify' | 'evoai' | 'evolutionBot' | 'flowise' | 'n8n' | 'openai' | 'typebot';

export interface BotTypeInfo {
  /** Name used in messages. */
  label: string;
  /** Server switch; the routes answer 400 "<Integration> is disabled" when it is off. */
  env?: string;
  /** Bot-specific keys of the create/update body (getAdditionalBotData of each controller). */
  specificKeys: string[];
}

/**
 * The 7 integrations mounted by src/api/integrations/chatbot/chatbot.router.ts. They share
 * BaseChatbotController, so every route and body is identical apart from the specific keys.
 */
export const BOT_TYPES: Record<BotType, BotTypeInfo> = {
  dify: { label: 'Dify', env: 'DIFY_ENABLED', specificKeys: ['botType', 'apiUrl', 'apiKey'] },
  evoai: { label: 'EvoAI', env: 'EVOAI_ENABLED', specificKeys: ['agentUrl', 'apiKey'] },
  evolutionBot: { label: 'Evolution Bot', specificKeys: ['apiUrl', 'apiKey'] },
  flowise: { label: 'Flowise', env: 'FLOWISE_ENABLED', specificKeys: ['apiUrl', 'apiKey'] },
  n8n: {
    label: 'n8n',
    env: 'N8N_ENABLED',
    specificKeys: ['webhookUrl', 'basicAuthUser', 'basicAuthPass'],
  },
  openai: {
    label: 'OpenAI',
    env: 'OPENAI_ENABLED',
    specificKeys: [
      'openaiCredsId',
      'botType',
      'assistantId',
      'functionUrl',
      'model',
      'systemMessages',
      'assistantMessages',
      'userMessages',
      'maxTokens',
    ],
  },
  typebot: { label: 'Typebot', env: 'TYPEBOT_ENABLED', specificKeys: ['url', 'typebot'] },
};

const BOT_TYPE_DESCRIPTIONS: Record<BotType, string> = {
  dify: 'Dify apps: chat bot, text generator, agent or workflow (DIFY_ENABLED=true)',
  evoai: 'EvoAI agents (EVOAI_ENABLED=true)',
  evolutionBot:
    'Your own HTTP endpoint: Evolution posts each message to its API URL and sends the reply back (always available)',
  flowise: 'Flowise chatflows (FLOWISE_ENABLED=true)',
  n8n: "Evolution's native n8n integration: each message is posted to an n8n webhook, whose output is sent back (N8N_ENABLED=true)",
  openai:
    'OpenAI assistants or chat completions, using OpenAI credentials stored in Evolution (OPENAI_ENABLED=true)',
  typebot: 'Typebot flows (TYPEBOT_ENABLED=true)',
};

/** The shared bot-type options with a description of each integration. */
export const CHATBOT_TYPE_OPTIONS: INodePropertyOptions[] = BOT_TYPE_OPTIONS.map((option) => ({
  ...option,
  description: BOT_TYPE_DESCRIPTIONS[option.value as BotType] ?? option.description,
}));

/** Validate a bot type (it can come from an expression). */
export function parseBotType(
  node: INode,
  value: unknown,
  itemIndex?: number,
): { value: BotType; info: BotTypeInfo } {
  const name = String(value ?? '').trim();
  if (!Object.prototype.hasOwnProperty.call(BOT_TYPES, name)) {
    throw new NodeOperationError(node, `Unknown bot type "${name}"`, {
      itemIndex,
      description: `Use one of: ${Object.keys(BOT_TYPES).join(', ')}.`,
    });
  }
  return { value: name as BotType, info: BOT_TYPES[name as BotType] };
}

// ============================================================================
// Field specs: collection option name → body key + conversion
// ============================================================================

type FieldKind = 'boolean' | 'integer' | 'string' | 'jidList' | 'messageList';

interface BotFieldSpec {
  key: string;
  kind: FieldKind;
  /** Bot types that use the field (all when omitted). */
  botTypes?: BotType[];
}

/** Common create/update keys (BaseChatbotDto). */
export const COMMON_BOT_KEYS = [
  'enabled',
  'description',
  'triggerType',
  'triggerOperator',
  'triggerValue',
  'expire',
  'keywordFinish',
  'delayMessage',
  'unknownMessage',
  'listeningFromMe',
  'stopBotFromMe',
  'keepOpen',
  'debounceTime',
  'ignoreJids',
  'splitMessages',
  'timePerChar',
];

const FIELD_SPECS: Record<string, BotFieldSpec> = {
  enabled: { key: 'enabled', kind: 'boolean' },
  description: { key: 'description', kind: 'string' },
  triggerType: { key: 'triggerType', kind: 'string' },
  triggerOperator: { key: 'triggerOperator', kind: 'string' },
  triggerValue: { key: 'triggerValue', kind: 'string' },
  expire: { key: 'expire', kind: 'integer' },
  keywordFinish: { key: 'keywordFinish', kind: 'string' },
  delayMessage: { key: 'delayMessage', kind: 'integer' },
  unknownMessage: { key: 'unknownMessage', kind: 'string' },
  listeningFromMe: { key: 'listeningFromMe', kind: 'boolean' },
  stopBotFromMe: { key: 'stopBotFromMe', kind: 'boolean' },
  keepOpen: { key: 'keepOpen', kind: 'boolean' },
  debounceTime: { key: 'debounceTime', kind: 'integer' },
  ignoreJids: { key: 'ignoreJids', kind: 'jidList' },
  splitMessages: { key: 'splitMessages', kind: 'boolean' },
  timePerChar: { key: 'timePerChar', kind: 'integer' },
  // Typebot
  typebotUrl: { key: 'url', kind: 'string', botTypes: ['typebot'] },
  typebotPublicId: { key: 'typebot', kind: 'string', botTypes: ['typebot'] },
  // OpenAI
  openaiCredsId: { key: 'openaiCredsId', kind: 'string', botTypes: ['openai'] },
  openaiBotType: { key: 'botType', kind: 'string', botTypes: ['openai'] },
  assistantId: { key: 'assistantId', kind: 'string', botTypes: ['openai'] },
  model: { key: 'model', kind: 'string', botTypes: ['openai'] },
  maxTokens: { key: 'maxTokens', kind: 'integer', botTypes: ['openai'] },
  functionUrl: { key: 'functionUrl', kind: 'string', botTypes: ['openai'] },
  systemMessages: { key: 'systemMessages', kind: 'messageList', botTypes: ['openai'] },
  assistantMessages: { key: 'assistantMessages', kind: 'messageList', botTypes: ['openai'] },
  userMessages: { key: 'userMessages', kind: 'messageList', botTypes: ['openai'] },
  speechToText: { key: 'speechToText', kind: 'boolean', botTypes: ['openai'] },
  // Dify, Flowise, Evolution Bot, EvoAI
  difyBotType: { key: 'botType', kind: 'string', botTypes: ['dify'] },
  apiUrl: { key: 'apiUrl', kind: 'string', botTypes: ['dify', 'flowise', 'evolutionBot'] },
  apiKey: { key: 'apiKey', kind: 'string', botTypes: ['dify', 'flowise', 'evolutionBot', 'evoai'] },
  agentUrl: { key: 'agentUrl', kind: 'string', botTypes: ['evoai'] },
  // n8n
  webhookUrl: { key: 'webhookUrl', kind: 'string', botTypes: ['n8n'] },
  basicAuthUser: { key: 'basicAuthUser', kind: 'string', botTypes: ['n8n'] },
  // The schema documents basicAuthPassword, but the DTO and the controller read basicAuthPass.
  basicAuthPass: { key: 'basicAuthPass', kind: 'string', botTypes: ['n8n'] },
};

/**
 * JIDs from a comma/newline separated string or an array. Numbers become full JIDs; the
 * wildcards "@g.us" (every group) and "@s.whatsapp.net" (every 1:1 chat) are kept as-is.
 */
export function parseJidList(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : String(value ?? '').split(/[,\n;]/);
  const jids = entries.map((entry) => toJid(String(entry ?? ''))).filter((entry) => entry);
  return [...new Set(jids)];
}

/** One message, or several as a JSON array of strings. */
export function parseMessageList(value: unknown, label: string): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  const text = String(value ?? '').trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    const parsed = parseJsonParameter(text, label);
    if (!Array.isArray(parsed)) throw new Error(`${label} must be a JSON array of strings`);
    return parsed.map((entry) => String(entry));
  }
  return [text];
}

function toInteger(value: unknown, label: string): number {
  const number = Number(value);
  if (value === '' || value === null || !Number.isFinite(number)) {
    throw new Error(`${label} must be a number`);
  }
  return Math.round(number);
}

/**
 * Convert collection values (create "Additional Fields", update "Update Fields", settings
 * "Settings to Change") into body keys. Fields that do not apply to the bot type are skipped.
 */
export function collectBotFields(values: IDataObject, botType: BotType): IDataObject {
  const body: IDataObject = {};
  for (const [name, value] of Object.entries(values)) {
    const spec = FIELD_SPECS[name];
    if (!spec || (spec.botTypes && !spec.botTypes.includes(botType))) continue;
    switch (spec.kind) {
      case 'boolean':
        body[spec.key] = value === true;
        break;
      case 'integer':
        body[spec.key] = toInteger(value, name);
        break;
      case 'jidList':
        body[spec.key] = parseJidList(value);
        break;
      case 'messageList':
        body[spec.key] = parseMessageList(value, name);
        break;
      default:
        body[spec.key] = typeof value === 'string' ? value.trim() : String(value ?? '');
    }
  }
  return body;
}

/** Keys of a stored bot (GET /<bot>/fetch) that its create/update body accepts. */
export function pickBotBody(bot: IDataObject, botType: BotType): IDataObject {
  const body: IDataObject = {};
  for (const key of [...COMMON_BOT_KEYS, ...BOT_TYPES[botType].specificKeys]) {
    const value = bot[key];
    // null columns would fail the schema types (e.g. description: string).
    if (value !== undefined && value !== null) body[key] = value;
  }
  return body;
}

/**
 * The checks every createBot/updateBot runs (they answer HTTP 500 otherwise), done before the
 * request so the error names the missing field.
 */
export function validateBotBody(
  node: INode,
  body: IDataObject,
  botType: BotType,
  itemIndex: number,
): void {
  const missing: string[] = [];
  if (body.triggerType === 'keyword') {
    if (!body.triggerOperator) missing.push('Trigger Operator');
    if (!body.triggerValue) missing.push('Trigger Value');
  }
  if (body.triggerType === 'advanced' && !body.triggerValue) missing.push('Trigger Value');
  if (botType === 'openai') {
    if (!body.openaiCredsId) missing.push('OpenAI Credential');
    if (body.botType === 'assistant' && !body.assistantId) missing.push('Assistant ID');
    if (body.botType === 'chatCompletion') {
      if (!body.model) missing.push('Model');
      if (!body.maxTokens) missing.push('Max Tokens');
    }
  }
  const required: Partial<Record<BotType, Array<[string, string]>>> = {
    typebot: [
      ['url', 'Typebot URL'],
      ['typebot', 'Typebot Public ID'],
    ],
    dify: [['apiUrl', 'API URL']],
    flowise: [['apiUrl', 'API URL']],
    evolutionBot: [['apiUrl', 'API URL']],
    evoai: [['agentUrl', 'Agent URL']],
    n8n: [['webhookUrl', 'Webhook URL']],
  };
  for (const [key, label] of required[botType] ?? []) {
    if (!body[key]) missing.push(label);
  }
  if (missing.length > 0) {
    throw new NodeOperationError(node, `Missing bot fields: ${missing.join(', ')}`, { itemIndex });
  }
}

// ============================================================================
// Default settings (GET /<bot>/fetchSettings when none are stored)
// ============================================================================

export const SETTINGS_DEFAULTS: IDataObject = {
  expire: 300,
  keywordFinish: 'bye',
  delayMessage: 1000,
  unknownMessage: 'Sorry, I dont understand',
  listeningFromMe: true,
  stopBotFromMe: true,
  keepOpen: false,
  debounceTime: 1,
  ignoreJids: [],
  splitMessages: false,
  timePerChar: 0,
};

// ============================================================================
// Secrets and errors
// ============================================================================

const SECRET_KEYS = new Set(['apiKey', 'basicAuthPass']);

/** Remove API keys and n8n Basic Auth passwords, at any depth (fallback bots, credentials). */
export function redactBotSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => redactBotSecrets(entry)) as T;
  if (!isPlainObject(value)) return value;
  const copy: IDataObject = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!SECRET_KEYS.has(key)) copy[key] = redactBotSecrets(entry);
  }
  return copy as T;
}

/** "Options > Include Secrets" of the chatbot operations. */
export const includeSecretsOption: INodeProperties = {
  displayName: 'Include Secrets',
  name: 'includeSecrets',
  type: 'boolean',
  default: false,
  description:
    'Whether to keep API keys and n8n Basic Auth passwords in the output. Off by default so they are not stored in execution logs.',
};

/** "Options" collection with only "Include Secrets". */
export const secretsOptionsProperty: INodeProperties = {
  displayName: 'Options',
  name: 'options',
  type: 'collection',
  placeholder: 'Add Option',
  default: {},
  options: [includeSecretsOption],
};

/**
 * The chatbot controllers throw plain Errors, which Evolution answers with HTTP 500 and a
 * generic message (e.g. "Error setting default settings"). Add what usually causes it.
 * Returns the error to rethrow.
 */
export function withChatbotHint(error: unknown, hint: string): unknown {
  if (error instanceof NodeApiError && error.httpCode === '500') {
    error.description = `${hint} ${error.description ?? ''}`.trim();
  }
  return error;
}
