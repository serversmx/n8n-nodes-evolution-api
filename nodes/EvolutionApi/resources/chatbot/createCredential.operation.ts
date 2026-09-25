import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';
import { redactBotSecrets, secretsOptionsProperty } from './helpers';

const properties: INodeProperties[] = [
  {
    displayName: 'Name',
    name: 'openaiCredentialName',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'main-openai-key',
    description: 'Unique name of the credential on this instance',
  },
  {
    displayName: 'OpenAI API Key',
    name: 'openaiApiKey',
    type: 'string',
    typeOptions: { password: true },
    required: true,
    default: '',
    placeholder: 'sk-…',
    description: 'OpenAI API key. The same key cannot be stored twice on the server.',
  },
  secretsOptionsProperty,
];

export const description = updateDisplayOptions(
  { show: { resource: ['chatbot'], operation: ['createCredential'] } },
  properties,
);

/**
 * POST /openai/creds/:instanceName { name, apiKey } (openaiCredsSchema, identical in 2.3.7 and
 * 2.4) → 201 OpenaiCreds row { id, name, apiKey, createdAt, updatedAt, instanceId }.
 * 400 when the key is already stored or the name is taken on the instance; 400 "Openai is
 * disabled" when OPENAI_ENABLED=false.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const name = String(this.getNodeParameter('openaiCredentialName', itemIndex, '')).trim();
  const apiKey = String(this.getNodeParameter('openaiApiKey', itemIndex, '')).trim();
  if (!name || !apiKey) {
    throw new NodeOperationError(this.getNode(), 'Name and OpenAI API Key are required', {
      itemIndex,
    });
  }
  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
  const response = (await evolutionApiRequest.call(
    this,
    'POST',
    `/openai/creds/${instance}`,
    { name, apiKey },
    {},
    { itemIndex },
  )) as IDataObject;
  return options.includeSecrets === true ? response : redactBotSecrets(response);
}
