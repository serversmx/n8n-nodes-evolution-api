import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import {
  compactObject,
  evolutionApiRequest,
  normalizeNumber,
  resolveInstanceName,
  toArray,
} from '../../GenericFunctions';
import { getLimit, paginationFields } from './helpers';

const properties: INodeProperties[] = [
  ...paginationFields('contacts'),
  {
    displayName: 'Filters',
    name: 'filters',
    type: 'collection',
    placeholder: 'Add Filter',
    default: {},
    options: [
      {
        displayName: 'Contact',
        name: 'remoteJid',
        type: 'string',
        default: '',
        placeholder: '5215512345678',
        description:
          'Phone number with country code or JID (…@s.whatsapp.net, …@g.us, …@lid) of the contact',
      },
      {
        displayName: 'Push Name',
        name: 'pushName',
        type: 'string',
        default: '',
        description: 'Exact WhatsApp display name (case-sensitive)',
      },
    ],
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['chat'], operation: ['getContacts'] } },
  properties,
);

/**
 * POST /chat/findContacts/:instanceName { where?: { remoteJid?, pushName? }, offset?, page? }
 * (contactValidateSchema, 200) → [{ id, remoteJid, pushName, profilePicUrl, createdAt,
 * updatedAt, instanceId, isGroup, isSaved, type }].
 * The JID filter is `where.remoteJid` (`where.id` is the database cuid: EVONODE-5); values without
 * "@" go through Evolution's createJid. `offset` is the page size (take), `page` starts at 1.
 * Reads Evolution's database (DATABASE_SAVE_DATA_CONTACTS).
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject[]> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
  const limit = getLimit.call(this, itemIndex);

  const where = compactObject({
    remoteJid: normalizeNumber(filters.remoteJid),
    pushName: typeof filters.pushName === 'string' ? filters.pushName.trim() : undefined,
  });
  const body: IDataObject = {};
  if (Object.keys(where).length > 0) body.where = where;
  // Without offset/page Evolution returns every contact in one response.
  if (limit !== undefined) {
    body.offset = limit;
    body.page = 1;
  }

  const response = await evolutionApiRequest.call(
    this,
    'POST',
    `/chat/findContacts/${instance}`,
    body,
    {},
    { itemIndex, idempotent: true },
  );
  const contacts = toArray(response);
  return limit === undefined ? contacts : contacts.slice(0, limit);
}
