import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import { PRESENCE_OPTIONS } from '../../constants';
import { evolutionApiRequest, normalizeNumber, resolveInstanceName } from '../../GenericFunctions';

/** Extra time on top of the presence duration before the HTTP request times out. */
const TIMEOUT_MARGIN_MS = 60000;

const properties: INodeProperties[] = [
  {
    displayName: 'Number',
    name: 'number',
    type: 'string',
    required: true,
    default: '',
    placeholder: '5215512345678',
    description:
      'Chat that sees the indicator: phone number with country code, or a JID (…@s.whatsapp.net, group …@g.us, …@lid)',
  },
  {
    displayName: 'Presence',
    name: 'presence',
    type: 'options',
    options: PRESENCE_OPTIONS,
    default: 'composing',
    description:
      'Indicator to show in the chat, e.g. "typing…" (Composing) or "recording audio…" (Recording)',
  },
  {
    displayName: 'Duration (Ms)',
    name: 'delay',
    type: 'number',
    required: true,
    typeOptions: { minValue: 0 },
    default: 1000,
    description:
      'How long to show the presence, in milliseconds. The request stays open this long, then Evolution sends "paused".',
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['chat'], operation: ['sendPresence'] } },
  properties,
);

/**
 * POST /chat/sendPresence/:instanceName { number, presence, delay } (presenceSchema, 201) → { presence }.
 * `delay` is schema-required; the request blocks for `delay` ms (in 20 s steps above 20 s).
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const number = normalizeNumber(this.getNodeParameter('number', itemIndex, ''));
  if (!number) {
    throw new NodeOperationError(this.getNode(), 'Number is required', { itemIndex });
  }
  const presence = String(this.getNodeParameter('presence', itemIndex, 'composing'));
  const delay = Math.max(0, Math.round(Number(this.getNodeParameter('delay', itemIndex, 1000))));
  if (!Number.isFinite(delay)) {
    throw new NodeOperationError(this.getNode(), 'Duration must be a number of milliseconds', {
      itemIndex,
    });
  }

  return (await evolutionApiRequest.call(
    this,
    'POST',
    `/chat/sendPresence/${instance}`,
    { number, presence, delay },
    {},
    { itemIndex, timeout: delay + TIMEOUT_MARGIN_MS },
  )) as IDataObject;
}
