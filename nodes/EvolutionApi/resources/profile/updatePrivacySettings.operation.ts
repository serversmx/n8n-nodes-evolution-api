import type {
  IDataObject,
  IExecuteFunctions,
  INodeProperties,
  INodePropertyOptions,
} from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, isPlainObject, resolveInstanceName } from '../../GenericFunctions';

const AUDIENCE_OPTIONS: INodePropertyOptions[] = [
  { name: 'Everyone', value: 'all' },
  { name: 'My Contacts', value: 'contacts' },
  { name: 'My Contacts Except…', value: 'contact_blacklist' },
  { name: 'Nobody', value: 'none' },
];

/** Allowed values of each privacySettingsSchema field (all six are required by Evolution). */
export const PRIVACY_SETTING_VALUES: Record<string, string[]> = {
  readreceipts: ['all', 'none'],
  profile: ['all', 'contacts', 'contact_blacklist', 'none'],
  status: ['all', 'contacts', 'contact_blacklist', 'none'],
  online: ['all', 'match_last_seen'],
  last: ['all', 'contacts', 'contact_blacklist', 'none'],
  groupadd: ['all', 'contacts', 'contact_blacklist', 'none'],
};

const properties: INodeProperties[] = [
  {
    displayName: 'Settings to Change',
    name: 'privacySettings',
    type: 'collection',
    placeholder: 'Add Setting',
    default: {},
    description:
      'Only the settings you add are changed: the node reads the current privacy settings first and sends them back with your changes',
    options: [
      {
        displayName: 'Add Me to Groups',
        name: 'groupadd',
        type: 'options',
        options: AUDIENCE_OPTIONS,
        default: 'contacts',
        description: 'Who can add the account to groups',
      },
      {
        displayName: 'Last Seen',
        name: 'last',
        type: 'options',
        options: AUDIENCE_OPTIONS,
        default: 'contacts',
        description: 'Who can see when the account was last online',
      },
      {
        displayName: 'Online',
        name: 'online',
        type: 'options',
        options: [
          { name: 'Everyone', value: 'all' },
          { name: 'Same as Last Seen', value: 'match_last_seen' },
        ],
        default: 'all',
        description: 'Who can see when the account is online',
      },
      {
        displayName: 'Profile Picture',
        name: 'profile',
        type: 'options',
        options: AUDIENCE_OPTIONS,
        default: 'contacts',
        description: 'Who can see the profile picture',
      },
      {
        displayName: 'Read Receipts',
        name: 'readreceipts',
        type: 'options',
        options: [
          { name: 'Off', value: 'none' },
          { name: 'On', value: 'all' },
        ],
        default: 'all',
        description: 'Whether to send read receipts (blue ticks)',
      },
      {
        displayName: 'Status',
        name: 'status',
        type: 'options',
        options: AUDIENCE_OPTIONS,
        default: 'contacts',
        description: 'Who can see the Status (stories) posts',
      },
    ],
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['profile'], operation: ['updatePrivacySettings'] } },
  properties,
);

/**
 * Read, merge, write: GET /chat/fetchPrivacySettings/:instanceName (skipped when all six are
 * given), then
 * POST /chat/updatePrivacySettings/:instanceName { readreceipts, profile, status, online, last,
 * groupadd } (privacySettingsSchema requires all six, 201) → { update: 'success', data: {…} }.
 * Evolution reloads the WhatsApp connection afterwards (a few seconds offline).
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const changes = this.getNodeParameter('privacySettings', itemIndex, {}) as IDataObject;

  const requested: IDataObject = {};
  for (const [field, allowed] of Object.entries(PRIVACY_SETTING_VALUES)) {
    const value = changes[field];
    if (value === undefined || value === null || value === '') continue;
    if (!allowed.includes(String(value))) {
      throw new NodeOperationError(this.getNode(), `Invalid value "${value}" for "${field}"`, {
        itemIndex,
        description: `Allowed values: ${allowed.join(', ')}.`,
      });
    }
    requested[field] = String(value);
  }
  if (Object.keys(requested).length === 0) {
    throw new NodeOperationError(this.getNode(), 'Add at least one setting to change', {
      itemIndex,
    });
  }

  // Nothing to merge when all six are given.
  const complete = Object.keys(PRIVACY_SETTING_VALUES).every((field) => field in requested);
  const current = complete
    ? {}
    : await evolutionApiRequest.call(
        this,
        'GET',
        `/chat/fetchPrivacySettings/${instance}`,
        {},
        {},
        { itemIndex },
      );

  const body: IDataObject = {};
  const missing: string[] = [];
  for (const [field, allowed] of Object.entries(PRIVACY_SETTING_VALUES)) {
    const currentValue = isPlainObject(current) ? current[field] : undefined;
    if (requested[field] !== undefined) body[field] = requested[field];
    else if (typeof currentValue === 'string' && allowed.includes(currentValue)) {
      body[field] = currentValue;
    } else missing.push(field);
  }
  if (missing.length > 0) {
    throw new NodeOperationError(
      this.getNode(),
      `Could not read the current value of: ${missing.join(', ')}`,
      {
        itemIndex,
        description:
          'Evolution requires all six privacy settings. Add the missing ones to "Settings to Change".',
      },
    );
  }

  return (await evolutionApiRequest.call(
    this,
    'POST',
    `/chat/updatePrivacySettings/${instance}`,
    body,
    {},
    { itemIndex },
  )) as IDataObject;
}
