import type { INodePropertyOptions } from 'n8n-workflow';

/** Appended to the description of every field or option that only exists on Evolution API 2.4+. */
export const REQUIRES_24 = 'Requires Evolution API 2.4+.';

/**
 * Events accepted by /webhook/set, /websocket/set, /rabbitmq/set, /sqs/set… and by the
 * `webhook.events` block of /instance/create (EventController.events).
 * Source: src/api/integrations/event/event.controller.ts (2.3.7 and 2.4.0-rc2).
 * MESSAGING_HISTORY_SET only exists in 2.4+: 2.3.7 answers 400 on /webhook/set when it is sent.
 */
export const EVOLUTION_EVENT_OPTIONS: INodePropertyOptions[] = [
  { name: 'Application Startup', value: 'APPLICATION_STARTUP' },
  { name: 'Call', value: 'CALL' },
  { name: 'Chats Delete', value: 'CHATS_DELETE' },
  { name: 'Chats Set', value: 'CHATS_SET' },
  { name: 'Chats Update', value: 'CHATS_UPDATE' },
  { name: 'Chats Upsert', value: 'CHATS_UPSERT' },
  { name: 'Connection Update', value: 'CONNECTION_UPDATE' },
  { name: 'Contacts Set', value: 'CONTACTS_SET' },
  { name: 'Contacts Update', value: 'CONTACTS_UPDATE' },
  { name: 'Contacts Upsert', value: 'CONTACTS_UPSERT' },
  { name: 'Group Participants Update', value: 'GROUP_PARTICIPANTS_UPDATE' },
  { name: 'Group Update', value: 'GROUP_UPDATE' },
  { name: 'Groups Upsert', value: 'GROUPS_UPSERT' },
  { name: 'Instance Create', value: 'INSTANCE_CREATE' },
  { name: 'Instance Delete', value: 'INSTANCE_DELETE' },
  { name: 'Labels Association', value: 'LABELS_ASSOCIATION' },
  { name: 'Labels Edit', value: 'LABELS_EDIT' },
  { name: 'Logout Instance', value: 'LOGOUT_INSTANCE' },
  { name: 'Messages Delete', value: 'MESSAGES_DELETE' },
  { name: 'Messages Edited', value: 'MESSAGES_EDITED' },
  { name: 'Messages Set', value: 'MESSAGES_SET' },
  { name: 'Messages Update', value: 'MESSAGES_UPDATE' },
  { name: 'Messages Upsert', value: 'MESSAGES_UPSERT' },
  {
    name: 'Messaging History Set',
    value: 'MESSAGING_HISTORY_SET',
    description: `History sync batches. ${REQUIRES_24}`,
  },
  { name: 'Presence Update', value: 'PRESENCE_UPDATE' },
  { name: 'QR Code Updated', value: 'QRCODE_UPDATED' },
  { name: 'Remove Instance', value: 'REMOVE_INSTANCE' },
  { name: 'Send Message', value: 'SEND_MESSAGE' },
  { name: 'Send Message Update', value: 'SEND_MESSAGE_UPDATE' },
  { name: 'Status Instance', value: 'STATUS_INSTANCE' },
  { name: 'Typebot Change Status', value: 'TYPEBOT_CHANGE_STATUS' },
  { name: 'Typebot Start', value: 'TYPEBOT_START' },
];

/** Events that only exist on Evolution API 2.4+. */
export const EVOLUTION_24_ONLY_EVENTS = ['MESSAGING_HISTORY_SET'];

/** Presence values (presenceOnlySchema / sendPresence). */
export const PRESENCE_OPTIONS: INodePropertyOptions[] = [
  { name: 'Available', value: 'available' },
  { name: 'Composing', value: 'composing', description: 'Typing…' },
  { name: 'Paused', value: 'paused', description: 'Stopped typing or recording' },
  { name: 'Recording', value: 'recording', description: 'Recording audio…' },
  { name: 'Unavailable', value: 'unavailable' },
];

/** Integration values of /instance/create (src/api/types/wa.types.ts Integration). */
export const INTEGRATION_OPTIONS: INodePropertyOptions[] = [
  {
    name: 'Evolution Channel',
    value: 'EVOLUTION',
    description: 'Generic channel fed through POST /webhook/evolution (no WhatsApp session)',
  },
  {
    name: 'WhatsApp (Baileys)',
    value: 'WHATSAPP-BAILEYS',
    description: 'WhatsApp Web session connected with a QR code or pairing code',
  },
  {
    name: 'WhatsApp Cloud API',
    value: 'WHATSAPP-BUSINESS',
    description: 'Official Meta WhatsApp Business Cloud API',
  },
];

/**
 * Chatbot integrations mounted by src/api/integrations/chatbot/chatbot.router.ts.
 * Each one exposes /<value>/find|create|fetch/:id|update/:id|delete/:id|settings|fetchSettings|
 * changeStatus|fetchSessions/:id|ignoreJid under /:instanceName.
 */
export const BOT_TYPE_OPTIONS: INodePropertyOptions[] = [
  { name: 'Dify', value: 'dify' },
  { name: 'EvoAI', value: 'evoai' },
  { name: 'Evolution Bot', value: 'evolutionBot' },
  { name: 'Flowise', value: 'flowise' },
  { name: 'n8n', value: 'n8n' },
  { name: 'OpenAI', value: 'openai' },
  { name: 'Typebot', value: 'typebot' },
];
