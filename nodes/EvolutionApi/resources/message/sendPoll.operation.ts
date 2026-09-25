import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import {
  applySendOptions,
  delayOption,
  getRecipient,
  getString,
  mentionOptions,
  messageIdOption,
  numberProperty,
  operationError,
  postMessage,
  quotedOptions,
  sendOptionsProperty,
  splitLines,
} from './helpers';

const properties: INodeProperties[] = [
  numberProperty,
  {
    displayName: 'Question',
    name: 'pollQuestion',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'Which day works best?',
    description: 'Title of the poll',
  },
  {
    displayName: 'Poll Options',
    name: 'pollOptions',
    type: 'string',
    required: true,
    default: '',
    typeOptions: { rows: 4 },
    placeholder: 'Monday\nTuesday\nWednesday',
    description: 'Answers to choose from, one per line (2 to 10, all different)',
  },
  {
    displayName: 'Selectable Count',
    name: 'selectableCount',
    type: 'number',
    default: 1,
    typeOptions: { minValue: 0, maxValue: 10 },
    description:
      'How many options each person can select: 1 for a single choice, 0 for any number of options',
  },
  sendOptionsProperty([delayOption(), ...mentionOptions, messageIdOption, ...quotedOptions()]),
];

export const description = updateDisplayOptions(
  { show: { resource: ['message'], operation: ['sendPoll'] } },
  properties,
);

/**
 * POST /message/sendPoll/:instanceName (pollMessageSchema, HTTP 201)
 * { number, name, selectableCount (0-10), values (2-10 unique strings), delay?, quoted?,
 *   mentionsEveryOne?, mentioned?, messageId? (2.4) }. WhatsApp Baileys only.
 * Votes arrive as MESSAGES_UPDATE events (pollUpdates).
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const node = this.getNode();
  const number = getRecipient.call(this, itemIndex);
  const name = getString.call(this, 'pollQuestion', itemIndex);
  if (!name) throw operationError(node, itemIndex, 'Question is required');

  const values = splitLines(this.getNodeParameter('pollOptions', itemIndex, ''));
  if (values.length < 2 || values.length > 10) {
    throw operationError(
      node,
      itemIndex,
      `A poll needs between 2 and 10 options (got ${values.length})`,
      'Write one option per line in Poll Options.',
    );
  }
  const duplicate = values.find((value, index) => values.indexOf(value) !== index);
  if (duplicate !== undefined) {
    throw operationError(
      node,
      itemIndex,
      `Poll options must be different ("${duplicate}" is repeated)`,
    );
  }

  const rawCount = Number(this.getNodeParameter('selectableCount', itemIndex, 1));
  const selectableCount = Number.isFinite(rawCount) ? Math.round(rawCount) : 1;
  if (selectableCount < 0 || selectableCount > values.length) {
    throw operationError(
      node,
      itemIndex,
      `Selectable Count must be between 0 and the number of options (${values.length})`,
    );
  }

  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
  const body = applySendOptions(node, itemIndex, options, {
    number,
    name,
    selectableCount,
    values,
  });
  return await postMessage.call(this, itemIndex, 'sendPoll', body);
}
