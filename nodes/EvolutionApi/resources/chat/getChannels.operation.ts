import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import {
  evolutionApiRequest,
  isPlainObject,
  resolveInstanceName,
  toArray,
} from '../../GenericFunctions';
import { collectPages, getLimit, paginationFields } from './helpers';

const properties: INodeProperties[] = [...paginationFields('channels')];

export const description = updateDisplayOptions(
  { show: { resource: ['chat'], operation: ['getChannels'] } },
  properties,
);

/**
 * POST /chat/findChannels/:instanceName { page, limit } (200, new in 2.4) →
 * { total, pages, currentPage, limit, records: [{ remoteJid (…@newsletter), lastMessageTimestamp }] }.
 * Built from stored messages of WhatsApp channels (newsletters). Outputs one item per channel.
 * 2.3.x answers 404 "Cannot POST".
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject[]> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const limit = getLimit.call(this, itemIndex);

  return await collectPages(async (page, pageSize) => {
    const response = await evolutionApiRequest.call(
      this,
      'POST',
      `/chat/findChannels/${instance}`,
      { page, limit: pageSize },
      {},
      { itemIndex, idempotent: true },
    );
    const envelope = isPlainObject(response) ? response : {};
    const pages = Number(envelope.pages);
    return {
      records: toArray(envelope.records),
      pages: Number.isFinite(pages) ? pages : undefined,
    };
  }, limit);
}
