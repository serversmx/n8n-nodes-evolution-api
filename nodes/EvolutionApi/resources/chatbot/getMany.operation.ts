import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { BOT_TYPE_OPTIONS } from '../../constants';
import { evolutionApiRequest, resolveInstanceName, toArray } from '../../GenericFunctions';

const properties: INodeProperties[] = [
  {
    displayName: 'Bot Type',
    name: 'botType',
    type: 'options',
    options: BOT_TYPE_OPTIONS,
    default: 'n8n',
    description: 'Chatbot integration to query',
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['chatbot'], operation: ['getMany'] } },
  properties,
);

/**
 * GET /:botType/find/:instanceName → array of bots of that integration for the instance.
 * Answers 400 "<Integration> is disabled" when the integration is off on the server
 * (e.g. N8N_ENABLED=false).
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject[]> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const botType = this.getNodeParameter('botType', itemIndex) as string;
  const response = await evolutionApiRequest.call(
    this,
    'GET',
    `/${encodeURIComponent(botType)}/find/${instance}`,
    {},
    {},
    { itemIndex },
  );
  return toArray(response);
}
