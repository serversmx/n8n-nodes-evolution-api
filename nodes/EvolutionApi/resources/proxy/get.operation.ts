import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';
import { includeSecretsOption, redactProxySecrets } from './helpers';

const properties: INodeProperties[] = [
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
  { show: { resource: ['proxy'], operation: ['get'] } },
  properties,
);

/**
 * GET /proxy/find/:instanceName
 * Returns the Proxy row { id, enabled, host, port, protocol, username, password, createdAt,
 * updatedAt, instanceId }, or an empty body (→ {}) when no proxy was ever set.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
  const response = (await evolutionApiRequest.call(
    this,
    'GET',
    `/proxy/find/${instance}`,
    {},
    {},
    { itemIndex },
  )) as IDataObject;
  return options.includeSecrets === true ? response : redactProxySecrets(response);
}
