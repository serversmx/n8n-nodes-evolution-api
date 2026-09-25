import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';
import { getRemoteJid, remoteJidProperty } from './changeStatus.operation';
import { withChatbotHint } from './helpers';

const properties: INodeProperties[] = [
  remoteJidProperty(
    'Contact that receives the flow: phone number with country code or full JID (…@s.whatsapp.net, …@g.us, …@lid)',
  ),
  {
    displayName: 'Typebot URL',
    name: 'typebotUrl',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'https://typebot.example.com',
    description: 'Base URL of the Typebot viewer (the server that serves the published bot)',
  },
  {
    displayName: 'Typebot Public ID',
    name: 'typebotPublicId',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'my-typebot-abc123',
    description: 'Public ID of the published Typebot (Share > the last part of the link)',
  },
  {
    displayName: 'Start Session',
    name: 'typebotStartSession',
    type: 'boolean',
    default: false,
    description:
      "Whether to start a tracked session so the contact's replies continue the flow: Evolution finds (or creates) a Typebot bot for this URL and public ID and deletes the contact's other bot sessions on this instance. When off, Evolution only sends the first messages of the flow.",
  },
  {
    displayName: 'Variables',
    name: 'typebotVariables',
    type: 'fixedCollection',
    typeOptions: { multipleValues: true },
    placeholder: 'Add Variable',
    default: {},
    description: 'Prefilled variables of the flow',
    options: [
      {
        displayName: 'Variable',
        name: 'variable',
        values: [
          {
            displayName: 'Name',
            name: 'name',
            type: 'string',
            default: '',
            description: 'Variable name as defined in Typebot',
          },
          {
            displayName: 'Value',
            name: 'value',
            type: 'string',
            default: '',
          },
        ],
      },
    ],
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['chatbot'], operation: ['start'] } },
  properties,
);

/**
 * POST /typebot/start/:instanceName { remoteJid, url, typebot, startSession, variables: [{ name,
 * value }] } (typebotStartSchema, identical in 2.3.7 and 2.4) → 200 { typebot: { instanceName,
 * typebot: { url, remoteJid, typebot, prefilledVariables } } } and a TYPEBOT_START event.
 * The Typebot default settings must exist (otherwise HTTP 500). Without startSession, a failure
 * of the Typebot API is swallowed and the body is empty: that is turned into an error.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const node = this.getNode();
  const instance = await resolveInstanceName.call(this, itemIndex);
  const remoteJid = getRemoteJid.call(this, itemIndex);
  const url = String(this.getNodeParameter('typebotUrl', itemIndex, '')).trim();
  const typebot = String(this.getNodeParameter('typebotPublicId', itemIndex, '')).trim();
  if (!url || !typebot) {
    throw new NodeOperationError(node, 'Typebot URL and Typebot Public ID are required', {
      itemIndex,
    });
  }

  const variables = (
    (this.getNodeParameter('typebotVariables.variable', itemIndex, []) as IDataObject[]) ?? []
  )
    .map((variable) => ({
      name: String(variable.name ?? '').trim(),
      value: String(variable.value ?? ''),
    }))
    .filter((variable) => variable.name);

  const body: IDataObject = {
    remoteJid,
    // Sent as typed: with startSession Evolution looks the bot up by exact url + typebot.
    url,
    typebot,
    startSession: this.getNodeParameter('typebotStartSession', itemIndex, false) === true,
  };
  if (variables.length > 0) body.variables = variables;

  let response: IDataObject;
  try {
    response = (await evolutionApiRequest.call(
      this,
      'POST',
      `/typebot/start/${instance}`,
      body,
      {},
      { itemIndex },
    )) as IDataObject;
  } catch (error) {
    throw withChatbotHint(
      error,
      'Save the Typebot default settings first (Set Settings with Bot Type "Typebot").',
    );
  }

  if (Object.keys(response).length === 0) {
    throw new NodeOperationError(node, 'Evolution API could not start the Typebot flow', {
      itemIndex,
      description:
        'The Typebot server rejected the request or is unreachable from Evolution API. Check the Typebot URL and public ID (see the Evolution API logs).',
    });
  }
  return response;
}
