import type {
  IDataObject,
  IDisplayOptions,
  IExecuteFunctions,
  INode,
  INodeProperties,
  INodePropertyOptions,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { REQUIRES_24 } from '../../constants';
import type { IResolvedMedia, MediaInputType } from '../../GenericFunctions';
import {
  compactObject,
  evolutionApiRequest,
  extractEvolutionMessages,
  isPlainObject,
  normalizeNumber,
  normalizeNumberList,
  parseJsonParameter,
  resolveInstanceName,
  resolveMedia,
} from '../../GenericFunctions';

/**
 * Shared building blocks of the message resource (src/api/routes/sendMessage.router.ts).
 *
 * Every send route answers 201 with the sent message:
 * { key: { remoteJid, fromMe: true, id }, message, messageType, messageTimestamp, status, … }.
 * The Cloud API channel answers 201 with Meta's error object when Meta rejects the message;
 * postMessage() turns that into an error.
 */

// ============================================================================
// Fields
// ============================================================================

/** Recipient field (shared name `number`). */
export const numberProperty: INodeProperties = {
  displayName: 'Number',
  name: 'number',
  type: 'string',
  required: true,
  default: '',
  placeholder: '5215512345678',
  description:
    'Recipient: phone number with country code (digits only or formatted, e.g. +52 1 55 1234 5678), or a full JID: …@s.whatsapp.net (contact), …@g.us (group), …@lid (hidden-number contact) or …@newsletter (channel, needs Evolution API 2.4+)',
};

/** "Input data" selector of the media routes. */
export const MEDIA_SOURCE_OPTIONS: INodePropertyOptions[] = [
  {
    name: 'Base64',
    value: 'base64',
    description: 'Base64 string (a data: URI prefix is removed automatically)',
  },
  {
    name: 'Binary File',
    value: 'binary',
    description: 'File from a binary property of the input item (e.g. a downloaded attachment)',
  },
  {
    name: 'URL',
    value: 'url',
    description: 'Public http(s) URL that the Evolution server downloads',
  },
];

/**
 * Media input fields (mediaSource / mediaUrl / mediaBase64 / binaryPropertyName). `show` adds
 * display conditions (e.g. a status type); resource/operation come from updateDisplayOptions.
 */
export function mediaSourceProperties(
  noun: string,
  show: NonNullable<IDisplayOptions['show']> = {},
  defaultSource: MediaInputType = 'url',
): INodeProperties[] {
  const withSource = (source: MediaInputType) => ({ show: { ...show, mediaSource: [source] } });
  return [
    {
      displayName: 'Input Data',
      name: 'mediaSource',
      type: 'options',
      options: MEDIA_SOURCE_OPTIONS,
      default: defaultSource,
      description: `Where the ${noun} comes from`,
      ...(Object.keys(show).length > 0 ? { displayOptions: { show } } : {}),
    },
    {
      displayName: 'URL',
      name: 'mediaUrl',
      type: 'string',
      required: true,
      default: '',
      placeholder: 'https://example.com/file.jpg',
      description: `Public http(s) URL of the ${noun}. The Evolution server downloads it.`,
      displayOptions: withSource('url'),
    },
    {
      displayName: 'Base64',
      name: 'mediaBase64',
      type: 'string',
      required: true,
      default: '',
      typeOptions: { rows: 2 },
      description: `Base64 content of the ${noun}. A data: URI prefix is removed automatically.`,
      displayOptions: withSource('base64'),
    },
    {
      displayName: 'Input Binary Field',
      name: 'binaryPropertyName',
      type: 'string',
      required: true,
      default: 'data',
      hint: 'The name of the input binary field containing the file to be sent',
      description: `Name of the binary property of the input item that holds the ${noun}`,
      displayOptions: withSource('binary'),
    },
  ];
}

/** Read the media fields of mediaSourceProperties() and resolve them (URL, base64 or binary). */
export async function resolveMediaInput(
  this: IExecuteFunctions,
  itemIndex: number,
  overrides: { fileName?: string; mimeType?: string } = {},
): Promise<IResolvedMedia> {
  const type = this.getNodeParameter('mediaSource', itemIndex, 'url') as MediaInputType;
  return await resolveMedia.call(this, itemIndex, {
    type,
    url: type === 'url' ? String(this.getNodeParameter('mediaUrl', itemIndex, '')) : undefined,
    base64:
      type === 'base64' ? String(this.getNodeParameter('mediaBase64', itemIndex, '')) : undefined,
    binaryPropertyName:
      type === 'binary'
        ? String(this.getNodeParameter('binaryPropertyName', itemIndex, 'data'))
        : undefined,
    fileName: overrides.fileName || undefined,
    mimeType: overrides.mimeType || undefined,
  });
}

/** Choice between UI fields and raw JSON for sections, buttons and cards. */
export const interactiveInputModeProperty: INodeProperties = {
  displayName: 'Define Using',
  name: 'interactiveInputMode',
  type: 'options',
  noDataExpression: true,
  options: [
    {
      name: 'Fields Below',
      value: 'fields',
    },
    {
      name: 'JSON',
      value: 'json',
      description: 'Pass the whole structure as JSON (handy for expressions and AI agents)',
    },
  ],
  default: 'fields',
};

// ============================================================================
// Options shared by the send operations
// ============================================================================

export function delayOption(presence = 'typing…'): INodeProperties {
  return {
    displayName: 'Delay (Ms)',
    name: 'delay',
    type: 'number',
    typeOptions: { minValue: 0 },
    default: 0,
    description: `Milliseconds to show "${presence}" to the recipient before sending. The request waits that long before it returns.`,
  };
}

export const linkPreviewOption: INodeProperties = {
  displayName: 'Link Preview',
  name: 'linkPreview',
  type: 'boolean',
  default: true,
  description:
    'Whether to show a preview of the first link in the text. On Evolution API 2.4+ the server downloads the page to build the preview unless this is off; turn it off for bulk sends.',
};

export const mentionOptions: INodeProperties[] = [
  {
    displayName: 'Mention Everyone',
    name: 'mentionsEveryOne',
    type: 'boolean',
    default: false,
    description: 'Whether to mention every participant (groups only)',
  },
  {
    displayName: 'Mentions',
    name: 'mentioned',
    type: 'string',
    default: '',
    placeholder: '5215512345678, 5511999999999',
    description:
      'Groups only: numbers or JIDs to mention, separated by commas (a leading "@" is ignored). Write "@" followed by the number in the text so the mention is highlighted.',
  },
];

export const messageIdOption: INodeProperties = {
  displayName: 'Custom Message ID',
  name: 'messageId',
  type: 'string',
  default: '',
  description: `WhatsApp ID to give the sent message, for idempotent retries or to correlate it with another system. It must be a valid WhatsApp message ID: get one with the Message > Generate Message ID operation. ${REQUIRES_24}`,
};

/** "Reply to" options (quoted message). `note` is appended to both descriptions. */
export function quotedOptions(note = ''): INodeProperties[] {
  const suffix = note ? ` ${note}` : '';
  return [
    {
      displayName: 'Reply To Message (JSON)',
      name: 'quotedMessage',
      type: 'json',
      default: '',
      description: `Full message to reply to, e.g. the "data" of a MESSAGES_UPSERT webhook: { "key": { "id", "remoteJid", "fromMe", "participant" }, "message": { … } }. Use it when the message may not be stored in Evolution's database. Takes precedence over Reply To Message ID.${suffix}`,
    },
    {
      displayName: 'Reply To Message ID',
      name: 'quotedMessageId',
      type: 'string',
      default: '',
      description: `ID (key.id) of the message to reply to. Evolution loads the original from its database; if it is not stored there, the message is sent without the quote.${suffix}`,
    },
  ];
}

/** Sort collection options by display name (n8n convention). */
export function sortOptions(options: INodeProperties[]): INodeProperties[] {
  return [...options].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** `options` collection of a send operation. */
export function sendOptionsProperty(options: INodeProperties[]): INodeProperties {
  return {
    displayName: 'Options',
    name: 'options',
    type: 'collection',
    placeholder: 'Add Option',
    default: {},
    options: sortOptions(options),
  };
}

// ============================================================================
// Execute helpers
// ============================================================================

export function operationError(
  node: INode,
  itemIndex: number,
  message: string,
  description?: string,
): NodeOperationError {
  return new NodeOperationError(node, message, { itemIndex, description });
}

/** Trimmed string parameter ('' when missing). */
export function getString(this: IExecuteFunctions, name: string, itemIndex: number): string {
  const value = this.getNodeParameter(name, itemIndex, '');
  return value === undefined || value === null ? '' : String(value).trim();
}

/** Normalized recipient (number or JID) or a clear error. */
export function getRecipient(this: IExecuteFunctions, itemIndex: number): string {
  const number = normalizeNumber(this.getNodeParameter('number', itemIndex, ''));
  if (!number) throw operationError(this.getNode(), itemIndex, 'Number is required');
  return number;
}

/**
 * `quoted` from the "Reply to" options: the full message (JSON, or the whole webhook body) or
 * only its ID. Evolution requires a non-empty `key.id` and a boolean `key.fromMe`.
 */
export function buildQuoted(
  node: INode,
  itemIndex: number,
  options: IDataObject,
): IDataObject | undefined {
  let parsed: unknown;
  try {
    parsed = parseJsonParameter(options.quotedMessage, 'Reply To Message (JSON)');
  } catch (error) {
    throw operationError(node, itemIndex, (error as Error).message);
  }

  if (parsed !== undefined && parsed !== null && parsed !== '') {
    // Accept the whole webhook body ({ event, data: { key, message } }) too.
    const source = isPlainObject(parsed) && isPlainObject(parsed.data) ? parsed.data : parsed;
    const key = isPlainObject(source) && isPlainObject(source.key) ? source.key : undefined;
    if (!key || !String(key.id ?? '').trim()) {
      throw operationError(
        node,
        itemIndex,
        'Reply To Message (JSON) must be a message object with "key.id"',
        'Example: { "key": { "id": "3EB0…", "remoteJid": "5215512345678@s.whatsapp.net", "fromMe": false }, "message": { "conversation": "Hi" } }',
      );
    }
    const quotedKey: IDataObject = compactObject({ ...key });
    if (typeof quotedKey.fromMe === 'string') quotedKey.fromMe = quotedKey.fromMe === 'true';
    const quoted: IDataObject = { key: quotedKey };
    if (isPlainObject((source as IDataObject).message)) {
      quoted.message = (source as IDataObject).message;
    }
    return quoted;
  }

  const id = String(options.quotedMessageId ?? '').trim();
  return id ? { key: { id } } : undefined;
}

/**
 * Mention list (comma/semicolon/newline separated, or an array). A leading "@" is dropped:
 * people write mentions as they appear in the text ("@5215512345678"), but every schema
 * requires `mentioned` items to start with digits (400 '"mentioned" must be an array of
 * numeric strings').
 */
export function normalizeMentions(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : String(value ?? '').split(/[,\n;]/);
  return normalizeNumberList(
    entries.map((entry) =>
      String(entry ?? '')
        .trim()
        .replace(/^@+/, ''),
    ),
  );
}

/**
 * Copy the common send options (only those present in `options`) into the body:
 * delay (integer), linkPreview, quoted, mentionsEveryOne, mentioned[] and messageId.
 */
export function applySendOptions(
  node: INode,
  itemIndex: number,
  options: IDataObject,
  body: IDataObject,
): IDataObject {
  const delay = Number(options.delay);
  if (options.delay !== undefined && options.delay !== '' && Number.isFinite(delay) && delay > 0) {
    body.delay = Math.round(delay);
  }
  if (options.linkPreview !== undefined) body.linkPreview = options.linkPreview === true;

  const quoted = buildQuoted(node, itemIndex, options);
  if (quoted) body.quoted = quoted;

  if (options.mentionsEveryOne === true) body.mentionsEveryOne = true;
  const mentioned = normalizeMentions(options.mentioned);
  if (mentioned.length > 0) body.mentioned = mentioned;

  const messageId = String(options.messageId ?? '').trim();
  if (messageId) body.messageId = messageId;
  return body;
}

/**
 * The Cloud API channel (WHATSAPP-BUSINESS) catches Meta's error and answers 201 with it:
 * { message, type, code, error_data: { details }, fbtrace_id }. Sent messages always have `key`.
 */
export function assertMessageAccepted(node: INode, response: unknown, itemIndex: number): void {
  if (!isPlainObject(response) || response.key !== undefined) return;
  const isMetaError =
    response.error_data !== undefined ||
    response.fbtrace_id !== undefined ||
    (typeof response.code === 'number' && typeof response.type === 'string');
  if (!isMetaError) return;
  const messages = extractEvolutionMessages(response);
  const errorData = response.error_data;
  if (isPlainObject(errorData) && typeof errorData.details === 'string') {
    const details = errorData.details.trim();
    if (details && !messages.includes(details)) messages.push(details);
  }
  const detail = messages.join('; ') || 'unknown error';
  throw operationError(
    node,
    itemIndex,
    `WhatsApp Cloud API rejected the message: ${detail}`,
    `Evolution API answered with Meta's error${
      response.code !== undefined ? ` (code ${String(response.code)})` : ''
    } instead of the sent message.`,
  );
}

/** POST /message/<route>/:instanceName and return the sent message. */
export async function postMessage(
  this: IExecuteFunctions,
  itemIndex: number,
  route: string,
  body: IDataObject | FormData,
): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const response = await evolutionApiRequest.call(
    this,
    'POST',
    `/message/${route}/${instance}`,
    body,
    {},
    { itemIndex },
  );
  assertMessageAccepted(this.getNode(), response, itemIndex);
  return response as IDataObject;
}

/**
 * Parse a JSON parameter that must hold an array, also accepting { <wrapperKey>: [...] } (and
 * the listed aliases) so a payload copied from the API documentation works as-is.
 */
export function parseJsonArray(
  node: INode,
  itemIndex: number,
  value: unknown,
  label: string,
  wrapperKeys: string[],
): IDataObject[] {
  // Treat an unset JSON field like an empty collection so operation-specific minimum counts
  // produce the same useful error in either input mode.
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = parseJsonParameter(value, label);
  } catch (error) {
    throw operationError(node, itemIndex, (error as Error).message);
  }
  if (isPlainObject(parsed)) {
    const wrapper = parsed;
    const key = wrapperKeys.find((candidate) => Array.isArray(wrapper[candidate]));
    if (key) parsed = wrapper[key];
  }
  if (!Array.isArray(parsed)) {
    throw operationError(node, itemIndex, `${label} must be a JSON array`);
  }
  return parsed.map((entry) => (isPlainObject(entry) ? entry : {}));
}

/** Entries of a fixedCollection with multipleValues ({ [group]: [...] }). */
export function getCollectionEntries(value: unknown, group: string): IDataObject[] {
  if (!isPlainObject(value)) return [];
  const entries = value[group];
  if (Array.isArray(entries)) return entries.filter(isPlainObject);
  return isPlainObject(entries) ? [entries] : [];
}

/** Trimmed string of an object property ('' when missing). */
export function str(source: IDataObject, key: string): string {
  const value = source[key];
  return value === undefined || value === null ? '' : String(value).trim();
}

/**
 * Split a multi-line list (one entry per line) or accept an array (e.g. from an expression).
 * Commas are kept: poll options often contain them.
 */
export function splitLines(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : String(value ?? '').split(/\r?\n/);
  return entries.map((entry) => String(entry ?? '').trim()).filter((entry) => entry !== '');
}

// ============================================================================
// Files
// ============================================================================

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'application/json': 'json',
  'application/msword': 'doc',
  'application/pdf': 'pdf',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/zip': 'zip',
  'audio/aac': 'aac',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'text/csv': 'csv',
  'text/plain': 'txt',
  'video/3gpp': '3gp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

/**
 * Evolution derives the MIME type from the file name extension (mime-types lookup) and sends
 * the string "false" when there is none, so add one from the known MIME type when missing.
 */
export function ensureFileExtension(fileName: string, mimeType?: string): string {
  if (!fileName || hasFileExtension(fileName) || !mimeType) return fileName;
  const extension = EXTENSION_BY_MIME_TYPE[mimeType.split(';')[0].trim().toLowerCase()];
  return extension ? `${fileName}.${extension}` : fileName;
}

export function hasFileExtension(fileName: string): boolean {
  return /\.[A-Za-z0-9]{1,8}$/.test(fileName);
}

/**
 * Last path segment of a URL when it has a file extension ("…/files/Invoice%20123.pdf?x=1" →
 * "Invoice 123.pdf"), otherwise ''. Used to name documents sent from a URL: without a file
 * name Evolution takes the text before the first dot of the last segment ("Invoice 123") and
 * derives the MIME type from it, which yields the string "false".
 */
export function fileNameFromUrl(url: string): string {
  let segment: string;
  try {
    segment = new URL(url).pathname.split('/').pop() ?? '';
  } catch {
    return '';
  }
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // Keep the raw segment when it is not valid percent-encoding.
  }
  decoded = decoded.trim();
  return decoded && hasFileExtension(decoded) ? decoded : '';
}

// ============================================================================
// Buttons (sendButtons, sendCarousel)
// ============================================================================

export const BUTTON_TYPE_OPTIONS: INodePropertyOptions[] = [
  { name: 'Call', value: 'call', description: 'Call a phone number' },
  { name: 'Copy Code', value: 'copy', description: 'Copy a code to the clipboard' },
  {
    name: 'PIX Payment',
    value: 'pix',
    description: 'Brazilian PIX static payment key (must be the only button)',
  },
  {
    name: 'Quick Reply',
    value: 'reply',
    description: 'Reply button; its ID comes back in the reply webhook',
  },
  { name: 'URL', value: 'url', description: 'Open a link' },
];

export const PIX_KEY_TYPE_OPTIONS: INodePropertyOptions[] = [
  { name: 'CNPJ', value: 'cnpj' },
  { name: 'CPF', value: 'cpf' },
  { name: 'Email', value: 'email' },
  { name: 'Phone', value: 'phone' },
  { name: 'Random Key', value: 'random' },
];

/** Values of one button of a fixedCollection (type-specific fields). */
export function buttonValueProperties(types: string[]): INodeProperties[] {
  const typeOptions = BUTTON_TYPE_OPTIONS.filter((option) => types.includes(String(option.value)));
  const properties: INodeProperties[] = [
    {
      displayName: 'Type',
      name: 'type',
      type: 'options',
      options: typeOptions,
      default: 'reply',
    },
    {
      displayName: 'Display Text',
      name: 'displayText',
      type: 'string',
      default: '',
      description: 'Label of the button',
      displayOptions: { show: { type: ['reply', 'url', 'call', 'copy'] } },
    },
    {
      displayName: 'Button ID',
      name: 'id',
      type: 'string',
      default: '',
      description:
        'ID sent back in the reply webhook when the button is tapped. Defaults to the display text.',
      displayOptions: { show: { type: ['reply'] } },
    },
    {
      displayName: 'URL',
      name: 'url',
      type: 'string',
      default: '',
      placeholder: 'https://example.com',
      displayOptions: { show: { type: ['url'] } },
    },
    {
      displayName: 'Phone Number',
      name: 'phoneNumber',
      type: 'string',
      default: '',
      placeholder: '+5215512345678',
      description: 'Number to call, in international format',
      displayOptions: { show: { type: ['call'] } },
    },
    {
      displayName: 'Copy Code',
      name: 'copyCode',
      type: 'string',
      default: '',
      description: 'Text copied to the clipboard (e.g. a coupon code)',
      displayOptions: { show: { type: ['copy'] } },
    },
  ];
  if (types.includes('pix')) {
    properties.push(
      {
        displayName: 'Currency',
        name: 'currency',
        type: 'string',
        default: 'BRL',
        displayOptions: { show: { type: ['pix'] } },
      },
      {
        displayName: 'Merchant Name',
        name: 'name',
        type: 'string',
        default: '',
        displayOptions: { show: { type: ['pix'] } },
      },
      {
        displayName: 'PIX Key Type',
        name: 'keyType',
        type: 'options',
        options: PIX_KEY_TYPE_OPTIONS,
        default: 'random',
        displayOptions: { show: { type: ['pix'] } },
      },
      {
        displayName: 'PIX Key',
        name: 'key',
        type: 'string',
        default: '',
        displayOptions: { show: { type: ['pix'] } },
      },
    );
  }
  return properties;
}

const PIX_KEY_TYPES = PIX_KEY_TYPE_OPTIONS.map((option) => String(option.value));

/**
 * Validate one button and keep only the fields Evolution reads for its type
 * (DTO Button: type, displayText, id, url, phoneNumber, copyCode, currency, name, keyType, key).
 */
export function normalizeButton(
  node: INode,
  itemIndex: number,
  raw: IDataObject,
  label: string,
  allowedTypes: string[],
): IDataObject {
  const type = str(raw, 'type');
  if (!allowedTypes.includes(type)) {
    throw operationError(
      node,
      itemIndex,
      `${label}: unsupported button type "${type}"`,
      `Use one of: ${allowedTypes.join(', ')}.`,
    );
  }
  const requireValue = (key: string, name: string): string => {
    const value = str(raw, key);
    if (!value) throw operationError(node, itemIndex, `${label}: ${name} is required`);
    return value;
  };

  if (type === 'pix') {
    const keyType = str(raw, 'keyType');
    if (!PIX_KEY_TYPES.includes(keyType)) {
      throw operationError(
        node,
        itemIndex,
        `${label}: PIX Key Type must be one of ${PIX_KEY_TYPES.join(', ')}`,
      );
    }
    return {
      type,
      currency: str(raw, 'currency') || 'BRL',
      name: requireValue('name', 'Merchant Name'),
      keyType,
      key: requireValue('key', 'PIX Key'),
    };
  }

  const displayText = requireValue('displayText', 'Display Text');
  if (type === 'reply') return { type, displayText, id: str(raw, 'id') || displayText };
  if (type === 'url') {
    const url = requireValue('url', 'URL');
    if (!/^https?:\/\//i.test(url)) {
      throw operationError(node, itemIndex, `${label}: URL must start with http:// or https://`);
    }
    return { type, displayText, url };
  }
  if (type === 'call') {
    return { type, displayText, phoneNumber: requireValue('phoneNumber', 'Phone Number') };
  }
  return { type, displayText, copyCode: requireValue('copyCode', 'Copy Code') };
}

/**
 * Button combination rules of /message/sendButtons (whatsapp.baileys.service.ts buttonMessage):
 * - reply: at most 3, never mixed with other types;
 * - pix: exactly one button, alone;
 * - call-to-action (url, call, copy): never mixed with reply or pix. The server enforces its
 *   version's count limit (none in 2.3.7, at most 2 in 2.4+).
 */
export function assertButtonRules(node: INode, itemIndex: number, buttons: IDataObject[]): void {
  const count = (types: string[]) => buttons.filter((b) => types.includes(String(b.type))).length;
  const replies = count(['reply']);
  const pix = count(['pix']);
  const rulesHint =
    'Allowed combinations: 1-3 Quick Reply buttons, URL/Call/Copy Code buttons (at most 2 on Evolution API 2.4+), or a single PIX Payment button.';

  if (buttons.length === 0) {
    throw operationError(node, itemIndex, 'At least one button is required', rulesHint);
  }
  if (replies > 0 && replies !== buttons.length) {
    throw operationError(
      node,
      itemIndex,
      'Quick Reply buttons cannot be mixed with other button types',
      rulesHint,
    );
  }
  if (replies > 3) {
    throw operationError(
      node,
      itemIndex,
      'A message can have at most 3 Quick Reply buttons',
      rulesHint,
    );
  }
  // The reply ID is how a workflow tells the buttons apart (Cloud API rejects duplicates too).
  const replyIds = buttons.filter((b) => b.type === 'reply').map((b) => String(b.id));
  const duplicateId = replyIds.find((id, index) => replyIds.indexOf(id) !== index);
  if (duplicateId !== undefined) {
    throw operationError(
      node,
      itemIndex,
      `Quick Reply button IDs must be different ("${duplicateId}" is repeated)`,
      'The ID defaults to the display text when it is empty.',
    );
  }
  if (pix > 0 && buttons.length > 1) {
    throw operationError(
      node,
      itemIndex,
      'A PIX Payment button must be the only button of the message',
      rulesHint,
    );
  }
}

// ============================================================================
// Contacts (sendContact)
// ============================================================================

/**
 * WhatsApp ID (digits) for the vCard `waid`, mirroring Evolution's createJid() number rules
 * (MX/AR 13-digit numbers lose the 3rd digit, BR mobile 9th digit). Evolution's own fallback is
 * createJid(phoneNumber), which appends "@s.whatsapp.net" and breaks the vCard.
 */
export function contactWaId(phoneNumber: string): string {
  let digits = phoneNumber.replace(/\D/g, '');
  const countryCode = digits.substring(0, 2);
  if ((countryCode === '52' || countryCode === '54') && digits.length === 13) {
    digits = countryCode + digits.substring(3);
  }
  const brazil = /^(55)(\d{2})\d(\d{8})$/.exec(digits);
  if (brazil && Number(brazil[2]) >= 31 && Number(brazil[3][0]) >= 7) {
    digits = brazil[1] + brazil[2] + brazil[3];
  }
  return digits;
}
