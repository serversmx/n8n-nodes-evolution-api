import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';
import { BEHAVIOR_OPTIONS, sortOptions } from './fields';
import type { BotType } from './helpers';
import {
  collectBotFields,
  parseBotType,
  redactBotSecrets,
  secretsOptionsProperty,
  SETTINGS_DEFAULTS,
  withChatbotHint,
} from './helpers';

const properties: INodeProperties[] = [
  {
    displayName: 'Settings to Change',
    name: 'updateFields',
    type: 'collection',
    placeholder: 'Add Setting',
    default: {},
    description:
      'Only the settings added here change; the node reads the current default settings first and resends the others, because Evolution API requires all of them. They apply to every bot of this type that does not set its own value.',
    options: sortOptions([
      ...BEHAVIOR_OPTIONS,
      {
        displayName: 'Fallback Bot Name or ID',
        name: 'fallbackId',
        type: 'options',
        typeOptions: {
          loadOptionsMethod: 'chatbotGetBots',
          loadOptionsDependsOn: ['botType', 'instanceName.value'],
        },
        default: '',
        description:
          'Bot of this type that answers when no trigger matches. Choose "None" to remove it. Evolution API 2.3.7 and v2.4 never use the fallback of n8n and Dify bots (they read a field that is not stored). Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
      },
      {
        displayName: 'OpenAI Credential Name or ID',
        name: 'openaiCredsId',
        type: 'options',
        typeOptions: {
          loadOptionsMethod: 'chatbotGetOpenaiCredentials',
          loadOptionsDependsOn: ['instanceName.value'],
        },
        default: '',
        displayOptions: { show: { '/botType': ['openai'] } },
        description:
          'Default OpenAI API key of the instance, also used by Get OpenAI Models and speech to text. Required for OpenAI settings. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
      },
      {
        displayName: 'Speech to Text',
        name: 'speechToText',
        type: 'boolean',
        default: false,
        displayOptions: { show: { '/botType': ['openai'] } },
        description:
          'Whether to transcribe audio messages with OpenAI Whisper. The text is added to the message as "speechToText" (webhooks, stored messages and bots).',
      },
    ]),
  },
  secretsOptionsProperty,
];

export const description = updateDisplayOptions(
  { show: { resource: ['chatbot'], operation: ['setSettings'] } },
  properties,
);

/** Strings the n8n/Dify/EvoAI/Evolution Bot settings schemas reject when empty (isNotEmpty). */
const NOT_EMPTY_KEYS = ['keywordFinish', 'unknownMessage'];

/**
 * Merge GET /:botType/fetchSettings (current; null columns and missing settings fall back to
 * Evolution's defaults) with the user's changes into a full settings body, without the fallback
 * bot (see planSettingsRequests). OpenAI also needs openaiCredsId (required) and takes
 * speechToText.
 */
export function buildSettingsBody(
  current: IDataObject,
  changes: IDataObject,
  botType: BotType,
): IDataObject {
  const converted = collectBotFields(changes, botType);
  const body: IDataObject = {};
  for (const [key, fallback] of Object.entries(SETTINGS_DEFAULTS)) {
    // Null columns (settings created by a bot create) fall back to Evolution's defaults.
    body[key] = converted[key] !== undefined ? converted[key] : (current[key] ?? fallback);
  }

  if (botType === 'openai') {
    const credsId = converted.openaiCredsId ?? current.openaiCredsId;
    if (typeof credsId === 'string' && credsId) body.openaiCredsId = credsId;
    const speechToText = converted.speechToText ?? current.speechToText;
    if (typeof speechToText === 'boolean') body.speechToText = speechToText;
  }
  return body;
}

/** The fallback bot to store: the added value ("None"/empty → null), else the stored one. */
export function resolveFallbackId(current: IDataObject, changes: IDataObject): string | null {
  const value = changes.fallbackId !== undefined ? changes.fallbackId : current.fallbackId;
  const fallbackId = typeof value === 'string' ? value.trim() : '';
  return fallbackId || null;
}

/**
 * Bodies to POST to /:botType/settings, in order. The default bot travels as `fallbackId`, the
 * only name BaseChatbotController#settings reads (the schema-documented <bot>IdFallback names
 * are ignored), and the controller writes it to the scalar column <bot>IdFallback. Prisma
 * rejects that scalar next to a relation `connect` in the same write, which the controller adds
 * - on the first save (the row is created with `Instance: { connect }`), and
 * - on every OpenAI save (`OpenaiCreds: { connect }` whenever openaiCredsId is not empty),
 * so those writes answer HTTP 500 "Error setting default settings" when fallbackId is sent. The
 * fallback therefore goes in a second write that only updates columns: after the row exists,
 * and for OpenAI with an empty openaiCredsId (the stored credential is then left untouched).
 * Sending fallbackId on an update (current value, or null to remove it) also keeps the
 * n8n/Dify/EvoAI/Evolution Bot "cannot be empty" checks away from keywordFinish/unknownMessage;
 * a first save without it gets Evolution's defaults for empty ones until the second write.
 */
export function planSettingsRequests(
  current: IDataObject,
  changes: IDataObject,
  botType: BotType,
): IDataObject[] {
  const body = buildSettingsBody(current, changes, botType);
  const fallbackId = resolveFallbackId(current, changes);

  if (botType === 'openai') {
    if (changes.fallbackId === undefined) return [body];
    return [body, { ...body, openaiCredsId: '', fallbackId }];
  }

  // fetchSettings answers the stored row (with its id) or Evolution's defaults (without one).
  const exists = typeof current.id === 'string' && current.id !== '';
  if (exists) return [{ ...body, fallbackId }];

  const hasEmpty = NOT_EMPTY_KEYS.some((key) => body[key] === '');
  if (fallbackId === null && !hasEmpty) return [body];
  const first: IDataObject = { ...body };
  for (const key of NOT_EMPTY_KEYS) {
    if (first[key] === '') first[key] = SETTINGS_DEFAULTS[key];
  }
  return [first, { ...body, fallbackId }];
}

/**
 * GET /:botType/fetchSettings/:instanceName, merge, then POST /:botType/settings/:instanceName
 * (<bot>SettingSchema, identical in 2.3.7 and 2.4) once, or twice when the fallback bot needs
 * its own write (planSettingsRequests) → 200 with the settings row + fallbackId of the last write.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const node = this.getNode();
  const instance = await resolveInstanceName.call(this, itemIndex);
  const botType = parseBotType(node, this.getNodeParameter('botType', itemIndex), itemIndex);
  const changes = this.getNodeParameter('updateFields', itemIndex, {}) as IDataObject;
  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

  if (Object.keys(changes).length === 0) {
    throw new NodeOperationError(node, 'Add at least one setting to change', {
      itemIndex,
      description: 'Use "Settings to Change" to pick the default settings to update.',
    });
  }

  const current = (await evolutionApiRequest.call(
    this,
    'GET',
    `/${botType.value}/fetchSettings/${instance}`,
    {},
    {},
    { itemIndex },
  )) as IDataObject;

  const bodies = planSettingsRequests(current, changes, botType.value);
  if (botType.value === 'openai' && !bodies[0].openaiCredsId) {
    throw new NodeOperationError(node, 'OpenAI Credential is required for OpenAI settings', {
      itemIndex,
      description:
        'Add "OpenAI Credential" under "Settings to Change" (create one with Create OpenAI Credential).',
    });
  }

  let settings: IDataObject = {};
  for (const body of bodies) {
    try {
      settings = (await evolutionApiRequest.call(
        this,
        'POST',
        `/${botType.value}/settings/${instance}`,
        body,
        {},
        { itemIndex },
      )) as IDataObject;
    } catch (error) {
      throw withChatbotHint(
        error,
        `Check that the fallback bot is a ${botType.info.label} bot of this instance${
          botType.value === 'openai' ? ' and that the OpenAI credential exists' : ''
        }.`,
      );
    }
  }
  return options.includeSecrets === true ? settings : redactBotSecrets(settings);
}
