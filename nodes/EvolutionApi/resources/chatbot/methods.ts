import type {
  IDataObject,
  ILoadOptionsFunctions,
  INodeListSearchResult,
  INodePropertyOptions,
} from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceNameFromValue, toArray } from '../../GenericFunctions';
import type { ResourceMethods } from '../../types';
import { parseBotType } from './helpers';

async function currentInstance(this: ILoadOptionsFunctions): Promise<string> {
  return await resolveInstanceNameFromValue.call(
    this,
    this.getCurrentNodeParameter('instanceName', { extractValue: true }),
  );
}

/** Bots of the selected type on the selected instance (GET /:botType/find/:instanceName). */
async function listBots(this: ILoadOptionsFunctions): Promise<IDataObject[]> {
  const botType = parseBotType(this.getNode(), this.getCurrentNodeParameter('botType'));
  const instance = await currentInstance.call(this);
  return toArray(await evolutionApiRequest.call(this, 'GET', `/${botType.value}/find/${instance}`));
}

/** "Description (trigger)" label of a bot, e.g. "Sales bot (keyword: hi)". */
function botLabel(bot: IDataObject): string {
  const name = String(bot.description || bot.id || '').trim();
  const trigger = bot.triggerValue
    ? `${String(bot.triggerType)}: ${String(bot.triggerValue)}`
    : String(bot.triggerType ?? '');
  const disabled = bot.enabled === false ? ', disabled' : '';
  return trigger || disabled ? `${name} (${trigger}${disabled})` : name;
}

export const methods: ResourceMethods = {
  listSearch: {
    /** "Bot" resource locator. */
    async chatbotSearchBots(
      this: ILoadOptionsFunctions,
      filter?: string,
    ): Promise<INodeListSearchResult> {
      const needle = (filter ?? '').trim().toLowerCase();
      const results = (await listBots.call(this))
        .filter((bot) => bot.id)
        .map((bot) => ({ name: botLabel(bot), value: String(bot.id) }))
        .filter(
          (bot) =>
            !needle ||
            bot.name.toLowerCase().includes(needle) ||
            bot.value.toLowerCase().includes(needle),
        )
        .sort((a, b) => a.name.localeCompare(b.name));
      return { results };
    },
  },
  loadOptions: {
    /** "Fallback Bot" of Set Settings: the bots of the selected type, plus "None". */
    async chatbotGetBots(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
      const bots = (await listBots.call(this))
        .filter((bot) => bot.id)
        .map((bot) => ({ name: botLabel(bot), value: String(bot.id) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return [{ name: 'None', value: '', description: 'No fallback bot' }, ...bots];
    },

    /** OpenAI credentials stored on the selected instance (GET /openai/creds/:instanceName). */
    async chatbotGetOpenaiCredentials(
      this: ILoadOptionsFunctions,
    ): Promise<INodePropertyOptions[]> {
      const instance = await currentInstance.call(this);
      const credentials = toArray(
        await evolutionApiRequest.call(this, 'GET', `/openai/creds/${instance}`),
      );
      return credentials
        .filter((credential) => credential.id)
        .map((credential) => ({
          name: String(credential.name || credential.id),
          value: String(credential.id),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  },
};
