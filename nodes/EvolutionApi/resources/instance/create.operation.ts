import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import { INTEGRATION_OPTIONS, REQUIRES_24 } from '../../constants';
import {
  evolutionApiRequest,
  isPlainObject,
  normalizeNumber,
  parseJsonParameter,
} from '../../GenericFunctions';
import { WEBHOOK_EVENT_OPTIONS } from '../webhook/helpers';
import { qrCodeBinaryOptions, redactCreatedInstanceSecrets, withQrCodeBinary } from './helpers';

const properties: INodeProperties[] = [
  {
    displayName: 'New Instance Name',
    name: 'newInstanceName',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'sales-team',
    description: 'Name of the new instance. It must be unique on the Evolution API server.',
  },
  {
    displayName: 'Integration',
    name: 'integration',
    type: 'options',
    options: INTEGRATION_OPTIONS,
    default: 'WHATSAPP-BAILEYS',
    description: 'Connection type of the new instance',
  },
  {
    displayName: 'Generate QR Code',
    name: 'qrcode',
    type: 'boolean',
    default: true,
    displayOptions: { show: { integration: ['WHATSAPP-BAILEYS'] } },
    description:
      'Whether to start the WhatsApp connection right away and return the QR code (plus a pairing code when "Phone Number" is set). Evolution waits about 5 seconds for it. Evolution skips this when the Chatwoot block is set: use Connect afterwards.',
  },
  {
    displayName: 'Access Token',
    name: 'businessToken',
    type: 'string',
    typeOptions: { password: true },
    required: true,
    default: '',
    displayOptions: { show: { integration: ['WHATSAPP-BUSINESS'] } },
    description:
      "Permanent Meta access token (System User token). Evolution also uses it as this instance's API key.",
  },
  {
    displayName: 'Phone Number ID',
    name: 'phoneNumberId',
    type: 'string',
    required: true,
    default: '',
    displayOptions: { show: { integration: ['WHATSAPP-BUSINESS'] } },
    description: 'Meta phone number ID (from WhatsApp Manager), not the phone number itself',
  },
  {
    displayName: 'Business Account ID',
    name: 'businessId',
    type: 'string',
    default: '',
    displayOptions: { show: { integration: ['WHATSAPP-BUSINESS'] } },
    description: 'WhatsApp Business Account (WABA) ID. Needed to manage message templates.',
  },
  {
    displayName: 'Additional Fields',
    name: 'additionalFields',
    type: 'collection',
    placeholder: 'Add Field',
    default: {},
    displayOptions: { show: { integration: ['WHATSAPP-BAILEYS', 'EVOLUTION'] } },
    options: [
      {
        displayName: 'Instance Token',
        name: 'token',
        type: 'string',
        typeOptions: { password: true },
        default: '',
        description:
          'API key for this instance. Leave empty to let Evolution generate one (returned as "hash" when Options > Include Secrets is on).',
      },
      {
        displayName: 'Phone Number',
        name: 'number',
        type: 'string',
        default: '',
        placeholder: '5215512345678',
        description:
          'Phone number with country code. With "Generate QR Code" on, Evolution also returns a pairing code for it.',
      },
    ],
  },
  {
    displayName: 'Settings',
    name: 'instanceSettings',
    type: 'collection',
    placeholder: 'Add Setting',
    default: {},
    description: 'Behavior settings of the instance. Settings not added here default to off.',
    options: [
      {
        displayName: 'Always Online',
        name: 'alwaysOnline',
        type: 'boolean',
        default: false,
        description: 'Whether to keep the WhatsApp presence as online',
      },
      {
        displayName: 'Call Rejection Message',
        name: 'msgCall',
        type: 'string',
        default: '',
        description: 'Message sent to the caller when "Reject Calls" is on',
      },
      {
        displayName: 'Ignore Groups',
        name: 'groupsIgnore',
        type: 'boolean',
        default: false,
        description: 'Whether to ignore messages from groups',
      },
      {
        displayName: 'Read Messages',
        name: 'readMessages',
        type: 'boolean',
        default: false,
        description: 'Whether to mark incoming messages as read automatically',
      },
      {
        displayName: 'Read Status',
        name: 'readStatus',
        type: 'boolean',
        default: false,
        description: "Whether to mark contacts' status updates as seen automatically",
      },
      {
        displayName: 'Reject Calls',
        name: 'rejectCall',
        type: 'boolean',
        default: false,
        description: 'Whether to reject incoming calls automatically',
      },
      {
        displayName: 'Sync Full History',
        name: 'syncFullHistory',
        type: 'boolean',
        default: false,
        description: 'Whether to request the full chat history when the session connects',
      },
      {
        displayName: 'Wavoip Token',
        name: 'wavoipToken',
        type: 'string',
        typeOptions: { password: true },
        default: '',
        description:
          'Unsupported during creation on Evolution API 2.3.7 and 2.4.0-rc2: the WhatsApp socket does not exist yet. Leave empty, then use Settings > Set after connecting a WhatsApp Baileys instance.',
      },
    ],
  },
  {
    displayName: 'Webhook',
    name: 'webhookConfig',
    type: 'collection',
    placeholder: 'Add Webhook Option',
    default: {},
    description: 'Configure the instance webhook at creation time. "URL" is required.',
    options: [
      {
        displayName: 'Events',
        name: 'events',
        type: 'multiOptions',
        options: WEBHOOK_EVENT_OPTIONS,
        default: [],
        description: `Events to send. Leave empty to receive all events. "Messaging History Set": ${REQUIRES_24}`,
      },
      {
        displayName: 'Headers (JSON)',
        name: 'headers',
        type: 'json',
        default: '{}',
        description:
          'Extra headers sent with every webhook, e.g. {"authorization": "Bearer …"}. A "jwt_key" entry is not sent as-is: Evolution uses it to sign a short-lived JWT (HS256) and sends it as "Authorization: Bearer …".',
      },
      {
        displayName: 'URL',
        name: 'url',
        type: 'string',
        default: '',
        placeholder: 'https://n8n.example.com/webhook/evolution',
        description: 'URL that receives the events',
      },
      {
        displayName: 'Webhook Base64',
        name: 'base64',
        type: 'boolean',
        default: false,
        description: 'Whether to include received media as base64 in the payload',
      },
      {
        displayName: 'Webhook by Events',
        name: 'byEvents',
        type: 'boolean',
        default: false,
        description: 'Whether to append the event name to the URL (e.g. …/messages-upsert)',
      },
    ],
  },
  {
    displayName: 'Proxy',
    name: 'proxyConfig',
    type: 'collection',
    placeholder: 'Add Proxy Option',
    default: {},
    description:
      'Route the WhatsApp connection through a proxy. "Host" and "Port" are required; Evolution tests the proxy and answers "Invalid proxy" when it does not work.',
    options: [
      {
        displayName: 'Host',
        name: 'host',
        type: 'string',
        default: '',
        placeholder: 'proxy.example.com',
      },
      {
        displayName: 'Password',
        name: 'password',
        type: 'string',
        typeOptions: { password: true },
        default: '',
      },
      {
        displayName: 'Port',
        name: 'port',
        type: 'string',
        default: '',
        placeholder: '8080',
      },
      {
        displayName: 'Protocol',
        name: 'protocol',
        type: 'options',
        options: [
          { name: 'HTTP', value: 'http' },
          { name: 'SOCKS', value: 'socks' },
          { name: 'SOCKS5', value: 'socks5' },
        ],
        default: 'http',
      },
      {
        displayName: 'Username',
        name: 'username',
        type: 'string',
        default: '',
      },
    ],
  },
  {
    displayName: 'Chatwoot',
    name: 'chatwootConfig',
    type: 'collection',
    placeholder: 'Add Chatwoot Option',
    default: {},
    description:
      'Connect the instance to Chatwoot at creation time (requires CHATWOOT_ENABLED=true on the server). "Account ID", "API Access Token" and "URL" are required.',
    options: [
      {
        displayName: 'Account ID',
        name: 'accountId',
        type: 'string',
        default: '',
        placeholder: '1',
      },
      {
        displayName: 'API Access Token',
        name: 'token',
        type: 'string',
        typeOptions: { password: true },
        default: '',
        description: 'Access token of a Chatwoot user (Profile Settings > Access Token)',
      },
      {
        displayName: 'Auto Create Inbox',
        name: 'autoCreate',
        type: 'boolean',
        default: true,
        description: 'Whether Evolution creates the API inbox in Chatwoot automatically',
      },
      {
        displayName: 'Conversation Pending',
        name: 'conversationPending',
        type: 'boolean',
        default: false,
        description: 'Whether new conversations start as pending',
      },
      {
        displayName: 'Days Limit Import Messages',
        name: 'daysLimitImportMessages',
        type: 'number',
        typeOptions: { minValue: 0 },
        default: 60,
        description: 'How many days of history to import',
      },
      {
        displayName: 'Import Contacts',
        name: 'importContacts',
        type: 'boolean',
        default: true,
        description: 'Whether to import WhatsApp contacts into Chatwoot',
      },
      {
        displayName: 'Import Messages',
        name: 'importMessages',
        type: 'boolean',
        default: true,
        description: 'Whether to import message history into Chatwoot',
      },
      {
        displayName: 'Inbox Name',
        name: 'nameInbox',
        type: 'string',
        default: '',
        description: 'Name of the Chatwoot inbox. Defaults to the instance name.',
      },
      {
        displayName: 'Logo URL',
        name: 'logo',
        type: 'string',
        default: '',
        description: 'Avatar URL of the bot contact created in Chatwoot',
      },
      {
        displayName: 'Merge Brazil Contacts',
        name: 'mergeBrazilContacts',
        type: 'boolean',
        default: false,
        description: 'Whether to merge Brazilian contacts with and without the 9th digit',
      },
      {
        displayName: 'Organization',
        name: 'organization',
        type: 'string',
        default: '',
        description: 'Name of the bot contact created in Chatwoot',
      },
      {
        displayName: 'Reopen Conversation',
        name: 'reopenConversation',
        type: 'boolean',
        default: false,
        description:
          'Whether to reopen the last resolved conversation instead of creating a new one',
      },
      {
        displayName: 'Sign Messages',
        name: 'signMsg',
        type: 'boolean',
        default: false,
        description: 'Whether to prefix agent messages with the agent name',
      },
      {
        displayName: 'URL',
        name: 'url',
        type: 'string',
        default: '',
        placeholder: 'https://chatwoot.example.com',
        description: 'Base URL of the Chatwoot server',
      },
    ],
  },
  {
    displayName: 'Options',
    name: 'options',
    type: 'collection',
    placeholder: 'Add Option',
    default: {},
    options: [
      ...qrCodeBinaryOptions,
      {
        displayName: 'Include Secrets',
        name: 'includeSecrets',
        type: 'boolean' as const,
        default: false,
        description:
          'Whether to return the instance token (hash), Cloud API verify token, Chatwoot and Wavoip tokens, and secret webhook headers. Enable only when needed to retrieve generated credentials; these values are stored in execution logs.',
      },
    ].sort((a, b) => a.displayName.localeCompare(b.displayName)),
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['instance'], operation: ['create'] } },
  properties,
);

const SETTINGS_KEYS = [
  'rejectCall',
  'msgCall',
  'groupsIgnore',
  'alwaysOnline',
  'readMessages',
  'readStatus',
  'syncFullHistory',
];

/** Build the body of POST /instance/create (InstanceDto + instanceSchema, 2.3.7 and 2.4). */
export function buildCreateBody(this: IExecuteFunctions, itemIndex: number): IDataObject {
  const node = this.getNode();
  const instanceName = String(this.getNodeParameter('newInstanceName', itemIndex, '')).trim();
  if (!instanceName) {
    throw new NodeOperationError(node, 'New Instance Name is required', { itemIndex });
  }

  const integration = this.getNodeParameter('integration', itemIndex, 'WHATSAPP-BAILEYS') as string;
  const body: IDataObject = { instanceName, integration };

  if (integration === 'WHATSAPP-BUSINESS') {
    // channel.controller.ts: token is mandatory for WHATSAPP-BUSINESS, number = phone number ID.
    const token = String(this.getNodeParameter('businessToken', itemIndex, '')).trim();
    const phoneNumberId = normalizeNumber(this.getNodeParameter('phoneNumberId', itemIndex, ''));
    if (!token || !phoneNumberId) {
      throw new NodeOperationError(
        node,
        'Access Token and Phone Number ID are required for WhatsApp Cloud API instances',
        { itemIndex },
      );
    }
    body.token = token;
    body.number = phoneNumberId;
    const businessId = String(this.getNodeParameter('businessId', itemIndex, '')).trim();
    if (businessId) body.businessId = businessId;
  } else {
    const additionalFields = this.getNodeParameter(
      'additionalFields',
      itemIndex,
      {},
    ) as IDataObject;
    const token = String(additionalFields.token ?? '').trim();
    if (token) body.token = token;
    const number = normalizeNumber(additionalFields.number);
    if (number) body.number = number;
    if (integration === 'WHATSAPP-BAILEYS') {
      body.qrcode = this.getNodeParameter('qrcode', itemIndex, true) as boolean;
    }
  }

  // Settings: flat keys; anything not sent is stored as false/''.
  const settings = this.getNodeParameter('instanceSettings', itemIndex, {}) as IDataObject;
  if (String(settings.wavoipToken ?? '').trim()) {
    throw new NodeOperationError(node, 'Wavoip Token cannot be set during instance creation', {
      itemIndex,
      description:
        'Evolution API 2.3.7 and 2.4.0-rc2 access a WhatsApp socket before it exists and roll back creation. Leave Wavoip Token empty, connect the WhatsApp Baileys instance, then use Settings > Set.',
    });
  }
  for (const key of SETTINGS_KEYS) {
    if (settings[key] !== undefined && settings[key] !== '') body[key] = settings[key];
  }

  // Webhook: nested object (eventManager.setInstance). `events` must always be an array, the
  // webhook controller reads events.length and crashes when it is missing.
  const webhook = this.getNodeParameter('webhookConfig', itemIndex, {}) as IDataObject;
  if (Object.keys(webhook).length > 0) {
    const url = String(webhook.url ?? '').trim();
    if (!url) {
      throw new NodeOperationError(node, 'Webhook URL is required when configuring a webhook', {
        itemIndex,
      });
    }
    const webhookBody: IDataObject = {
      enabled: true,
      url,
      events: (webhook.events as string[] | undefined) ?? [],
      byEvents: webhook.byEvents === true,
      base64: webhook.base64 === true,
    };
    const headers = parseJsonParameter(webhook.headers, 'Webhook > Headers (JSON)');
    if (headers !== undefined && !isPlainObject(headers)) {
      throw new NodeOperationError(node, 'Webhook headers must be a JSON object', { itemIndex });
    }
    if (isPlainObject(headers) && Object.keys(headers).length > 0) webhookBody.headers = headers;
    body.webhook = webhookBody;
  }

  // Proxy: only applied by Evolution when host, port and protocol are all present.
  const proxy = this.getNodeParameter('proxyConfig', itemIndex, {}) as IDataObject;
  if (Object.keys(proxy).length > 0) {
    const host = String(proxy.host ?? '').trim();
    const port = String(proxy.port ?? '').trim();
    if (!host || !port) {
      throw new NodeOperationError(
        node,
        'Proxy Host and Port are required when configuring a proxy',
        {
          itemIndex,
        },
      );
    }
    body.proxyHost = host;
    body.proxyPort = port;
    body.proxyProtocol = String(proxy.protocol || 'http');
    if (proxy.username) body.proxyUsername = String(proxy.username);
    if (proxy.password) body.proxyPassword = String(proxy.password);
  }

  // Chatwoot: flat chatwoot* keys; signMsg/reopenConversation/conversationPending must be booleans.
  const chatwoot = this.getNodeParameter('chatwootConfig', itemIndex, {}) as IDataObject;
  if (Object.keys(chatwoot).length > 0) {
    const accountId = String(chatwoot.accountId ?? '').trim();
    const token = String(chatwoot.token ?? '').trim();
    const url = String(chatwoot.url ?? '').trim();
    if (!accountId || !token || !url) {
      throw new NodeOperationError(
        node,
        'Chatwoot Account ID, API Access Token and URL are required when configuring Chatwoot',
        { itemIndex },
      );
    }
    body.chatwootAccountId = accountId;
    body.chatwootToken = token;
    body.chatwootUrl = url.replace(/\/+$/, '');
    body.chatwootSignMsg = chatwoot.signMsg === true;
    body.chatwootReopenConversation = chatwoot.reopenConversation === true;
    body.chatwootConversationPending = chatwoot.conversationPending === true;
    if (chatwoot.importContacts !== undefined)
      body.chatwootImportContacts = chatwoot.importContacts;
    if (chatwoot.importMessages !== undefined)
      body.chatwootImportMessages = chatwoot.importMessages;
    if (chatwoot.daysLimitImportMessages !== undefined) {
      body.chatwootDaysLimitImportMessages = Number(chatwoot.daysLimitImportMessages);
    }
    if (chatwoot.mergeBrazilContacts !== undefined) {
      body.chatwootMergeBrazilContacts = chatwoot.mergeBrazilContacts;
    }
    if (chatwoot.autoCreate !== undefined) body.chatwootAutoCreate = chatwoot.autoCreate;
    if (chatwoot.nameInbox) body.chatwootNameInbox = String(chatwoot.nameInbox);
    if (chatwoot.organization) body.chatwootOrganization = String(chatwoot.organization);
    if (chatwoot.logo) body.chatwootLogo = String(chatwoot.logo);
  }

  return body;
}

/**
 * POST /instance/create (global API key required).
 * Returns { instance, hash (instance token), webhook, websocket, rabbitmq, nats, sqs, settings,
 * qrcode?, chatwoot? }. Evolution 2.4 trims the name and auto-connects EVOLUTION instances.
 */
export async function execute(
  this: IExecuteFunctions,
  itemIndex: number,
): Promise<IDataObject | INodeExecutionData[]> {
  const body = buildCreateBody.call(this, itemIndex);
  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

  const response = (await evolutionApiRequest.call(
    this,
    'POST',
    '/instance/create',
    body,
    {},
    {
      itemIndex,
    },
  )) as IDataObject;

  const output = options.includeSecrets === true ? response : redactCreatedInstanceSecrets(response);
  return await withQrCodeBinary.call(this, output, options);
}
