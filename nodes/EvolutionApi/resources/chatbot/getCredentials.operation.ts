import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName, toArray } from '../../GenericFunctions';
import { redactBotSecrets, secretsOptionsProperty } from './helpers';

const properties: INodeProperties[] = [secretsOptionsProperty];

export const description = updateDisplayOptions(
  { show: { resource: ['chatbot'], operation: ['getCredentials'] } },
  properties,
);

/**
 * GET /openai/creds/:instanceName → array of OpenaiCreds { id, name, apiKey, createdAt,
 * updatedAt, instanceId, OpenaiAssistant: [bots using it] }, one item each. The API keys come
 * back in clear text and are removed unless "Include Secrets" is on.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject[]> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
  const response = await evolutionApiRequest.call(
    this,
    'GET',
    `/openai/creds/${instance}`,
    {},
    {},
    { itemIndex },
  );
  const credentials = toArray(response);
  return options.includeSecrets === true ? credentials : redactBotSecrets(credentials);
}
