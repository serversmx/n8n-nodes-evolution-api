import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';
import { includeWebhookSecretsOption, redactWebhookSecrets } from './helpers';

const properties: INodeProperties[] = [
  {
    displayName: 'Options',
    name: 'options',
    type: 'collection',
    placeholder: 'Add Option',
    default: {},
    options: [includeWebhookSecretsOption],
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['webhook'], operation: ['get'] } },
  properties,
);

/**
 * GET /webhook/find/:instanceName
 * Returns the Webhook row { id, url, headers, enabled, events, webhookByEvents, webhookBase64,
 * createdAt, updatedAt, instanceId } or an empty body (→ {}) when no webhook is set.
 * `headers.jwt_key` comes back in clear text and is removed unless "Include Secrets" is on.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
  const response = (await evolutionApiRequest.call(
    this,
    'GET',
    `/webhook/find/${instance}`,
    {},
    {},
    { itemIndex },
  )) as IDataObject;
  return options.includeSecrets === true ? response : redactWebhookSecrets(response);
}
