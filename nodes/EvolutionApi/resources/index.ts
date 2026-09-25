import type { INodeProperties } from 'n8n-workflow';

import type { ResourceDefinition } from '../types';
import * as call from './call';
import * as chat from './chat';
import * as chatbot from './chatbot';
import * as chatwoot from './chatwoot';
import * as group from './group';
import * as instance from './instance';
import * as label from './label';
import * as message from './message';
import * as profile from './profile';
import * as proxy from './proxy';
import * as settings from './settings';
import * as template from './template';
import * as webhook from './webhook';

/**
 * Registry of every resource of the Evolution API node, in "Resource" selector order.
 * Each module lives in resources/<value>/index.ts and is owned by one agent/maintainer:
 * adding operations never requires editing this file or EvolutionApi.node.ts.
 */
export const RESOURCES: ResourceDefinition[] = [
  {
    name: 'Call',
    value: 'call',
    description: 'Offer voice or video calls',
    module: call,
  },
  {
    name: 'Chat',
    value: 'chat',
    description: 'Check numbers and manage chats, contacts and stored messages (edit, delete, download, votes, receipts, presence, block)',
    module: chat,
  },
  {
    name: 'Chatbot',
    value: 'chatbot',
    description: 'n8n, Typebot, OpenAI, Dify, Flowise, EvoAI and Evolution Bot integrations',
    module: chatbot,
  },
  {
    name: 'Chatwoot',
    value: 'chatwoot',
    description: 'Chatwoot integration settings',
    module: chatwoot,
  },
  {
    name: 'Group',
    value: 'group',
    description: 'Create and manage WhatsApp groups',
    module: group,
  },
  {
    name: 'Instance',
    value: 'instance',
    description: 'Create, connect and manage instances',
    module: instance,
  },
  {
    name: 'Label',
    value: 'label',
    description: 'WhatsApp Business labels',
    module: label,
  },
  {
    name: 'Message',
    value: 'message',
    description: 'Send text, media, audio, locations, polls, lists and more',
    module: message,
  },
  {
    name: 'Profile',
    value: 'profile',
    description: 'Profiles, profile pictures and privacy settings',
    module: profile,
  },
  {
    name: 'Proxy',
    value: 'proxy',
    description: 'Proxy of the WhatsApp connection',
    module: proxy,
  },
  {
    name: 'Settings',
    value: 'settings',
    description: 'Instance behavior settings (reject calls, ignore groups…)',
    module: settings,
  },
  {
    name: 'Template',
    value: 'template',
    description: 'WhatsApp Cloud API message templates and the WhatsApp Business product catalog',
    module: template,
  },
  {
    name: 'Webhook',
    value: 'webhook',
    description: 'Webhook configuration of an instance',
    module: webhook,
  },
];

/** Default of the "Resource" parameter. Changing it would alter saved workflows. */
export const DEFAULT_RESOURCE = 'message';

/** The "Resource" selector. */
export const resourceProperty: INodeProperties = {
  displayName: 'Resource',
  name: 'resource',
  type: 'options',
  noDataExpression: true,
  options: RESOURCES.map(({ name, value, description }) => ({ name, value, description })),
  default: DEFAULT_RESOURCE,
};

/** Find the module of a resource value. */
export function getResourceModule(resource: string): ResourceDefinition['module'] | undefined {
  return RESOURCES.find(({ value }) => value === resource)?.module;
}
