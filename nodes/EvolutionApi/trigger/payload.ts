import type { IDataObject } from 'n8n-workflow';

import { cleanBase64, isPlainObject } from '../GenericFunctions';

/**
 * Parsing of the Evolution webhook envelope (spec §8.3):
 * `{ event, instance, data, destination, date_time, sender, server_url, apikey }`, plus
 * `isLatest`/`progress` on messages.set.
 */

/** `messages.upsert` → `MESSAGES_UPSERT` (the name used by /webhook/set and the Events list). */
export function normalizeEventName(event: unknown): string {
  return String(event ?? '')
    .trim()
    .replace(/[.-]/g, '_')
    .toUpperCase();
}

/** Split a comma/semicolon/newline separated list, trimmed, without empty entries. */
export function parseList(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : String(value ?? '').split(/[,;\n]/);
  return entries.map((entry) => String(entry).trim()).filter((entry) => entry !== '');
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function getPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const key of path.split('.')) {
    if (!isPlainObject(current)) return undefined;
    current = current[key];
  }
  return current;
}

// ============================================================================
// JIDs (spec §5, EVOAPI-5)
// ============================================================================

const PHONE_JID_SUFFIXES = ['@s.whatsapp.net', '@c.us'];

function isPhoneJidValue(value: unknown): value is string {
  return typeof value === 'string' && PHONE_JID_SUFFIXES.some((suffix) => value.endsWith(suffix));
}

function isLidValue(value: unknown): value is string {
  return typeof value === 'string' && value.endsWith('@lid');
}

/** Digits of a phone JID: `5215512345678:3@s.whatsapp.net` → `5215512345678`. */
export function jidToPhoneNumber(jid: string): string {
  return jid.split('@')[0].split(':')[0];
}

/**
 * JID without the device suffix: `5215512345678:12@s.whatsapp.net` → `5215512345678@s.whatsapp.net`
 * (2.4 strips it from key.remoteJid/participant, 2.3.7 does not, and neither does it from the Alt
 * fields).
 */
export function stripJidDevice(jid: string): string {
  return jid.replace(/:\d+(?=@)/, '');
}

/**
 * Phone JID and LID among a JID and its "Alt" twin, whatever the server version:
 * - 2.3.7: remoteJid = phone JID (rewritten from the LID), remoteJidAlt = phone JID or absent;
 * - 2.4: remoteJid = phone JID, remoteJidAlt = the @lid, addressingMode 'pn' (swap);
 * - 2.4 with Chatwoot enabled: both are phone JIDs (EVOCW-10);
 * - no Alt available: remoteJid may still be the @lid.
 * `addressingMode` is deliberately ignored. Device suffixes are removed.
 */
export function pickPhoneAndLid(...jids: unknown[]): {
  phoneJid: string | null;
  lid: string | null;
} {
  const phoneJid = jids.find(isPhoneJidValue);
  const lid = jids.find(isLidValue);
  return {
    phoneJid: phoneJid ? stripJidDevice(phoneJid) : null,
    lid: lid ? stripJidDevice(lid) : null,
  };
}

// ============================================================================
// Message identity and text
// ============================================================================

/** Convenience fields added to every item whose `data` identifies a chat (remoteJid). */
export interface MessageFields extends IDataObject {
  messageId: string | null;
  remoteJid: string;
  remoteJidAlt: string | null;
  phoneJid: string | null;
  phoneNumber: string | null;
  lid: string | null;
  isGroup: boolean;
  participant: string | null;
  participantPhoneJid: string | null;
  participantLid: string | null;
  fromMe: boolean | null;
  pushName: string | null;
  messageType: string | null;
  text: string | null;
  /** ID of the message this one replies to (contextInfo.stanzaId). */
  quotedMessageId: string | null;
}

/** Keys that hold a single text-like value, in priority order. */
const TEXT_PATHS = [
  'conversation',
  'extendedTextMessage.text',
  'imageMessage.caption',
  'videoMessage.caption',
  'documentMessage.caption',
  'ptvMessage.caption',
  'buttonsResponseMessage.selectedDisplayText',
  'templateButtonReplyMessage.selectedDisplayText',
  'listResponseMessage.title',
  'interactiveResponseMessage.body.text',
  'reactionMessage.text',
  'pollCreationMessage.name',
  'pollCreationMessageV2.name',
  'pollCreationMessageV3.name',
  'speechToText',
  'buttonsResponseMessage.selectedButtonId',
  'templateButtonReplyMessage.selectedId',
  'listResponseMessage.singleSelectReply.selectedRowId',
];

/** Wrappers whose `.message` holds the real content. */
const MESSAGE_WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'editedMessage',
];

/**
 * Text of a message object (`data.message`): the text, a media caption, the selected button or
 * list row, a reaction emoji, a poll name, or the OpenAI transcription (`speechToText`).
 */
export function extractText(message: unknown, depth = 0): string | null {
  if (!isPlainObject(message) || depth > 4) return null;
  for (const path of TEXT_PATHS) {
    const value = asString(getPath(message, path));
    if (value !== undefined) return value;
  }
  for (const wrapper of MESSAGE_WRAPPERS) {
    const text = extractText(getPath(message, `${wrapper}.message`), depth + 1);
    if (text !== null) return text;
  }
  return extractText(getPath(message, 'protocolMessage.editedMessage'), depth + 1);
}

/** Fold equivalent `messageType` values so one filter option matches all of them. */
export function normalizeMessageType(messageType: string): string {
  if (messageType === 'extendedTextMessage') return 'conversation';
  if (messageType === 'documentWithCaptionMessage') return 'documentMessage';
  if (/^pollCreationMessageV\d+$/.test(messageType)) return 'pollCreationMessage';
  if (/^viewOnceMessageV2(Extension)?$/.test(messageType)) return 'viewOnceMessage';
  return messageType;
}

/**
 * ID of the quoted message, wherever the server version puts the context (spec §6):
 * - 2.3.7: `data.contextInfo` is the content message's contextInfo (stanzaId, quotedMessage…);
 * - 2.4: `data.contextInfo` comes from messageContextInfo (EVOAPI-4), so the quote only survives
 *   inside the media content (`data.message.imageMessage.contextInfo`…). For plain texts 2.4
 *   drops it before the webhook, so it is null there.
 */
export function getQuotedMessageId(data: IDataObject): string | null {
  const direct = asString(getPath(data, 'contextInfo.stanzaId'));
  if (direct !== undefined) return direct;
  if (!isPlainObject(data.message)) return null;
  for (const content of Object.values(data.message)) {
    const nested = asString(getPath(content, 'contextInfo.stanzaId'));
    if (nested !== undefined) return nested;
  }
  return null;
}

/**
 * Chat identity of a single-object `data`: a message (`data.key`), a message update
 * (`{ keyId, remoteJid, fromMe, participant }`), a revoke (`{ ...key, status }`) or a contact
 * (`{ remoteJid, pushName }`). Undefined for arrays and events without a remoteJid.
 */
export function getMessageFields(data: unknown): MessageFields | undefined {
  if (!isPlainObject(data)) return undefined;
  const key = isPlainObject(data.key) ? data.key : data;
  const remoteJid = asString(key.remoteJid) ?? asString(data.remoteJid);
  if (remoteJid === undefined) return undefined;

  const remoteJidAlt = asString(key.remoteJidAlt) ?? null;
  const { phoneJid, lid } = pickPhoneAndLid(remoteJid, remoteJidAlt);
  const participant = asString(key.participant) ?? asString(data.participant) ?? null;
  const participantIds = pickPhoneAndLid(participant, key.participantAlt);
  const fromMe =
    typeof key.fromMe === 'boolean'
      ? key.fromMe
      : typeof data.fromMe === 'boolean'
        ? data.fromMe
        : null;
  const messageType = asString(data.messageType) ?? null;

  return {
    messageId: asString(key.id) ?? asString(data.keyId) ?? null,
    remoteJid,
    remoteJidAlt,
    phoneJid,
    phoneNumber: phoneJid ? jidToPhoneNumber(phoneJid) : null,
    lid,
    isGroup: remoteJid.endsWith('@g.us'),
    participant,
    participantPhoneJid: participantIds.phoneJid,
    participantLid: participantIds.lid,
    fromMe,
    pushName: asString(data.pushName) ?? null,
    messageType,
    // messages.edited carries the protocolMessage itself: { key, editedMessage }.
    text: extractText(data.message) ?? extractText(data.editedMessage),
    quotedMessageId: getQuotedMessageId(data),
  };
}

// ============================================================================
// Filters
// ============================================================================

export interface TriggerFilters {
  /** Event names (MESSAGES_UPSERT…). Empty = every event. */
  events: string[];
  /** Instance names. Empty = every instance. */
  instanceNames: string[];
  ignoreFromMe: boolean;
  ignoreGroups: boolean;
  ignoreNewsletters: boolean;
  ignoreBroadcasts: boolean;
  /** `data.messageType` values. Empty = every type. */
  messageTypes: string[];
}

/** Why an event is dropped, or undefined when it passes every filter. */
export function getFilterReason(
  body: IDataObject,
  fields: MessageFields | undefined,
  filters: TriggerFilters,
): string | undefined {
  const eventName = normalizeEventName(body.event);
  if (filters.events.length > 0 && !filters.events.includes(eventName)) {
    return `event ${eventName} is not selected`;
  }
  const instance = String(body.instance ?? '');
  if (filters.instanceNames.length > 0 && !filters.instanceNames.includes(instance)) {
    return `instance "${instance}" is not selected`;
  }
  if (!fields) return undefined;

  if (filters.ignoreFromMe && fields.fromMe === true)
    return 'message sent by the instance (fromMe)';
  const chat = fields.remoteJid;
  if (filters.ignoreGroups && chat.endsWith('@g.us')) return 'group chat';
  if (filters.ignoreNewsletters && chat.endsWith('@newsletter')) return 'newsletter (channel)';
  if (filters.ignoreBroadcasts && chat.endsWith('@broadcast')) return 'status or broadcast list';
  if (filters.messageTypes.length > 0 && fields.messageType !== null) {
    const wanted = filters.messageTypes.map(normalizeMessageType);
    if (!wanted.includes(normalizeMessageType(fields.messageType))) {
      return `message type ${fields.messageType} is not selected`;
    }
  }
  return undefined;
}

// ============================================================================
// Media (webhook base64)
// ============================================================================

const MEDIA_CONTENT_KEYS = [
  'imageMessage',
  'videoMessage',
  'audioMessage',
  'documentMessage',
  'stickerMessage',
  'ptvMessage',
];

const EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
};

export interface WebhookMedia {
  /** Raw base64 (validated). */
  data: string;
  mimeType?: string;
  fileName: string;
}

function findMediaContent(message: IDataObject, depth = 0): IDataObject | undefined {
  for (const key of MEDIA_CONTENT_KEYS) {
    if (isPlainObject(message[key])) return message[key] as IDataObject;
  }
  if (depth > 3) return undefined;
  for (const wrapper of MESSAGE_WRAPPERS) {
    const inner = getPath(message, `${wrapper}.message`);
    if (isPlainObject(inner)) {
      const content = findMediaContent(inner, depth + 1);
      if (content) return content;
    }
  }
  return undefined;
}

function extensionFor(mimeType: string | undefined): string {
  const base = (mimeType ?? '').split(';')[0].trim().toLowerCase();
  if (EXTENSIONS[base]) return EXTENSIONS[base];
  const subtype = base.split('/')[1] ?? '';
  return /^[a-z0-9]{1,5}$/.test(subtype) ? subtype : 'bin';
}

/**
 * Media embedded by Evolution when the webhook has "Webhook Base64" on: `data.message.base64`
 * (media messages only; the mime type and file name come from the media content).
 */
export function findWebhookMedia(
  data: unknown,
  messageId: string | null,
): WebhookMedia | undefined {
  if (!isPlainObject(data) || !isPlainObject(data.message)) return undefined;
  const raw = data.message.base64;
  if (typeof raw !== 'string' || raw === '') return undefined;
  const { data: base64, valid } = cleanBase64(raw);
  if (!valid) return undefined;

  const content = findMediaContent(data.message);
  const mimeType = asString(content?.mimetype);
  const fileName =
    asString(content?.fileName) ?? `${messageId ?? 'media'}.${extensionFor(mimeType)}`;
  return { data: base64, mimeType, fileName };
}

/** Copy of `data` without `message.base64` (the media moves to the binary output). */
export function withoutMediaBase64(data: IDataObject): IDataObject {
  const message = { ...(data.message as IDataObject) };
  delete message.base64;
  return { ...data, message };
}

// ============================================================================
// Timestamp
// ============================================================================

/**
 * Event time as ISO 8601 UTC: the `X-Timestamp` header (ms, instance webhooks on 2.4+), else
 * `data.messageTimestamp` (seconds, set by WhatsApp), else null. `date_time` is not used: it is
 * the server's local wall-clock time with a "Z" suffix whenever its TZ is not UTC (GAP-4).
 */
export function getEventTimestamp(xTimestamp: string | undefined, data: unknown): string | null {
  const headerMs = Number(xTimestamp);
  if (xTimestamp && Number.isFinite(headerMs) && headerMs > 0) {
    return new Date(headerMs).toISOString();
  }
  const seconds = isPlainObject(data) ? Number(data.messageTimestamp) : NaN;
  if (Number.isFinite(seconds) && seconds > 0) return new Date(seconds * 1000).toISOString();
  return null;
}
