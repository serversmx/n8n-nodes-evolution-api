import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import {
  contactWaId,
  getCollectionEntries,
  getRecipient,
  numberProperty,
  operationError,
  postMessage,
  str,
} from './helpers';

const properties: INodeProperties[] = [
  numberProperty,
  {
    displayName: 'Contacts',
    name: 'contactCards',
    type: 'fixedCollection',
    required: true,
    typeOptions: { multipleValues: true },
    placeholder: 'Add Contact',
    default: {},
    description: 'Contact cards (vCards) to send. Several contacts are sent as one message.',
    options: [
      {
        displayName: 'Contact',
        name: 'contact',
        values: [
          {
            displayName: 'Full Name',
            name: 'fullName',
            type: 'string',
            required: true,
            default: '',
            placeholder: 'Jane Doe',
          },
          {
            displayName: 'Phone Number',
            name: 'phoneNumber',
            type: 'string',
            required: true,
            default: '',
            placeholder: '+52 1 55 1234 5678',
            description: 'Phone number with country code, as it should be displayed',
          },
          {
            displayName: 'WhatsApp ID',
            name: 'wuid',
            type: 'string',
            default: '',
            placeholder: '525512345678',
            description:
              'Digits of the WhatsApp account (at least 10, a JID is reduced to its digits), used for the "Message" button of the card. Defaults to the phone number digits.',
          },
          {
            displayName: 'Organization',
            name: 'organization',
            type: 'string',
            default: '',
          },
          {
            displayName: 'Email',
            name: 'email',
            type: 'string',
            placeholder: 'name@email.com',
            default: '',
          },
          {
            displayName: 'URL',
            name: 'url',
            type: 'string',
            default: '',
            placeholder: 'https://example.com',
          },
        ],
      },
    ],
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['message'], operation: ['sendContact'] } },
  properties,
);

/**
 * POST /message/sendContact/:instanceName (contactMessageSchema, HTTP 201)
 * { number, contact: [{ fullName, phoneNumber, wuid?, organization?, email?, url? }] }.
 * Evolution sends contacts with empty options (delay, quoted and mentions are ignored).
 * `wuid` must be digits (minLength 10): Evolution's fallback createJid(phoneNumber) appends
 * "@s.whatsapp.net" and breaks the vCard, so it is always derived here when missing.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const node = this.getNode();
  const number = getRecipient.call(this, itemIndex);
  const entries = getCollectionEntries(
    this.getNodeParameter('contactCards', itemIndex, {}),
    'contact',
  );
  if (entries.length === 0) {
    throw operationError(node, itemIndex, 'Add at least one contact');
  }

  const contact = entries.map((entry, index) => {
    const label = `Contact ${index + 1}`;
    const fullName = str(entry, 'fullName');
    const phoneNumber = str(entry, 'phoneNumber');
    if (!fullName) throw operationError(node, itemIndex, `${label}: Full Name is required`);
    if (phoneNumber.replace(/\D/g, '').length < 10) {
      throw operationError(
        node,
        itemIndex,
        `${label}: Phone Number must include the country code (at least 10 digits)`,
      );
    }
    // A JID (device suffix included) or a formatted number is reduced to its digits. Too short a
    // value would fail the schema (minLength 10) and must not be dropped silently: Evolution's
    // own fallback (createJid) breaks the vCard.
    const rawWuid = str(entry, 'wuid');
    const wuid = rawWuid ? rawWuid.split(/[:@]/)[0].replace(/\D/g, '') : contactWaId(phoneNumber);
    if (wuid.length < 10) {
      throw operationError(
        node,
        itemIndex,
        `${label}: WhatsApp ID must be the digits of a WhatsApp number with country code (at least 10 digits)`,
        'Leave it empty to derive it from the phone number.',
      );
    }
    const card: IDataObject = { fullName, phoneNumber, wuid };
    for (const key of ['organization', 'email', 'url']) {
      const value = str(entry, key);
      if (value) card[key] = value;
    }
    return card;
  });

  return await postMessage.call(this, itemIndex, 'sendContact', { number, contact });
}
