import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';
import { getRemoteJid, remoteJidProperty } from './changeStatus.operation';
import { parseBotType, withChatbotHint } from './helpers';

const properties: INodeProperties[] = [
  {
    displayName: 'Action',
    name: 'ignoreJidAction',
    type: 'options',
    options: [
      { name: 'Add', value: 'add', description: 'Bots of this type stop answering the chat' },
      { name: 'Remove', value: 'remove', description: 'Bots of this type answer the chat again' },
    ],
    default: 'add',
  },
  remoteJidProperty(
    'Chat to ignore or stop ignoring: the exact JID of the chat (…@s.whatsapp.net, …@g.us, …@lid, as in data.key.remoteJid), "@g.us" for every group or "@s.whatsapp.net" for every 1:1 chat. A phone number is turned into …@s.whatsapp.net as typed.',
  ),
];

export const description = updateDisplayOptions(
  { show: { resource: ['chatbot'], operation: ['ignoreJid'] } },
  properties,
);

/**
 * POST /:botType/ignoreJid/:instanceName { remoteJid, action: add|remove } → 200 { ignoreJids }
 * (the new list of the default settings of that integration). Answers 500 "Error setting default
 * settings" when the default settings were never saved.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const botType = parseBotType(
    this.getNode(),
    this.getNodeParameter('botType', itemIndex),
    itemIndex,
  );
  const remoteJid = getRemoteJid.call(this, itemIndex);
  const action = this.getNodeParameter('ignoreJidAction', itemIndex, 'add') as string;
  try {
    return (await evolutionApiRequest.call(
      this,
      'POST',
      `/${botType.value}/ignoreJid/${instance}`,
      { remoteJid, action },
      {},
      { itemIndex },
    )) as IDataObject;
  } catch (error) {
    throw withChatbotHint(
      error,
      `The ignore list lives in the default ${botType.info.label} settings: save them first with Set Settings.`,
    );
  }
}
