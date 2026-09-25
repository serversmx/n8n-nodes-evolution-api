import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';
import { includeSecretsOption, redactSettingsSecrets } from './helpers';

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
  { show: { resource: ['settings'], operation: ['get'] } },
  properties,
);

/**
 * GET /settings/find/:instanceName
 * Returns { rejectCall, msgCall, groupsIgnore, alwaysOnline, readMessages, readStatus,
 * syncFullHistory, wavoipToken }, or an empty body (→ {}) when the instance has no settings row.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
  const response = (await evolutionApiRequest.call(
    this,
    'GET',
    `/settings/find/${instance}`,
    {},
    {},
    { itemIndex },
  )) as IDataObject;
  return options.includeSecrets === true ? response : redactSettingsSecrets(response);
}
