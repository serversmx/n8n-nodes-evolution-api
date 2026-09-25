import type { IDataObject, INodeProperties, INodePropertyOptions } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

import { EVOLUTION_24_ONLY_EVENTS, EVOLUTION_EVENT_OPTIONS, REQUIRES_24 } from '../../constants';
import { isPlainObject } from '../../GenericFunctions';

/**
 * What each accepted event carries (payload `event` value in parentheses). Source: spec §8.2,
 * event.controller.ts (EventController.events, 31 names in 2.3.7, 32 in 2.4.0-rc2) and the
 * call sites in whatsapp.baileys.service.ts.
 */
const EVENT_DESCRIPTIONS: Record<string, string> = {
  APPLICATION_STARTUP: 'Accepted but never sent by Evolution API v2 (application.startup)',
  CALL: 'Incoming call offers and status changes (call)',
  CHATS_DELETE: 'Chats deleted on the phone (chats.delete)',
  CHATS_SET: 'Chat list received during the history sync (chats.set)',
  CHATS_UPDATE: 'Chat changes such as unread count or archive (chats.update)',
  CHATS_UPSERT: 'New chats (chats.upsert)',
  CONNECTION_UPDATE:
    'Connection state changes: open, connecting, close, refused (connection.update)',
  CONTACTS_SET: 'Accepted but never sent by Evolution API v2 (contacts.set)',
  CONTACTS_UPDATE: 'Contact name or profile picture changes (contacts.update)',
  CONTACTS_UPSERT: 'New or synced contacts (contacts.upsert)',
  GROUP_PARTICIPANTS_UPDATE:
    'Participants added, removed, promoted or demoted (group-participants.update)',
  GROUP_UPDATE:
    'Accepted but never delivered: group changes are emitted as groups.update, which this name does not match',
  GROUPS_UPSERT: 'Groups the account joins or creates (groups.upsert)',
  INSTANCE_CREATE:
    'Instance created; only reaches webhooks set in the same create request (instance.create)',
  INSTANCE_DELETE: 'Instance deleted (instance.delete)',
  LABELS_ASSOCIATION: 'Label added to or removed from a chat (labels.association)',
  LABELS_EDIT: 'Label created, edited or deleted (labels.edit)',
  LOGOUT_INSTANCE: 'WhatsApp session logged out (logout.instance)',
  MESSAGES_DELETE: 'Messages deleted for everyone (messages.delete)',
  MESSAGES_EDITED: 'Messages edited by the sender (messages.edited)',
  MESSAGES_SET: 'Message batches of the history sync (messages.set)',
  MESSAGES_UPDATE: 'Delivery and read receipts, poll votes (messages.update)',
  MESSAGES_UPSERT: 'New incoming and outgoing messages (messages.upsert)',
  MESSAGING_HISTORY_SET: `History sync finished, with message, chat and contact counts (messaging-history.set). ${REQUIRES_24}`,
  PRESENCE_UPDATE: 'Typing, recording and online presence of contacts (presence.update)',
  QRCODE_UPDATED: 'New QR code or pairing code while connecting (qrcode.updated)',
  REMOVE_INSTANCE: 'Instance removed (remove.instance)',
  SEND_MESSAGE: 'Messages sent through the API (send.message)',
  SEND_MESSAGE_UPDATE: 'Messages edited through the API (send.message.update)',
  STATUS_INSTANCE: 'Instance status changes, e.g. closed with a reason code (status.instance)',
  TYPEBOT_CHANGE_STATUS: 'Typebot session status changes (typebot.change-status)',
  TYPEBOT_START: 'Typebot flow started through the API (typebot.start)',
};

/** Accepted event names (shared constant) with a description of what each one carries. */
export const WEBHOOK_EVENT_OPTIONS: INodePropertyOptions[] = EVOLUTION_EVENT_OPTIONS.map(
  (option) => ({
    ...option,
    description: EVENT_DESCRIPTIONS[String(option.value)] ?? option.description,
  }),
);

/**
 * Event names from a multiOptions value, an array or a comma/newline separated expression.
 * Dotted payload names are accepted too: "messages.upsert" → "MESSAGES_UPSERT" (the same
 * normalization Evolution applies when it filters events). Evolution validates the names
 * (400 for an unknown one); an empty list means every event.
 */
export function normalizeEvents(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : String(value ?? '').split(/[,\n;]/);
  const events = entries
    .map((entry) =>
      String(entry ?? '')
        .trim()
        .replace(/[.-]/g, '_')
        .toUpperCase(),
    )
    .filter((entry) => entry);
  return [...new Set(events)];
}

/** Header names whose values are credentials (removed from the output unless asked). */
const SECRET_HEADER = /jwt|auth|token|secret|key|pass|signature|cookie/i;

/** Remove jwt_key and credential-like headers from a Webhook row. */
export function redactWebhookSecrets(response: IDataObject): IDataObject {
  if (!isPlainObject(response.headers)) return response;
  const headers: IDataObject = {};
  for (const [name, value] of Object.entries(response.headers)) {
    if (!SECRET_HEADER.test(name)) headers[name] = value;
  }
  return { ...response, headers };
}

/** "Options > Include Secrets" of the webhook operations. */
export const includeWebhookSecretsOption: INodeProperties = {
  displayName: 'Include Secrets',
  name: 'includeSecrets',
  type: 'boolean',
  default: false,
  description:
    'Whether to keep secret headers in the output: jwt_key and headers whose name contains auth, token, secret, key, pass, signature or cookie. Off by default so they are not stored in execution logs.',
};

/**
 * Add an explanation to a 400 caused by an event the server does not know, e.g.
 * MESSAGING_HISTORY_SET on 2.3.7. Returns the error to rethrow.
 */
export function withEventsHint(error: unknown, events: string[]): unknown {
  const newer = events.filter((event) => EVOLUTION_24_ONLY_EVENTS.includes(event));
  if (error instanceof NodeApiError && error.httpCode === '400' && newer.length > 0) {
    error.description =
      `${newer.join(', ')}: ${REQUIRES_24} Remove it for Evolution API 2.3.x. ${error.description ?? ''}`.trim();
  }
  return error;
}

/** Event transports configured per instance (src/api/integrations/event/event.router.ts). */
export interface TransportInfo {
  label: string;
  env: string;
}

export const TRANSPORTS: Record<string, TransportInfo> = {
  kafka: { label: 'Kafka', env: 'KAFKA_ENABLED' },
  nats: { label: 'NATS', env: 'NATS_ENABLED' },
  pusher: { label: 'Pusher', env: 'PUSHER_ENABLED' },
  rabbitmq: { label: 'RabbitMQ', env: 'RABBITMQ_ENABLED' },
  sqs: { label: 'Amazon SQS', env: 'SQS_ENABLED' },
  websocket: { label: 'WebSocket', env: 'WEBSOCKET_ENABLED' },
};

export const TRANSPORT_OPTIONS: INodePropertyOptions[] = [
  {
    name: 'Amazon SQS',
    value: 'sqs',
    description:
      'Publish events to Amazon SQS queues (SQS_ENABLED=true; region and credentials are server settings)',
  },
  {
    name: 'Kafka',
    value: 'kafka',
    description: 'Publish events to Kafka topics (KAFKA_ENABLED=true; brokers are server settings)',
  },
  {
    name: 'NATS',
    value: 'nats',
    description:
      'Publish events to NATS subjects (NATS_ENABLED=true; server URL is a server setting)',
  },
  {
    name: 'Pusher',
    value: 'pusher',
    description:
      'Trigger events on Pusher Channels with per-instance app credentials (PUSHER_ENABLED=true)',
  },
  {
    name: 'RabbitMQ',
    value: 'rabbitmq',
    description:
      'Publish events to RabbitMQ exchanges (RABBITMQ_ENABLED=true; URI and exchange are server settings)',
  },
  {
    name: 'WebSocket',
    value: 'websocket',
    description:
      'Emit events on the Socket.IO endpoint of the server (WEBSOCKET_ENABLED=true); clients authenticate with the apikey',
  },
];

/** Transport of the current item, validated (the value can come from an expression). */
export function getTransport(value: unknown): { name: string; info: TransportInfo } | undefined {
  const name = String(value ?? '').trim();
  const info = Object.prototype.hasOwnProperty.call(TRANSPORTS, name)
    ? TRANSPORTS[name]
    : undefined;
  return info ? { name, info } : undefined;
}

/** Remove the Pusher secret from a transport row. */
export function redactTransportSecrets(response: IDataObject): IDataObject {
  if (!('secret' in response)) return response;
  const copy: IDataObject = { ...response };
  delete copy.secret;
  return copy;
}
