import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import {
  applySendOptions,
  assertButtonRules,
  buttonValueProperties,
  delayOption,
  getCollectionEntries,
  getRecipient,
  getString,
  interactiveInputModeProperty,
  mentionOptions,
  normalizeButton,
  numberProperty,
  operationError,
  parseJsonArray,
  postMessage,
  quotedOptions,
  sendOptionsProperty,
} from './helpers';

const BUTTON_TYPES = ['reply', 'copy', 'url', 'call', 'pix'];

const BUTTONS_EXAMPLE = `[
  { "type": "reply", "displayText": "Yes", "id": "yes" },
  { "type": "reply", "displayText": "No", "id": "no" }
]`;

const RULES =
  'Use 1-3 Quick Reply buttons, any combination of URL/Call/Copy Code buttons, or a single PIX Payment button. Evolution API 2.4+ limits URL/Call/Copy Code buttons to 2; 2.3.x has no server limit.';

const properties: INodeProperties[] = [
  numberProperty,
  {
    displayName: 'Title',
    name: 'buttonsTitle',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'Confirm your appointment',
    description: 'Bold title at the top of the message',
  },
  {
    displayName: 'Description',
    name: 'buttonsDescription',
    type: 'string',
    default: '',
    typeOptions: { rows: 2 },
    description: 'Body text shown under the title',
  },
  interactiveInputModeProperty,
  {
    displayName: 'Buttons',
    name: 'buttons',
    type: 'fixedCollection',
    required: true,
    typeOptions: { multipleValues: true },
    placeholder: 'Add Button',
    default: {},
    description: `Buttons of the message. ${RULES}`,
    displayOptions: { show: { interactiveInputMode: ['fields'] } },
    options: [
      {
        displayName: 'Button',
        name: 'button',
        values: buttonValueProperties(BUTTON_TYPES),
      },
    ],
  },
  {
    displayName: 'Buttons (JSON)',
    name: 'buttonsJson',
    type: 'json',
    required: true,
    default: '',
    placeholder: BUTTONS_EXAMPLE,
    description: `Array of buttons: { "type": "reply", "displayText", "id" }, { "type": "url", "displayText", "url" }, { "type": "call", "displayText", "phoneNumber" }, { "type": "copy", "displayText", "copyCode" } or { "type": "pix", "currency", "name", "keyType", "key" }. ${RULES}`,
    displayOptions: { show: { interactiveInputMode: ['json'] } },
  },
  sendOptionsProperty([
    delayOption(),
    {
      displayName: 'Footer',
      name: 'footer',
      type: 'string',
      default: '',
      description: 'Small text shown at the bottom of the message',
    },
    {
      displayName: 'Header Image URL',
      name: 'thumbnailUrl',
      type: 'string',
      default: '',
      placeholder: 'https://example.com/banner.jpg',
      description: 'Public URL of an image shown above the title',
    },
    ...mentionOptions,
    ...quotedOptions(),
  ]),
];

export const description = updateDisplayOptions(
  { show: { resource: ['message'], operation: ['sendButtons'] } },
  properties,
);

/**
 * POST /message/sendButtons/:instanceName (buttonsMessageSchema, HTTP 201)
 * { number, title, description?, footer?, thumbnailUrl?, buttons: [{ type, displayText?, id?,
 *   url?, phoneNumber?, copyCode?, currency?, name?, keyType?, key? }], delay?, quoted?,
 *   mentionsEveryOne?, mentioned? }.
 * The button rules are validated before sending (assertButtonRules). The Cloud API channel only
 * sends reply buttons (texts and IDs must be unique there).
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const node = this.getNode();
  const number = getRecipient.call(this, itemIndex);
  const title = getString.call(this, 'buttonsTitle', itemIndex);
  if (!title) throw operationError(node, itemIndex, 'Title is required');

  const mode = this.getNodeParameter('interactiveInputMode', itemIndex, 'fields') as string;
  const rawButtons =
    mode === 'json'
      ? parseJsonArray(
          node,
          itemIndex,
          this.getNodeParameter('buttonsJson', itemIndex, ''),
          'Buttons (JSON)',
          ['buttons'],
        )
      : getCollectionEntries(this.getNodeParameter('buttons', itemIndex, {}), 'button');
  const buttons = rawButtons.map((raw, index) =>
    normalizeButton(node, itemIndex, raw, `Button ${index + 1}`, BUTTON_TYPES),
  );
  assertButtonRules(node, itemIndex, buttons);

  const body: IDataObject = { number, title, buttons };
  const buttonsDescription = getString.call(this, 'buttonsDescription', itemIndex);
  if (buttonsDescription) body.description = buttonsDescription;

  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
  const footer = String(options.footer ?? '').trim();
  if (footer) body.footer = footer;
  const thumbnailUrl = String(options.thumbnailUrl ?? '').trim();
  if (thumbnailUrl) {
    if (!/^https?:\/\//i.test(thumbnailUrl)) {
      throw operationError(node, itemIndex, 'Header Image URL must start with http:// or https://');
    }
    body.thumbnailUrl = thumbnailUrl;
  }
  applySendOptions(node, itemIndex, options, body);
  return await postMessage.call(this, itemIndex, 'sendButtons', body);
}
