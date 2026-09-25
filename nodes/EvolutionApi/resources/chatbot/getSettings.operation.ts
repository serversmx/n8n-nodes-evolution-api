import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';
import { parseBotType, redactBotSecrets, secretsOptionsProperty } from './helpers';

const properties: INodeProperties[] = [secretsOptionsProperty];

export const description = updateDisplayOptions(
  { show: { resource: ['chatbot'], operation: ['getSettings'] } },
  properties,
);

/**
 * GET /:botType/fetchSettings/:instanceName → the default settings of that integration
 * { expire, keywordFinish, delayMessage, unknownMessage, listeningFromMe, stopBotFromMe, keepOpen,
 * debounceTime, ignoreJids, splitMessages, timePerChar, …, fallbackId, fallback (bot row) }, or
 * Evolution's built-in defaults (without an "id") when they were never saved.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const botType = parseBotType(
    this.getNode(),
    this.getNodeParameter('botType', itemIndex),
    itemIndex,
  );
  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
  const settings = (await evolutionApiRequest.call(
    this,
    'GET',
    `/${botType.value}/fetchSettings/${instance}`,
    {},
    {},
    { itemIndex },
  )) as IDataObject;
  return options.includeSecrets === true ? settings : redactBotSecrets(settings);
}
