import type { INodeProperties, INodePropertyOptions } from 'n8n-workflow';

import { CHATBOT_TYPE_OPTIONS } from './helpers';

/**
 * Fields shared by several chatbot operations. Option names inside the collections are the
 * FIELD_SPECS names of helpers.ts (collectBotFields converts them into body keys).
 */

/** "Bot Type" (stub field: name, type and default must not change). */
export const botTypeProperty: INodeProperties = {
  displayName: 'Bot Type',
  name: 'botType',
  type: 'options',
  options: CHATBOT_TYPE_OPTIONS,
  default: 'n8n',
  description:
    'Chatbot integration. Each one must be enabled on the Evolution server, otherwise it answers 400 "<Integration> is disabled".',
};

/** "Bot" of Get, Update, Delete and Get Sessions. */
export const botIdProperty: INodeProperties = {
  displayName: 'Bot',
  name: 'botId',
  type: 'resourceLocator',
  required: true,
  default: { mode: 'list', value: '' },
  description: 'Bot of the selected type on this instance',
  modes: [
    {
      displayName: 'From List',
      name: 'list',
      type: 'list',
      placeholder: 'Select a bot...',
      typeOptions: {
        searchListMethod: 'chatbotSearchBots',
        searchable: true,
      },
    },
    {
      displayName: 'By ID',
      name: 'id',
      type: 'string',
      placeholder: 'e.g. cm3abc123def456ghi789jkl',
    },
  ],
};

/** "OpenAI Credential" of Create (OpenAI bots) and Delete OpenAI Credential. */
export const openaiCredentialProperty: INodeProperties = {
  displayName: 'OpenAI Credential Name or ID',
  name: 'openaiCredsId',
  type: 'options',
  typeOptions: {
    loadOptionsMethod: 'chatbotGetOpenaiCredentials',
    loadOptionsDependsOn: ['instanceName.value'],
  },
  required: true,
  default: '',
  description:
    'OpenAI API key stored in Evolution for this instance (see Create OpenAI Credential). Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
};

export const TRIGGER_TYPE_OPTIONS: INodePropertyOptions[] = [
  {
    name: 'Advanced',
    value: 'advanced',
    description:
      'Trigger Value is a filter: space-separated operator:value pairs (contains, notcontains, startswith, endswith, exact; commas = all of these values), e.g. "contains:price startswith:hi"',
  },
  {
    name: 'All',
    value: 'all',
    description:
      'Every message from a contact without an open session starts the bot. Only one enabled bot per type can use it.',
  },
  {
    name: 'Keyword',
    value: 'keyword',
    description: 'Messages that match Trigger Operator and Trigger Value start the bot',
  },
  {
    name: 'None',
    value: 'none',
    description:
      'Evolution matches it like All (any message starts the bot) but without the one-bot limit',
  },
];

export const TRIGGER_OPERATOR_OPTIONS: INodePropertyOptions[] = [
  { name: 'Contains', value: 'contains' },
  { name: 'Ends With', value: 'endsWith' },
  { name: 'Equals', value: 'equals' },
  {
    name: 'Regex',
    value: 'regex',
    description: 'Trigger Value is a JavaScript regular expression',
  },
  { name: 'Starts With', value: 'startsWith' },
];

/**
 * Behavior fields shared by bots and default settings (BaseChatbotDto / BaseChatbotSettingDto).
 * A bot's own value wins over the default settings of its type.
 */
export const BEHAVIOR_OPTIONS: INodeProperties[] = [
  {
    displayName: 'Debounce Time (Seconds)',
    name: 'debounceTime',
    type: 'number',
    typeOptions: { minValue: 0 },
    default: 1,
    description:
      'Seconds to wait for more messages from the contact before sending them to the bot as one (0 = no wait)',
  },
  {
    displayName: 'Delay Message (Ms)',
    name: 'delayMessage',
    type: 'number',
    typeOptions: { minValue: 0 },
    default: 1000,
    description: 'Milliseconds of "typing…" before each bot reply',
  },
  {
    displayName: 'Expire (Minutes)',
    name: 'expire',
    type: 'number',
    typeOptions: { minValue: 0 },
    default: 300,
    description:
      'Minutes without messages after which the session expires and the next message starts over (0 = never). Evolution only enforces it for Typebot.',
  },
  {
    displayName: 'Ignore JIDs',
    name: 'ignoreJids',
    type: 'string',
    default: '',
    placeholder: '@g.us, 5215512345678@s.whatsapp.net',
    description:
      'Chats the bot ignores, comma or newline separated: "@g.us" for every group, "@s.whatsapp.net" for every 1:1 chat, or the exact JID of a chat as in data.key.remoteJid (Evolution compares it as-is). A phone number is turned into …@s.whatsapp.net as typed, without WhatsApp number rules (a Mexican 521… number does not match a chat stored as 52…). Replaces the whole list.',
  },
  {
    displayName: 'Keep Open',
    name: 'keepOpen',
    type: 'boolean',
    default: false,
    description:
      'Whether a finished session (Keyword Finish, or Change Session Status > Closed) is kept with status closed instead of deleted. On 2.3.x a kept session keeps the bot silent for that contact; Evolution API v2.4 and later start the bot again on the next message.',
  },
  {
    displayName: 'Keyword Finish',
    name: 'keywordFinish',
    type: 'string',
    default: '',
    placeholder: 'bye',
    description:
      'Message that ends the session (case-insensitive exact match). Empty: no finish keyword.',
  },
  {
    displayName: 'Listening From Me',
    name: 'listeningFromMe',
    type: 'boolean',
    default: false,
    description: 'Whether messages sent from the phone or the API also go to the bot',
  },
  {
    displayName: 'Split Messages',
    name: 'splitMessages',
    type: 'boolean',
    default: false,
    description:
      'Whether to send each paragraph (blank-line separated) of a reply as its own message',
  },
  {
    displayName: 'Stop Bot From Me',
    name: 'stopBotFromMe',
    type: 'boolean',
    default: false,
    description:
      'Whether a message sent from the phone pauses the session of that contact (human takeover)',
  },
  {
    displayName: 'Time Per Char (Ms)',
    name: 'timePerChar',
    type: 'number',
    typeOptions: { minValue: 0 },
    default: 0,
    description:
      'Typing time per character of each split message, between 1 and 20 seconds per message',
  },
  {
    displayName: 'Unknown Message',
    name: 'unknownMessage',
    type: 'string',
    default: '',
    description: 'Reply sent when the bot cannot handle a message, e.g. an unsupported media type',
  },
];

/** OpenAI conversation seed messages (create "Additional Fields" and update "Update Fields"). */
export const OPENAI_MESSAGE_OPTIONS: INodeProperties[] = [
  {
    displayName: 'Assistant Messages',
    name: 'assistantMessages',
    type: 'string',
    typeOptions: { rows: 2 },
    default: '',
    displayOptions: { show: { '/botType': ['openai'] } },
    description:
      'Example assistant messages for chat completions. One message, or several as a JSON array of strings.',
  },
  {
    displayName: 'Function URL',
    name: 'functionUrl',
    type: 'string',
    default: '',
    displayOptions: { show: { '/botType': ['openai'] } },
    description: 'URL Evolution calls when an assistant runs a function (tool call)',
  },
  {
    displayName: 'System Messages',
    name: 'systemMessages',
    type: 'string',
    typeOptions: { rows: 4 },
    default: '',
    displayOptions: { show: { '/botType': ['openai'] } },
    description:
      'Instructions for chat completions. One message, or several as a JSON array of strings.',
  },
  {
    displayName: 'User Messages',
    name: 'userMessages',
    type: 'string',
    typeOptions: { rows: 2 },
    default: '',
    displayOptions: { show: { '/botType': ['openai'] } },
    description:
      'Example user messages for chat completions. One message, or several as a JSON array of strings.',
  },
];

/** n8n webhook Basic Auth (create "Additional Fields" and update "Update Fields"). */
export const N8N_AUTH_OPTIONS: INodeProperties[] = [
  {
    displayName: 'Basic Auth Password',
    name: 'basicAuthPass',
    type: 'string',
    typeOptions: { password: true },
    default: '',
    displayOptions: { show: { '/botType': ['n8n'] } },
    description:
      'Password of the Basic Auth header sent to the n8n webhook (only sent when the user is set too)',
  },
  {
    displayName: 'Basic Auth User',
    name: 'basicAuthUser',
    type: 'string',
    default: '',
    displayOptions: { show: { '/botType': ['n8n'] } },
    description: 'User of the Basic Auth header sent to the n8n webhook',
  },
];

/** Sort collection options by display name, case-insensitively (n8n convention). */
export function sortOptions(options: INodeProperties[]): INodeProperties[] {
  return [...options].sort((a, b) =>
    a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase()),
  );
}
