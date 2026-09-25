import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { handleLabel, handleLabelProperties } from './helpers';

export const description = updateDisplayOptions(
  { show: { resource: ['label'], operation: ['removeFromChat'] } },
  handleLabelProperties,
);

/** POST /label/handleLabel/:instanceName { number, labelId, action: 'remove' } → { numberJid, labelId, remove: true }. */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  return await handleLabel.call(this, itemIndex, 'remove');
}
