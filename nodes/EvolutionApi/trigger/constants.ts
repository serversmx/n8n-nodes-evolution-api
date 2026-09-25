import type { INodePropertyOptions } from 'n8n-workflow';

import { REQUIRES_24 } from '../constants';

/**
 * Header that carries the random secret in "Automatic" mode (and the default header name in
 * "Manual" mode). Evolution forwards custom `webhook.headers` as-is; 2.4 only overrides
 * Content-Type, User-Agent and the X-Instance-* / X-Event-Type / X-Timestamp headers.
 */
export const SECRET_HEADER_NAME = 'x-evolution-secret';

/**
 * Evolution signs the webhook JWT once per event (`exp = iat + 600`) and reuses it for every
 * retry. With the default schedule (5 s × 2ⁿ ±20 %, capped at 300 s, 10 attempts, 30 s timeout)
 * the last retries arrive about 20–25 minutes after the first attempt, so 1200 s of leeway
 * accepts them (600 s + 1200 s = 30 minutes in total).
 */
export const DEFAULT_JWT_LEEWAY_SECONDS = 1200;

/** Retried deliveries are remembered for 30 minutes (the whole Evolution retry schedule). */
export const DEDUPE_TTL_MS = 30 * 60 * 1000;

/** Upper bound of remembered deliveries kept in the workflow static data (per node). */
export const DEDUPE_MAX_STATIC_ENTRIES = 500;

/** Upper bound of remembered deliveries kept in memory (per node and webhook URL). */
export const DEDUPE_MAX_MEMORY_ENTRIES = 2000;

/**
 * Names accepted by /webhook/set that are never delivered (spec §8.2): APPLICATION_STARTUP and
 * CONTACTS_SET have no call site, and GROUP_UPDATE never matches the emitted `groups.update`.
 * They are not offered by the trigger.
 */
export const NEVER_DELIVERED_EVENTS = ['APPLICATION_STARTUP', 'CONTACTS_SET', 'GROUP_UPDATE'];

/** Events that only exist on Evolution API 2.4+ (2.3.x answers 400 on /webhook/set). */
export const TRIGGER_24_ONLY_EVENTS = ['MESSAGING_HISTORY_SET'];

/**
 * Events offered by the trigger: the names accepted by /webhook/set (EventController.events)
 * minus NEVER_DELIVERED_EVENTS, sorted by name. The payload carries the dotted form
 * (`messages.upsert`); the trigger compares `event.replace(/[.-]/g, '_').toUpperCase()`.
 */
export const TRIGGER_EVENT_OPTIONS: INodePropertyOptions[] = [
  {
    name: 'Call',
    value: 'CALL',
    description: 'Incoming or outgoing call: offer, accept, reject or timeout',
  },
  { name: 'Chats Delete', value: 'CHATS_DELETE', description: 'Chats were deleted' },
  { name: 'Chats Set', value: 'CHATS_SET', description: 'Chat list loaded by the history sync' },
  {
    name: 'Chats Update',
    value: 'CHATS_UPDATE',
    description: 'Chat changed (unread count, archive, name…)',
  },
  { name: 'Chats Upsert', value: 'CHATS_UPSERT', description: 'New chats' },
  {
    name: 'Connection Update',
    value: 'CONNECTION_UPDATE',
    description: 'Connection state changed: open, connecting, close or refused',
  },
  {
    name: 'Contacts Update',
    value: 'CONTACTS_UPDATE',
    description: 'Contact name or profile picture changed',
  },
  { name: 'Contacts Upsert', value: 'CONTACTS_UPSERT', description: 'New contacts' },
  {
    name: 'Group Participants Update',
    value: 'GROUP_PARTICIPANTS_UPDATE',
    description: 'Group participants added, removed, promoted or demoted',
  },
  { name: 'Groups Upsert', value: 'GROUPS_UPSERT', description: 'Groups joined or created' },
  {
    name: 'Instance Create',
    value: 'INSTANCE_CREATE',
    description:
      'An instance was created. Only reaches the global webhook (Manual mode) or a webhook set in the same create request.',
  },
  { name: 'Instance Delete', value: 'INSTANCE_DELETE', description: 'An instance was deleted' },
  {
    name: 'Labels Association',
    value: 'LABELS_ASSOCIATION',
    description: 'A label was added to or removed from a chat',
  },
  {
    name: 'Labels Edit',
    value: 'LABELS_EDIT',
    description: 'A label was created, edited or deleted',
  },
  {
    name: 'Logout Instance',
    value: 'LOGOUT_INSTANCE',
    description: 'The instance was logged out of WhatsApp. Never sent to the global webhook.',
  },
  {
    name: 'Messages Delete',
    value: 'MESSAGES_DELETE',
    description: 'A message was deleted for everyone',
  },
  { name: 'Messages Edited', value: 'MESSAGES_EDITED', description: 'A message was edited' },
  {
    name: 'Messages Set',
    value: 'MESSAGES_SET',
    description: 'Batch of old messages loaded by the history sync',
  },
  {
    name: 'Messages Update',
    value: 'MESSAGES_UPDATE',
    description: 'Delivery and read receipts, and poll votes',
  },
  {
    name: 'Messages Upsert',
    value: 'MESSAGES_UPSERT',
    description:
      'A message was received, or sent from the phone or another linked device (fromMe = true)',
  },
  {
    name: 'Messaging History Set',
    value: 'MESSAGING_HISTORY_SET',
    description: `The history sync finished (message, chat and contact counts). ${REQUIRES_24}`,
  },
  {
    name: 'Presence Update',
    value: 'PRESENCE_UPDATE',
    description: 'A contact is typing, recording, online or offline',
  },
  {
    name: 'QR Code Updated',
    value: 'QRCODE_UPDATED',
    description: 'New QR code or pairing code while the instance connects',
  },
  {
    name: 'Remove Instance',
    value: 'REMOVE_INSTANCE',
    description: 'The instance was removed. Never sent to the global webhook.',
  },
  {
    name: 'Send Message',
    value: 'SEND_MESSAGE',
    description: 'A message was sent through the API (fromMe = true)',
  },
  {
    name: 'Send Message Update',
    value: 'SEND_MESSAGE_UPDATE',
    description: 'A message was edited through the API',
  },
  {
    name: 'Status Instance',
    value: 'STATUS_INSTANCE',
    description:
      'The instance status changed (e.g. closed, with a reason code). Never sent to the global webhook.',
  },
  {
    name: 'Typebot Change Status',
    value: 'TYPEBOT_CHANGE_STATUS',
    description: 'A Typebot session changed status',
  },
  { name: 'Typebot Start', value: 'TYPEBOT_START', description: 'A Typebot session started' },
];

/**
 * `data.messageType` values (Baileys content types as Evolution reports them), sorted by name.
 * Evolution rewrites extendedTextMessage to `conversation` and documentWithCaptionMessage to
 * `documentMessage`; the filter also folds poll/view-once variants (see normalizeMessageType).
 */
export const MESSAGE_TYPE_OPTIONS: INodePropertyOptions[] = [
  { name: 'Audio', value: 'audioMessage', description: 'Voice note or audio file' },
  { name: 'Buttons Response', value: 'buttonsResponseMessage' },
  { name: 'Contact', value: 'contactMessage', description: 'vCard' },
  { name: 'Contacts Array', value: 'contactsArrayMessage', description: 'Several vCards' },
  { name: 'Document', value: 'documentMessage', description: 'File, with or without caption' },
  { name: 'Edited Message', value: 'editedMessage' },
  { name: 'Image', value: 'imageMessage' },
  { name: 'Interactive Response', value: 'interactiveResponseMessage' },
  { name: 'List Response', value: 'listResponseMessage' },
  { name: 'Live Location', value: 'liveLocationMessage' },
  { name: 'Location', value: 'locationMessage' },
  { name: 'Poll', value: 'pollCreationMessage', description: 'Poll creation (any version)' },
  { name: 'Poll Vote', value: 'pollUpdateMessage' },
  {
    name: 'Protocol Message',
    value: 'protocolMessage',
    description: 'Revoke, edit or ephemeral-setting notices',
  },
  { name: 'Reaction', value: 'reactionMessage', description: 'Emoji reaction' },
  { name: 'Sticker', value: 'stickerMessage' },
  { name: 'Template Button Reply', value: 'templateButtonReplyMessage' },
  { name: 'Text', value: 'conversation', description: 'Plain or extended text' },
  { name: 'Video', value: 'videoMessage' },
  { name: 'Video Note (PTV)', value: 'ptvMessage' },
  { name: 'View Once', value: 'viewOnceMessage', description: 'View-once media (any version)' },
];
