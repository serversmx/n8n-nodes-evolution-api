import type {
  IDataObject,
  IExecuteFunctions,
  ILoadOptionsFunctions,
  INodeListSearchResult,
  INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
  evolutionApiRequest,
  normalizeNumber,
  resolveInstanceName,
  resolveInstanceNameFromValue,
  toArray,
} from '../../GenericFunctions';

/** Fields of Add to Chat / Remove from Chat (scoped by the operation files). */
export const handleLabelProperties: INodeProperties[] = [
  {
    displayName: 'Chat',
    name: 'number',
    type: 'string',
    required: true,
    default: '',
    placeholder: '5215512345678',
    description:
      'Phone number with country code, or the JID of the chat (…@s.whatsapp.net, group …@g.us)',
  },
  {
    displayName: 'Label',
    name: 'labelId',
    type: 'resourceLocator',
    required: true,
    default: { mode: 'list', value: '' },
    description: 'WhatsApp Business label. Use Label > Get Many to list the label IDs.',
    modes: [
      {
        displayName: 'From List',
        name: 'list',
        type: 'list',
        placeholder: 'Select a label...',
        typeOptions: {
          searchListMethod: 'labelSearchLabels',
          searchable: true,
        },
      },
      {
        displayName: 'By ID',
        name: 'id',
        type: 'string',
        placeholder: 'e.g. 1',
      },
    ],
  },
];

/**
 * POST /label/handleLabel/:instanceName { number, labelId, action: 'add' | 'remove' }
 * (handleLabelSchema, 200) → { numberJid, labelId, add: true } | { numberJid, labelId, remove: true }.
 * Evolution resolves the number with whatsappNumbers: 404 "Number is not on WhatsApp" otherwise.
 * Labels only exist on WhatsApp Business accounts.
 */
export async function handleLabel(
  this: IExecuteFunctions,
  itemIndex: number,
  action: 'add' | 'remove',
): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const number = normalizeNumber(this.getNodeParameter('number', itemIndex, ''));
  if (!number) {
    throw new NodeOperationError(this.getNode(), 'Chat is required', { itemIndex });
  }
  const labelId = String(
    this.getNodeParameter('labelId', itemIndex, '', { extractValue: true }) ?? '',
  ).trim();
  if (!labelId) {
    throw new NodeOperationError(this.getNode(), 'Label is required', { itemIndex });
  }

  return (await evolutionApiRequest.call(
    this,
    'POST',
    `/label/handleLabel/${instance}`,
    { number, labelId, action },
    {},
    { itemIndex },
  )) as IDataObject;
}

/** listSearch for the "Label" resource locator: GET /label/findLabels/:instanceName. */
export async function labelSearchLabels(
  this: ILoadOptionsFunctions,
  filter?: string,
): Promise<INodeListSearchResult> {
  const instance = await resolveInstanceNameFromValue.call(
    this,
    this.getCurrentNodeParameter('instanceName', { extractValue: true }),
  );
  const labels = toArray(
    await evolutionApiRequest.call(this, 'GET', `/label/findLabels/${instance}`),
  );
  const needle = (filter ?? '').trim().toLowerCase();

  const results = labels
    .map((label) => ({ id: String(label.id ?? '').trim(), name: String(label.name ?? '').trim() }))
    .filter((label) => label.id && (!needle || label.name.toLowerCase().includes(needle)))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((label) => ({ name: label.name || label.id, value: label.id }));

  return { results };
}
