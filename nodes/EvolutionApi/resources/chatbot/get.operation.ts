import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import {
  encodePathSegment,
  evolutionApiRequest,
  resolveInstanceName,
} from '../../GenericFunctions';
import { parseBotType, redactBotSecrets, secretsOptionsProperty } from './helpers';

/** "Bot Type" and "Bot" are shared fields (index.ts). */
const properties: INodeProperties[] = [secretsOptionsProperty];

export const description = updateDisplayOptions(
  { show: { resource: ['chatbot'], operation: ['get'] } },
  properties,
);

/** Fetch a bot; throws "not found" instead of returning Evolution's `null`. */
export async function fetchBot(
  this: IExecuteFunctions,
  itemIndex: number,
  instance: string,
): Promise<IDataObject> {
  const botType = parseBotType(
    this.getNode(),
    this.getNodeParameter('botType', itemIndex),
    itemIndex,
  );
  const botId = String(
    this.getNodeParameter('botId', itemIndex, '', { extractValue: true }),
  ).trim();
  const bot = (await evolutionApiRequest.call(
    this,
    'GET',
    `/${botType.value}/fetch/${encodePathSegment(botId, 'Bot ID')}/${instance}`,
    {},
    {},
    { itemIndex },
  )) as IDataObject;
  if (Object.keys(bot).length === 0) {
    throw new NodeOperationError(this.getNode(), `${botType.info.label} bot "${botId}" not found`, {
      itemIndex,
      description: 'Use Get Many with the same Bot Type to list the bots of this instance.',
    });
  }
  return bot;
}

/**
 * GET /:botType/fetch/:botId/:instanceName → the bot row (all fields, API keys included), or
 * `null` for an unknown ID (turned into an error). Evolution does not check that the bot belongs
 * to the instance in the path.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
  const bot = await fetchBot.call(this, itemIndex, instance);
  return options.includeSecrets === true ? bot : redactBotSecrets(bot);
}
