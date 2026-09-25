import type {
  INodeType,
  INodeTypeDescription,
  IWebhookFunctions,
  IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { CREDENTIAL_TYPE } from './GenericFunctions';

/**
 * Evolution API Trigger — STUB (owned by the trigger agent).
 *
 * Current behavior: exposes a POST webhook and emits the received Evolution event payload
 * ({ event, instance, data, destination, date_time, sender, server_url, apikey }) as one item.
 * The webhook URL must be configured manually in Evolution (Webhook > Set) with
 * "Webhook by Events" off (by-events mode appends "/<event-name>" to the URL).
 *
 * Planned: event filter, automatic registration through POST /webhook/set on activation
 * (webhookMethods checkExists/create/delete, restoring the previous webhook on delete),
 * JWT (jwt_key, HS256) verification, MESSAGING_HISTORY_SET (2.4+) handling.
 */
export class EvolutionApiTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Evolution API Trigger',
    name: 'evolutionApiTrigger',
    icon: 'file:evolution.svg',
    group: ['trigger'],
    version: 1,
    subtitle: 'Webhook events',
    description: 'Starts the workflow when Evolution API sends a webhook event',
    defaults: {
      name: 'Evolution API Trigger',
    },
    inputs: [],
    outputs: [NodeConnectionTypes.Main],
    credentials: [
      {
        name: CREDENTIAL_TYPE,
        required: true,
      },
    ],
    webhooks: [
      {
        name: 'default',
        httpMethod: 'POST',
        responseMode: 'onReceived',
        path: 'webhook',
      },
    ],
    properties: [
      {
        displayName:
          'Preview: set the webhook URL above in Evolution API (Webhook > Set, "Webhook by Events" off). Automatic registration and event filtering are coming in a later version.',
        name: 'notice',
        type: 'notice',
        default: '',
      },
    ],
  };

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const body = this.getBodyData();
    return {
      workflowData: [this.helpers.returnJsonArray(body)],
    };
  }
}
