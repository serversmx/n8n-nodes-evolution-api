import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName, toArray } from '../../GenericFunctions';
import { openaiCredentialProperty } from './fields';
import { withChatbotHint } from './helpers';

const properties: INodeProperties[] = [
  {
    displayName: 'Options',
    name: 'options',
    type: 'collection',
    placeholder: 'Add Option',
    default: {},
    options: [
      {
        ...openaiCredentialProperty,
        required: false,
        description:
          'Credential whose API key lists the models. Defaults to the credential of the OpenAI settings. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
      },
    ],
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['chatbot'], operation: ['getModels'] } },
  properties,
);

/**
 * GET /openai/getModels/:instanceName[?openaiCredsId=] → array of OpenAI models
 * { id, object, created, owned_by }, one item each. Without a credential Evolution uses the one
 * of the OpenAI settings (500 "Settings not found" / "OpenAI credentials not found" otherwise).
 * openaiCredsId is the only query parameter sent (EVOAPI-3: never forward arbitrary ones).
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject[]> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
  const credsId = String(options.openaiCredsId ?? '').trim();
  try {
    const response = await evolutionApiRequest.call(
      this,
      'GET',
      `/openai/getModels/${instance}`,
      {},
      credsId ? { openaiCredsId: credsId } : {},
      { itemIndex },
    );
    return toArray(response);
  } catch (error) {
    throw withChatbotHint(
      error,
      'Pick an OpenAI credential, or set one in the OpenAI settings (Set Settings with Bot Type "OpenAI").',
    );
  }
}
