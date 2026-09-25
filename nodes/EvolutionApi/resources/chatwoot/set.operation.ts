import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, normalizeNumber, resolveInstanceName } from '../../GenericFunctions';
import { includeSecretsOption, parseJidList, redactChatwootSecrets } from './helpers';

const properties: INodeProperties[] = [
  {
    displayName: 'Fields to Set',
    name: 'updateFields',
    type: 'collection',
    placeholder: 'Add Field',
    default: {},
    description:
      'Only the fields added here change; every other field keeps its current value (the node reads the current configuration first). For a new integration add at least Account ID, API Access Token and URL.',
    options: [
      {
        displayName: 'Account ID',
        name: 'accountId',
        type: 'string',
        default: '',
        placeholder: '1',
        description: 'ID of the Chatwoot account (the number in /app/accounts/<ID>/…)',
      },
      {
        displayName: 'API Access Token',
        name: 'token',
        type: 'string',
        typeOptions: { password: true },
        default: '',
        description:
          'Access token of a Chatwoot user (Profile Settings > Access Token) with access to the inbox',
      },
      {
        displayName: 'Auto Create Inbox',
        name: 'autoCreate',
        type: 'boolean',
        default: true,
        description:
          'Whether Evolution creates the API inbox (named after "Inbox Name"), the bot contact and the webhook in Chatwoot now, reusing an inbox with the same name. It is not stored: add it only when setting up the integration. The webhook points to webhook_url (in the output), which Evolution does not authenticate: restrict it to Chatwoot at the reverse proxy.',
      },
      {
        displayName: 'Conversation Pending',
        name: 'conversationPending',
        type: 'boolean',
        default: false,
        description: 'Whether new conversations start with status pending instead of open',
      },
      {
        displayName: 'Days Limit Import Messages',
        name: 'daysLimitImportMessages',
        type: 'number',
        typeOptions: { minValue: 0 },
        default: 60,
        description: 'How many days of message history "Import Messages" copies to Chatwoot',
      },
      {
        displayName: 'Enabled',
        name: 'enabled',
        type: 'boolean',
        default: true,
        description:
          'Whether messages flow between WhatsApp and Chatwoot. When not added, the current state is kept (a new integration starts enabled).',
      },
      {
        displayName: 'Ignore JIDs',
        name: 'ignoreJids',
        type: 'string',
        default: '',
        placeholder: '@g.us, 5215512345678@s.whatsapp.net',
        description:
          'Chats not forwarded to Chatwoot, comma or newline separated: "@g.us" for every group, "@s.whatsapp.net" for every 1:1 chat, or the exact JID of a chat as in data.key.remoteJid (Evolution compares it as-is; a phone number is turned into …@s.whatsapp.net as typed, without WhatsApp number rules). Replaces the whole current list; add it empty to clear the list.',
      },
      {
        displayName: 'Import Contacts',
        name: 'importContacts',
        type: 'boolean',
        default: true,
        description:
          'Whether to import the WhatsApp contacts into Chatwoot when the session connects',
      },
      {
        displayName: 'Import Messages',
        name: 'importMessages',
        type: 'boolean',
        default: true,
        description:
          'Whether to import the message history into Chatwoot when the session connects (requires the Chatwoot database connection on the Evolution server)',
      },
      {
        displayName: 'Inbox Name',
        name: 'nameInbox',
        type: 'string',
        default: '',
        description:
          'Name of the Chatwoot inbox used by this instance. Evolution uses the instance name when it is empty.',
      },
      {
        displayName: 'Logo URL',
        name: 'logo',
        type: 'string',
        default: '',
        description: 'Avatar URL of the bot contact that "Auto Create Inbox" creates',
      },
      {
        displayName: 'Merge Brazil Contacts',
        name: 'mergeBrazilContacts',
        type: 'boolean',
        default: false,
        description: 'Whether to merge Brazilian contacts saved with and without the 9th digit',
      },
      {
        displayName: 'Number',
        name: 'number',
        type: 'string',
        default: '',
        placeholder: '5215512345678',
        description:
          'Phone number of the instance with country code. "Auto Create Inbox" sends "init:<number>" to the bot contact so Chatwoot shows the QR or pairing code. Not returned by Get.',
      },
      {
        displayName: 'Organization',
        name: 'organization',
        type: 'string',
        default: '',
        description: 'Name of the bot contact that "Auto Create Inbox" creates',
      },
      {
        displayName: 'Reopen Conversation',
        name: 'reopenConversation',
        type: 'boolean',
        default: false,
        description:
          "Whether a new message reopens the contact's last resolved conversation instead of creating a new one. On Evolution API 2.3.x, @lid contacts can still reopen a conversation resolved less than about 30 minutes earlier when this is off.",
      },
      {
        displayName: 'Sign Delimiter',
        name: 'signDelimiter',
        type: 'string',
        default: '',
        placeholder: '\\n',
        description:
          'Text between the agent signature and the message when "Sign Messages" is on ("\\n" = line break). Add it empty to go back to the default line break.',
      },
      {
        displayName: 'Sign Messages',
        name: 'signMsg',
        type: 'boolean',
        default: false,
        description: 'Whether to prefix WhatsApp messages sent from Chatwoot with the agent name',
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
    options: [includeSecretsOption],
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['chatwoot'], operation: ['set'] } },
  properties,
);

const REQUIRED_BOOLEAN_KEYS = ['signMsg', 'reopenConversation', 'conversationPending'];
const OPTIONAL_BOOLEAN_KEYS = ['importContacts', 'importMessages', 'mergeBrazilContacts'];
const OPTIONAL_STRING_KEYS = ['nameInbox', 'organization', 'logo'];

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Merge GET /chatwoot/find (current) with the fields the user added (changes) into a full
 * ChatwootDto. Everything the user did not add is resent with its current value, because
 * chatwootSchema requires enabled, accountId, token, url, signMsg, reopenConversation and
 * conversationPending, the controller replaces an empty nameInbox with the instance name, and
 * the in-memory configuration takes every key of the body (EVONODE-4 / EVOCW-11: the community
 * node forced enabled=true, signDelimiter "\n" and ignoreJids [""]).
 * `number` (not returned by find) and `autoCreate` (not stored) are only sent when added.
 */
export function buildChatwootBody(current: IDataObject, changes: IDataObject): IDataObject {
  // A new integration (nothing stored yet) starts enabled unless "Enabled" is added as false.
  const configured = Boolean(text(current.url) || text(current.accountId) || text(current.token));
  const enabled =
    changes.enabled !== undefined ? changes.enabled : configured ? current.enabled : true;

  const body: IDataObject = {
    enabled: enabled === true,
    accountId:
      changes.accountId !== undefined ? text(String(changes.accountId)) : text(current.accountId),
    token: changes.token !== undefined ? text(changes.token) : text(current.token),
    url: (changes.url !== undefined ? text(changes.url) : text(current.url)).replace(/\/+$/, ''),
  };

  for (const key of REQUIRED_BOOLEAN_KEYS) {
    body[key] = (changes[key] !== undefined ? changes[key] : current[key]) === true;
  }
  for (const key of OPTIONAL_BOOLEAN_KEYS) {
    const value = changes[key] !== undefined ? changes[key] : current[key];
    if (typeof value === 'boolean') body[key] = value;
  }
  for (const key of OPTIONAL_STRING_KEYS) {
    const value = changes[key] !== undefined ? changes[key] : current[key];
    if (typeof value === 'string') body[key] = value.trim();
  }

  const days = changes.daysLimitImportMessages ?? current.daysLimitImportMessages;
  if (days !== undefined && days !== null && days !== '') {
    body.daysLimitImportMessages = Number(days);
  }

  // Evolution stores null (= line break) when signMsg is off. An empty delimiter added by the
  // user resets it to that default; otherwise only a real stored delimiter is resent.
  if (changes.signDelimiter !== undefined) {
    body.signDelimiter = changes.signDelimiter === '' ? null : String(changes.signDelimiter);
  } else if (typeof current.signDelimiter === 'string' && current.signDelimiter !== '') {
    body.signDelimiter = current.signDelimiter;
  }

  if (changes.ignoreJids !== undefined) {
    body.ignoreJids = parseJidList(changes.ignoreJids);
  } else if (Array.isArray(current.ignoreJids)) {
    body.ignoreJids = current.ignoreJids.map((jid) => String(jid));
  }

  const number = normalizeNumber(changes.number);
  if (number) body.number = number;
  if (changes.autoCreate !== undefined) body.autoCreate = changes.autoCreate === true;

  return body;
}

/**
 * GET /chatwoot/find/:instanceName, merge, then POST /chatwoot/set/:instanceName (chatwootSchema,
 * identical in 2.3.7 and 2.4). Answers 201 with the data as saved plus
 * webhook_url = <SERVER_URL>/chatwoot/webhook/<instance>, the URL Chatwoot must call.
 * 400 "Chatwoot is disabled" when CHATWOOT_ENABLED=false on the server.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const node = this.getNode();
  const instance = await resolveInstanceName.call(this, itemIndex);
  const changes = this.getNodeParameter('updateFields', itemIndex, {}) as IDataObject;
  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

  if (Object.keys(changes).length === 0) {
    throw new NodeOperationError(node, 'Add at least one field to set', {
      itemIndex,
      description: 'Use "Fields to Set" to pick what to change in the Chatwoot integration.',
    });
  }

  const current = (await evolutionApiRequest.call(
    this,
    'GET',
    `/chatwoot/find/${instance}`,
    {},
    {},
    { itemIndex },
  )) as IDataObject;

  const body = buildChatwootBody(current, changes);
  if (body.enabled === true) {
    const missing = [
      ['Account ID', body.accountId],
      ['API Access Token', body.token],
      ['URL', body.url],
    ]
      .filter(([, value]) => !value)
      .map(([label]) => label);
    if (missing.length > 0) {
      throw new NodeOperationError(node, `Missing Chatwoot fields: ${missing.join(', ')}`, {
        itemIndex,
        description: 'An enabled integration needs Account ID, API Access Token and URL.',
      });
    }
    if (!/^https?:\/\//i.test(String(body.url))) {
      throw new NodeOperationError(node, `Invalid Chatwoot URL "${String(body.url)}"`, {
        itemIndex,
        description: 'Use the full base URL, e.g. https://chatwoot.example.com',
      });
    }
  }

  const response = (await evolutionApiRequest.call(
    this,
    'POST',
    `/chatwoot/set/${instance}`,
    body,
    {},
    { itemIndex },
  )) as IDataObject;

  return options.includeSecrets === true ? response : redactChatwootSecrets(response);
}
