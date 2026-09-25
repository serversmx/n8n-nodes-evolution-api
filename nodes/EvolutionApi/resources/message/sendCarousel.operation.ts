import type { IDataObject, IExecuteFunctions, INode, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { REQUIRES_24 } from '../../constants';
import { isPlainObject } from '../../GenericFunctions';
import {
  applySendOptions,
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
  str,
} from './helpers';

/** Card button types (carouselMessageSchema: no PIX). */
const CARD_BUTTON_TYPES = ['reply', 'copy', 'url', 'call'];

const CARDS_EXAMPLE = `[
  {
    "title": "Pizza",
    "body": "Large, 8 slices - $12",
    "footer": "Free delivery",
    "imageUrl": "https://example.com/pizza.jpg",
    "buttons": [
      { "type": "reply", "displayText": "Order", "id": "order_pizza" },
      { "type": "url", "displayText": "Details", "url": "https://example.com/pizza" }
    ]
  }
]`;

const properties: INodeProperties[] = [
  {
    displayName: `${REQUIRES_24} Older servers answer 404 "Cannot POST /message/sendCarousel".`,
    name: 'carouselNotice',
    type: 'notice',
    default: '',
  },
  numberProperty,
  {
    displayName: 'Body',
    name: 'carouselBody',
    type: 'string',
    required: true,
    default: '',
    typeOptions: { rows: 2 },
    description: `Text shown above the cards. ${REQUIRES_24}`,
  },
  interactiveInputModeProperty,
  {
    displayName: 'Cards',
    name: 'carouselCards',
    type: 'fixedCollection',
    required: true,
    typeOptions: { multipleValues: true },
    placeholder: 'Add Card',
    default: {},
    description: 'Cards of the carousel (1 to 10), each with 1 to 3 buttons',
    displayOptions: { show: { interactiveInputMode: ['fields'] } },
    options: [
      {
        displayName: 'Card',
        name: 'card',
        values: [
          {
            displayName: 'Title',
            name: 'title',
            type: 'string',
            default: '',
          },
          {
            displayName: 'Body',
            name: 'body',
            type: 'string',
            required: true,
            default: '',
            description: 'Text of the card',
          },
          {
            displayName: 'Footer',
            name: 'footer',
            type: 'string',
            default: '',
          },
          {
            displayName: 'Image URL',
            name: 'imageUrl',
            type: 'string',
            default: '',
            placeholder: 'https://example.com/product.jpg',
            description: 'Public URL of the card image',
          },
          {
            displayName: 'Buttons',
            name: 'buttons',
            type: 'fixedCollection',
            typeOptions: { multipleValues: true },
            placeholder: 'Add Button',
            default: {},
            description: '1 to 3 buttons (Quick Reply, URL, Call or Copy Code)',
            options: [
              {
                displayName: 'Button',
                name: 'button',
                values: buttonValueProperties(CARD_BUTTON_TYPES),
              },
            ],
          },
        ],
      },
    ],
  },
  {
    displayName: 'Cards (JSON)',
    name: 'carouselCardsJson',
    type: 'json',
    required: true,
    default: CARDS_EXAMPLE,
    description:
      'Array of 1-10 cards: { "title"?, "body", "footer"?, "imageUrl"?, "buttons": [1-3 buttons of type reply, url, call or copy] }. An object with a "cards" key is accepted too.',
    displayOptions: { show: { interactiveInputMode: ['json'] } },
  },
  sendOptionsProperty([delayOption(), ...mentionOptions, ...quotedOptions()]),
];

export const description = updateDisplayOptions(
  { show: { resource: ['message'], operation: ['sendCarousel'] } },
  properties,
);

/** Validate cards with the rules of carouselMessageSchema / carouselMessage(). */
export function normalizeCards(
  node: INode,
  itemIndex: number,
  rawCards: IDataObject[],
): IDataObject[] {
  if (rawCards.length < 1 || rawCards.length > 10) {
    throw operationError(
      node,
      itemIndex,
      `A carousel needs between 1 and 10 cards (got ${rawCards.length})`,
    );
  }
  return rawCards.map((rawCard, cardIndex) => {
    const label = `Card ${cardIndex + 1}`;
    const body = str(rawCard, 'body');
    if (!body) throw operationError(node, itemIndex, `${label}: Body is required`);

    const rawButtons: unknown[] = Array.isArray(rawCard.buttons)
      ? rawCard.buttons
      : getCollectionEntries(rawCard.buttons, 'button');
    if (rawButtons.length < 1 || rawButtons.length > 3) {
      throw operationError(
        node,
        itemIndex,
        `${label}: a card needs between 1 and 3 buttons (got ${rawButtons.length})`,
      );
    }
    const buttons = rawButtons.map((rawButton, buttonIndex) =>
      normalizeButton(
        node,
        itemIndex,
        isPlainObject(rawButton) ? rawButton : {},
        `${label}, button ${buttonIndex + 1}`,
        CARD_BUTTON_TYPES,
      ),
    );

    const card: IDataObject = { body, buttons };
    for (const key of ['title', 'footer', 'imageUrl']) {
      const value = str(rawCard, key);
      if (value) card[key] = value;
    }
    return card;
  });
}

/**
 * POST /message/sendCarousel/:instanceName (carouselMessageSchema, HTTP 201). Evolution API 2.4+
 * only: 2.3.x answers 404 "Cannot POST". WhatsApp Baileys only.
 * { number, body, cards: [{ title?, body, footer?, imageUrl?, buttons: [...] }], delay?, quoted?,
 *   mentionsEveryOne?, mentioned? }
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const node = this.getNode();
  const number = getRecipient.call(this, itemIndex);
  const body = getString.call(this, 'carouselBody', itemIndex);
  if (!body) throw operationError(node, itemIndex, 'Body is required');

  const mode = this.getNodeParameter('interactiveInputMode', itemIndex, 'fields') as string;
  const rawCards =
    mode === 'json'
      ? parseJsonArray(
          node,
          itemIndex,
          this.getNodeParameter('carouselCardsJson', itemIndex, ''),
          'Cards (JSON)',
          ['cards'],
        )
      : getCollectionEntries(this.getNodeParameter('carouselCards', itemIndex, {}), 'card');
  const cards = normalizeCards(node, itemIndex, rawCards);

  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
  const payload = applySendOptions(node, itemIndex, options, { number, body, cards });
  return await postMessage.call(this, itemIndex, 'sendCarousel', payload);
}
