import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
  evolutionApiRequest,
  isPlainObject,
  normalizeNumber,
  toArray,
  toJid,
} from '../../GenericFunctions';

// ============================================================================
// Shared fields
// ============================================================================

/** Description of every "Chat" field whose value Evolution uses verbatim (no createJid). */
export const CHAT_JID_DESCRIPTION =
  'Chat JID (…@s.whatsapp.net, group …@g.us, …@lid), e.g. key.remoteJid of a message. A phone number with country code is also accepted: the node resolves it to the chat JID with Check Numbers first.';

/** "Return All" + "Limit" (shared names `returnAll` / `limit`). */
export function paginationFields(what: string): INodeProperties[] {
  return [
    {
      displayName: 'Return All',
      name: 'returnAll',
      type: 'boolean',
      default: false,
      description: 'Whether to return all results or only up to a given limit',
    },
    {
      displayName: 'Limit',
      name: 'limit',
      type: 'number',
      typeOptions: { minValue: 1 },
      default: 50,
      displayOptions: { show: { returnAll: [false] } },
      description: `Max number of ${what} to return`,
    },
  ];
}

/** "Last Message" options of Archive / Mark as Unread (the chat's latest message key). */
export const lastMessageOptions: INodeProperties[] = [
  {
    displayName: 'Last Message ID',
    name: 'lastMessageId',
    type: 'string',
    default: '',
    description:
      'ID (key.id) of the latest message of the chat. Leave empty to let the node look it up in the messages stored by Evolution (requires DATABASE_SAVE_DATA_NEW_MESSAGE).',
  },
  {
    displayName: 'Last Message From Me',
    name: 'lastMessageFromMe',
    type: 'boolean',
    default: false,
    description: 'Whether the latest message was sent by this instance (key.fromMe)',
  },
  {
    displayName: 'Last Message Timestamp',
    name: 'lastMessageTimestamp',
    type: 'number',
    typeOptions: { minValue: 0 },
    default: 0,
    description:
      'Unix timestamp in seconds of the latest message (messageTimestamp). Only used with "Last Message ID"; Evolution uses the current time when it is empty.',
  },
];

// ============================================================================
// JIDs
// ============================================================================

/**
 * The JID Evolution's createJid() (src/utils/createJid.ts, same rules in 2.3.7 and 2.4) builds
 * for a number: JIDs are kept, group ids become …@g.us, and phone numbers get the MX/AR rule
 * (13 digits starting with 52/54: the 3rd digit, "1"/"9", is dropped) and the BR rule (13 digits
 * starting with 55, DDD >= 31 and a first local digit >= 7: the 9th digit is dropped) before
 * "@s.whatsapp.net". Baileys and Cloud API instances store `key.remoteJid` with these rules.
 */
export function evolutionJid(value: unknown): string {
  const jid = toJid(value);
  if (!jid.endsWith('@s.whatsapp.net') || normalizeNumber(value).includes('@')) return jid;

  let number = jid.slice(0, -'@s.whatsapp.net'.length);
  if (!/^\d+$/.test(number)) return jid;

  const countryCode = number.substring(0, 2);
  if ((countryCode === '52' || countryCode === '54') && number.length === 13) {
    number = countryCode + number.substring(3);
  }
  const br = /^(\d{2})(\d{2})\d(\d{8})$/.exec(number);
  if (br && br[1] === '55' && Number(br[3][0]) >= 7 && Number(br[2]) >= 31) {
    number = br[1] + br[2] + br[3];
  }
  return `${number}@s.whatsapp.net`;
}

/**
 * Full chat JID for routes that use `remoteJid` verbatim (markMessageAsRead/Played,
 * deleteMessageForEveryone, updateMessage, archiveChat/markChatUnread lookups,
 * findChatByRemoteJid, findMessages, findStatusMessage, getPollVote).
 *
 * - Anything with "@" is kept as is (…@s.whatsapp.net, …@g.us, …@lid, …@newsletter), never
 *   rewritten (EVONODE-13).
 * - Group ids become …@g.us (toJid).
 * - Phone numbers are resolved with POST /chat/whatsappNumbers, which applies Evolution's
 *   createJid rules and WhatsApp's own lookup (MX/AR "1"/"9" and BR 9th digit variants): the JID
 *   stored for "5215512345678" is "525512345678@s.whatsapp.net". When that lookup fails (Cloud API
 *   instance: the route is Baileys-only; disconnected session…) the same createJid rules are
 *   applied locally (evolutionJid) and the main request reports any real problem.
 */
export async function resolveChatJid(
  this: IExecuteFunctions,
  itemIndex: number,
  instance: string,
  value: unknown,
): Promise<string> {
  const normalized = normalizeNumber(value);
  if (!normalized || normalized.includes('@')) return normalized;

  const fallback = evolutionJid(normalized);
  if (!/^\d+$/.test(normalized) || fallback.endsWith('@g.us')) return fallback;

  try {
    const response = await evolutionApiRequest.call(
      this,
      'POST',
      `/chat/whatsappNumbers/${instance}`,
      { numbers: [normalized] },
      {},
      { itemIndex, idempotent: true, maxRetries: 0 },
    );
    const [entry] = toArray(response);
    if (entry && typeof entry.jid === 'string' && entry.jid.includes('@')) return entry.jid;
  } catch (error) {
    this.logger.debug('Evolution API: could not resolve the chat JID, using the number as is', {
      number: normalized,
      error: (error as Error).message,
    });
  }
  return fallback;
}

/** resolveChatJid() that fails with a clear message when the value is empty. */
export async function requireChatJid(
  this: IExecuteFunctions,
  itemIndex: number,
  instance: string,
  value: unknown,
  label = 'Chat',
): Promise<string> {
  const jid = await resolveChatJid.call(this, itemIndex, instance, value);
  if (!jid) {
    throw new NodeOperationError(this.getNode(), `${label} is required`, { itemIndex });
  }
  return jid;
}

/** Trimmed string parameter; throws "<label> is required" when empty. */
export function requireString(
  this: IExecuteFunctions,
  itemIndex: number,
  name: string,
  label: string,
): string {
  const value = String(this.getNodeParameter(name, itemIndex, '') ?? '').trim();
  if (!value) {
    throw new NodeOperationError(this.getNode(), `${label} is required`, { itemIndex });
  }
  return value;
}

/** Split a comma/semicolon/newline separated list (or an array) of IDs, trimmed and deduped. */
export function splitList(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : String(value ?? '').split(/[,\n;]/);
  const trimmed = entries.map((entry) => String(entry ?? '').trim()).filter((entry) => entry);
  return [...new Set(trimmed)];
}

// ============================================================================
// Messages stored by Evolution (findMessages)
// ============================================================================

/**
 * `where.key` filter matching a chat. Evolution ORs `remoteJid` with `remoteJidAlt`
 * (@lid <-> phone JID), so both get the same JID: messages addressed through the other
 * identifier of the same contact match too, and the OR never contains an empty condition.
 */
export function chatKeyFilter(jid: string): IDataObject {
  return { remoteJid: jid, remoteJidAlt: jid };
}

/** Records of a findMessages response: { messages: { total, pages, currentPage, records } }. */
export function extractMessageRecords(response: unknown): {
  records: IDataObject[];
  pages: number;
} {
  const envelope =
    isPlainObject(response) && isPlainObject(response.messages) ? response.messages : {};
  const pages = Number(envelope.pages);
  return {
    records: toArray(envelope.records),
    pages: Number.isFinite(pages) ? pages : 0,
  };
}

/**
 * Latest stored message of a chat as a `lastMessage` body ({ key, messageTimestamp }).
 * Used by Archive and Mark as Unread: Evolution 2.3.7 cannot look it up itself (malformed JSON
 * filter, fixed in 2.4) and markChatUnread always requires it.
 */
export async function findLastMessage(
  this: IExecuteFunctions,
  itemIndex: number,
  instance: string,
  chatJid: string,
): Promise<IDataObject | undefined> {
  const response = await evolutionApiRequest.call(
    this,
    'POST',
    `/chat/findMessages/${instance}`,
    { where: { key: chatKeyFilter(chatJid) }, page: 1, offset: 1 },
    {},
    { itemIndex, idempotent: true },
  );
  const [record] = extractMessageRecords(response).records;
  if (!record || !isPlainObject(record.key) || !record.key.id) return undefined;

  const key: IDataObject = {
    id: String(record.key.id),
    fromMe: record.key.fromMe === true,
    remoteJid: String(record.key.remoteJid || chatJid),
  };
  // Group messages: the sender is part of the message key WhatsApp expects.
  if (typeof record.key.participant === 'string' && record.key.participant) {
    key.participant = record.key.participant;
  }
  const lastMessage: IDataObject = { key };
  const timestamp = Number(record.messageTimestamp);
  if (Number.isInteger(timestamp) && timestamp > 0) lastMessage.messageTimestamp = timestamp;
  return lastMessage;
}

/**
 * `lastMessage` for Archive / Mark as Unread: from the "Last Message" options, else the latest
 * stored message of the chat. Fails clearly when neither exists: Evolution's own lookup (`chat`
 * without `lastMessage`) reads the same table with a narrower filter (and is broken in 2.3.7),
 * so it could only answer a 500 "Open a calling" error.
 */
export async function requireLastMessage(
  this: IExecuteFunctions,
  itemIndex: number,
  instance: string,
  chatJid: string,
  options: IDataObject,
): Promise<IDataObject> {
  const lastMessage =
    lastMessageFromOptions(options, chatJid) ??
    (await findLastMessage.call(this, itemIndex, instance, chatJid));
  if (!lastMessage) {
    throw new NodeOperationError(this.getNode(), `No stored message found for chat ${chatJid}`, {
      itemIndex,
      description:
        'WhatsApp needs the latest message of the chat. Set "Last Message ID" in the options, or enable DATABASE_SAVE_DATA_NEW_MESSAGE on the Evolution server.',
    });
  }
  return lastMessage;
}

/** `lastMessage` built from the "Last Message" options, or undefined when no ID was given. */
export function lastMessageFromOptions(
  options: IDataObject,
  chatJid: string,
): IDataObject | undefined {
  const id = String(options.lastMessageId ?? '').trim();
  if (!id) return undefined;
  const lastMessage: IDataObject = {
    key: { id, fromMe: options.lastMessageFromMe === true, remoteJid: chatJid },
  };
  const timestamp = Math.round(Number(options.lastMessageTimestamp));
  if (Number.isFinite(timestamp) && timestamp > 0) lastMessage.messageTimestamp = timestamp;
  return lastMessage;
}

// ============================================================================
// Pagination
// ============================================================================

/** Page size used by "Return All" on page-based routes. */
export const PAGE_SIZE = 100;

/** Safety net against a server that ignores the page parameter. */
const MAX_PAGES = 10000;

/**
 * Collect records from a page-based route (page numbers start at 1).
 * `fetchPage` returns the page's records and, when the route reports it, the page count.
 * Stops at the last page, on an empty or short page, or once `limit` records were collected.
 */
export async function collectPages(
  fetchPage: (
    page: number,
    pageSize: number,
  ) => Promise<{ records: IDataObject[]; pages?: number }>,
  limit?: number,
): Promise<IDataObject[]> {
  if (limit !== undefined) {
    const { records } = await fetchPage(1, limit);
    return records.slice(0, limit);
  }

  const results: IDataObject[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { records, pages } = await fetchPage(page, PAGE_SIZE);
    results.push(...records);
    if (records.length < PAGE_SIZE) break;
    if (pages !== undefined && page >= pages) break;
  }
  return results;
}

/** `limit` for the current item, or undefined when "Return All" is on. */
export function getLimit(this: IExecuteFunctions, itemIndex: number): number | undefined {
  const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
  if (returnAll) return undefined;
  const limit = Math.floor(Number(this.getNodeParameter('limit', itemIndex, 50)));
  return Number.isFinite(limit) && limit > 0 ? limit : 50;
}

/** ISO string of a dateTime parameter, or undefined when empty/invalid. */
export function toIsoDate(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * `messageTimestamp: { gte, lte }` filter. Evolution applies it only when BOTH bounds are
 * present, so a missing bound is filled with the epoch or "now".
 */
export function timestampRange(after: unknown, before: unknown): IDataObject | undefined {
  const gte = toIsoDate(after);
  const lte = toIsoDate(before);
  if (!gte && !lte) return undefined;
  return {
    gte: gte ?? new Date(0).toISOString(),
    lte: lte ?? new Date().toISOString(),
  };
}
