import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeApiError, NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';
import {
  includeSecretsOption,
  OPTIONAL_STRING_KEYS,
  redactSettingsSecrets,
  REQUIRED_BOOLEAN_KEYS,
} from './helpers';

const properties: INodeProperties[] = [
  {
    displayName: 'Settings to Change',
    name: 'updateFields',
    type: 'collection',
    placeholder: 'Add Setting',
    default: {},
    description:
      'Only the settings added here change; every other setting keeps its current value. The node reads the current settings first because Evolution API requires all of them on each update.',
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
        description:
          'Message sent to the caller when "Reject Calls" is on. Leave empty to reject without a message.',
      },
      {
        displayName: 'Ignore Groups',
        name: 'groupsIgnore',
        type: 'boolean',
        default: false,
        description:
          'Whether to ignore group messages entirely: they are not stored, not sent to webhooks and do not reach Chatwoot or chatbots',
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
        description:
          "Whether to receive contacts' status updates and mark them as seen automatically. When off, status updates are ignored.",
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
        description:
          'Whether to request the full chat history from the phone. Applies the next time the session connects.',
      },
      {
        displayName: 'Wavoip Token',
        name: 'wavoipToken',
        type: 'string',
        typeOptions: { password: true },
        default: '',
        description:
          'WhatsApp Baileys only; connect the instance before setting this token. While a token is stored, Evolution reconnects the socket on every settings update. Add this field with an empty value to clear it if updates fail on an unconnected or non-Baileys instance.',
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
  { show: { resource: ['settings'], operation: ['set'] } },
  properties,
);

/**
 * Merge the current settings (GET /settings/find, `{}` when none exist yet) with the fields the
 * user changed. The six booleans are required by settingsSchema; missing ones default to false,
 * as on /instance/create. msgCall and wavoipToken are resent too: channel.service.ts#setSettings
 * copies every key into the in-memory settings, so leaving them out would drop them until the
 * next reconnect.
 */
export function buildSettingsBody(current: IDataObject, changes: IDataObject): IDataObject {
  const body: IDataObject = {};
  for (const key of REQUIRED_BOOLEAN_KEYS) {
    const value = changes[key] ?? current[key];
    body[key] = value === true;
  }
  for (const key of OPTIONAL_STRING_KEYS) {
    const value = changes[key] !== undefined ? changes[key] : current[key];
    if (typeof value === 'string') body[key] = value;
  }
  return body;
}

/**
 * GET /settings/find/:instanceName, then POST /settings/set/:instanceName with every setting
 * (settingsSchema requires the six booleans, 2.3.7 and 2.4). Answers 201
 * { settings: { instanceName, settings: {...as sent} } }.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const changes = this.getNodeParameter('updateFields', itemIndex, {}) as IDataObject;
  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

  if (Object.keys(changes).length === 0) {
    throw new NodeOperationError(this.getNode(), 'Add at least one setting to change', {
      itemIndex,
      description: 'Use "Settings to Change" to pick the settings to update.',
    });
  }

  const current = (await evolutionApiRequest.call(
    this,
    'GET',
    `/settings/find/${instance}`,
    {},
    {},
    { itemIndex },
  )) as IDataObject;

  const body = buildSettingsBody(current, changes);
  let response: IDataObject;
  try {
    response = (await evolutionApiRequest.call(
      this,
      'POST',
      `/settings/set/${instance}`,
      body,
      {},
      { itemIndex },
    )) as IDataObject;
  } catch (caughtError) {
    // evolutionApiRequest only ever throws NodeApiError or NodeOperationError (never a
    // raw error), so this augments and re-throws the same error object; `apiError` is a
    // local binding (not the catch parameter itself) so this isn't a raw-error rethrow.
    const apiError = caughtError;
    if (apiError instanceof NodeApiError && apiError.httpCode === '500' && body.wavoipToken) {
      apiError.description =
        `Wavoip requires a connected WhatsApp Baileys socket. Evolution may already have saved these settings before failing. Add Wavoip Token with an empty value to clear it, or connect the Baileys instance before retrying. ${apiError.description ?? ''}`.trim();
    }
    throw apiError;
  }

  return options.includeSecrets === true ? response : redactSettingsSecrets(response);
}
