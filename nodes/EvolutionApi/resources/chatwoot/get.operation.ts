import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';
import { includeSecretsOption, redactChatwootSecrets } from './helpers';

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
  { show: { resource: ['chatwoot'], operation: ['get'] } },
  properties,
);

/**
 * GET /chatwoot/find/:instanceName
 * Returns { enabled, accountId, token, url, nameInbox, signMsg, signDelimiter, reopenConversation,
 * conversationPending, mergeBrazilContacts, importContacts, importMessages,
 * daysLimitImportMessages, organization, logo, ignoreJids, webhook_url } (number and autoCreate
 * are never returned), or { enabled: false, url: '', accountId: '', token: '', signMsg: false,
 * nameInbox: '', webhook_url: '' } when not configured. 400 "Chatwoot is disabled" when
 * CHATWOOT_ENABLED=false. The token is removed unless "Include Secrets" is on.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
  const response = (await evolutionApiRequest.call(
    this,
    'GET',
    `/chatwoot/find/${instance}`,
    {},
    {},
    { itemIndex },
  )) as IDataObject;
  return options.includeSecrets === true ? response : redactChatwootSecrets(response);
}
