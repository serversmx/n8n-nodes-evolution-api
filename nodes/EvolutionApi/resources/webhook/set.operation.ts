import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import {
  evolutionApiRequest,
  isPlainObject,
  parseJsonParameter,
  resolveInstanceName,
} from '../../GenericFunctions';
import {
  includeWebhookSecretsOption,
  normalizeEvents,
  redactWebhookSecrets,
  WEBHOOK_EVENT_OPTIONS,
  withEventsHint,
} from './helpers';

const properties: INodeProperties[] = [
  {
    displayName: 'Enabled',
    name: 'webhookEnabled',
    type: 'boolean',
    default: true,
    description:
      'Whether the webhook is active. Turn it off to stop deliveries: the URL, headers and options are kept, but Evolution clears the event list.',
  },
  {
    displayName: 'URL',
    name: 'webhookUrl',
    type: 'string',
    default: '',
    placeholder: 'https://n8n.example.com/webhook/evolution',
    displayOptions: { show: { webhookEnabled: [true] } },
    description:
      'URL that receives the events (http:// or https://). Leave empty to keep the current URL. Each instance has exactly one webhook: this replaces the previous URL.',
  },
  {
    displayName: 'Events',
    name: 'webhookEvents',
    type: 'multiOptions',
    options: WEBHOOK_EVENT_OPTIONS,
    default: [],
    displayOptions: { show: { webhookEnabled: [true] } },
    description:
      'Events to send. Leave empty to receive every event. Evolution API 2.3.x rejects "Messaging History Set" with a 400 error.',
  },
  {
    displayName: 'Additional Fields',
    name: 'additionalFields',
    type: 'collection',
    placeholder: 'Add Field',
    default: {},
    displayOptions: { show: { webhookEnabled: [true] } },
    description: 'Fields not added here keep their current value',
    options: [
      {
        displayName: 'Headers (JSON)',
        name: 'headers',
        type: 'json',
        default: '{}',
        description:
          'Headers sent with every delivery, e.g. {"x-webhook-secret": "…"}. Replaces all current headers. A "jwt_key" entry is not sent as-is: Evolution signs a JWT (HS256, 10-minute expiry, claims app "evolution" and action "webhook") with it and sends "Authorization: Bearer <token>".',
      },
      {
        displayName: 'JWT Key',
        name: 'jwtKey',
        type: 'string',
        typeOptions: { password: true },
        default: '',
        description:
          'Secret used to sign the "Authorization: Bearer" JWT (HS256) of every delivery. Stored as the "jwt_key" header; the other current headers are kept unless "Headers (JSON)" is also set.',
      },
      {
        displayName: 'Webhook Base64',
        name: 'base64',
        type: 'boolean',
        default: false,
        description:
          'Whether to include received media as base64 in data.message.base64 of message events',
      },
      {
        displayName: 'Webhook by Events',
        name: 'byEvents',
        type: 'boolean',
        default: false,
        description:
          'Whether to append the event name to the URL of each delivery, e.g. …/messages-upsert',
      },
    ],
  },
  {
    displayName: 'Options',
    name: 'options',
    type: 'collection',
    placeholder: 'Add Option',
    default: {},
    options: [includeWebhookSecretsOption],
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['webhook'], operation: ['set'] } },
  properties,
);

/**
 * POST /webhook/set/:instanceName { webhook: { enabled, url, events, byEvents?, base64?, headers? } }
 * (webhookSchema, identical in 2.3.7 and 2.4). Answers 201 with the upserted Webhook row.
 * - The keys are `byEvents`/`base64`: the `webhookByEvents`/`webhookBase64` names the
 *   community node sent are silently ignored here (EVONODE-3); `find` returns the column names.
 * - `events` is always sent: with enabled=true and no `events` the controller crashes on
 *   `events.length` (HTTP 500); `[]` subscribes to every event; enabled=false stores `[]`.
 * - Keys that are not sent (byEvents, base64, headers) keep their stored value (Prisma upsert).
 * GET /webhook/find/:instanceName runs first only when the current URL or headers are needed.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const node = this.getNode();
  const instance = await resolveInstanceName.call(this, itemIndex);
  const enabled = this.getNodeParameter('webhookEnabled', itemIndex, true) as boolean;
  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

  let current: IDataObject | undefined;
  const readCurrent = async (): Promise<IDataObject> => {
    current ??= (await evolutionApiRequest.call(
      this,
      'GET',
      `/webhook/find/${instance}`,
      {},
      {},
      { itemIndex },
    )) as IDataObject;
    return current;
  };

  let webhook: IDataObject;
  if (!enabled) {
    // Keep the stored URL so the webhook can be enabled again later without retyping it.
    const { url } = await readCurrent();
    webhook = { enabled: false, url: typeof url === 'string' ? url : '', events: [] };
  } else {
    let url = String(this.getNodeParameter('webhookUrl', itemIndex, '')).trim();
    if (!url) {
      const stored = (await readCurrent()).url;
      url = typeof stored === 'string' ? stored.trim() : '';
    }
    if (!url) {
      throw new NodeOperationError(node, 'Webhook URL is required', {
        itemIndex,
        description: 'This instance has no webhook URL stored yet.',
      });
    }
    if (!/^https?:\/\//i.test(url)) {
      throw new NodeOperationError(node, `Invalid webhook URL "${url}"`, {
        itemIndex,
        description: 'Evolution API only delivers to URLs that start with http:// or https://.',
      });
    }

    webhook = {
      enabled: true,
      url,
      events: normalizeEvents(this.getNodeParameter('webhookEvents', itemIndex, [])),
    };

    const fields = this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject;
    if (fields.byEvents !== undefined) webhook.byEvents = fields.byEvents === true;
    if (fields.base64 !== undefined) webhook.base64 = fields.base64 === true;

    const jwtKey = String(fields.jwtKey ?? '').trim();
    if (fields.headers !== undefined || jwtKey) {
      let headers: IDataObject = {};
      if (fields.headers !== undefined) {
        const parsed = parseJsonParameter(fields.headers, 'Headers (JSON)') ?? {};
        if (!isPlainObject(parsed)) {
          throw new NodeOperationError(node, 'Headers (JSON) must be a JSON object', {
            itemIndex,
          });
        }
        headers = parsed;
      } else {
        const stored = (await readCurrent()).headers;
        if (isPlainObject(stored)) headers = { ...stored };
      }
      if (jwtKey) headers.jwt_key = jwtKey;
      webhook.headers = headers;
    }
  }

  let response: IDataObject;
  try {
    response = (await evolutionApiRequest.call(
      this,
      'POST',
      `/webhook/set/${instance}`,
      { webhook },
      {},
      { itemIndex },
    )) as IDataObject;
  } catch (error) {
    throw withEventsHint(error, webhook.events as string[]);
  }

  return options.includeSecrets === true ? response : redactWebhookSecrets(response);
}
