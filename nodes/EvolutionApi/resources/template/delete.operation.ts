import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';

const properties: INodeProperties[] = [
  {
    displayName: 'Name',
    name: 'templateName',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'order_update',
    description: 'Name of the template to delete',
  },
  {
    displayName: 'Additional Fields',
    name: 'additionalFields',
    type: 'collection',
    placeholder: 'Add Field',
    default: {},
    options: [
      {
        displayName: 'Template ID',
        name: 'hsmId',
        type: 'string',
        default: '',
        placeholder: '1234567890123456',
        description:
          'Meta ID of one language version. Without it Meta deletes the template in every language.',
      },
    ],
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['template'], operation: ['delete'] } },
  properties,
);

/**
 * DELETE /template/delete/:instanceName with the JSON body { name, hsmId? }
 * (templateDeleteSchema, identical in 2.3.7 and 2.4). Evolution calls Meta's
 * DELETE message_templates?name=&hsm_id=, removes its local copy and answers 200 with Meta's
 * response ({ success: true }). Every error is a 400 { message, details: { whatsapp_error, … } }.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const name = String(this.getNodeParameter('templateName', itemIndex, '')).trim();
  if (!name) {
    throw new NodeOperationError(this.getNode(), 'Template name is required', { itemIndex });
  }
  const fields = this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject;
  const body: IDataObject = { name };
  const hsmId = String(fields.hsmId ?? '').trim();
  if (hsmId) body.hsmId = hsmId;

  return (await evolutionApiRequest.call(
    this,
    'DELETE',
    `/template/delete/${instance}`,
    body,
    {},
    { itemIndex },
  )) as IDataObject;
}
