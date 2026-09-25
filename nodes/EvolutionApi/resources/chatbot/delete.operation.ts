import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';

import {
  encodePathSegment,
  evolutionApiRequest,
  resolveInstanceName,
} from '../../GenericFunctions';
import { parseBotType, withChatbotHint } from './helpers';

/** No fields besides the shared "Bot Type" and "Bot" (index.ts). */
export const description: INodeProperties[] = [];

/**
 * DELETE /:botType/delete/:botId/:instanceName → { bot: { id } }. Also deletes every session of
 * the bot. A bot that does not exist or belongs to another instance answers 500
 * "Error deleting <Integration> bot".
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const botType = parseBotType(
    this.getNode(),
    this.getNodeParameter('botType', itemIndex),
    itemIndex,
  );
  const botId = String(
    this.getNodeParameter('botId', itemIndex, '', { extractValue: true }),
  ).trim();
  try {
    return (await evolutionApiRequest.call(
      this,
      'DELETE',
      `/${botType.value}/delete/${encodePathSegment(botId, 'Bot ID')}/${instance}`,
      {},
      {},
      { itemIndex },
    )) as IDataObject;
  } catch (error) {
    throw withChatbotHint(
      error,
      `Check that the ${botType.info.label} bot "${botId}" exists on this instance (Get Many).`,
    );
  }
}
