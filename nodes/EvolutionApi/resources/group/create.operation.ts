import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import {
  evolutionApiRequest,
  normalizeNumberList,
  resolveInstanceName,
} from '../../GenericFunctions';
import { participantsProperty } from './helpers';

const properties: INodeProperties[] = [
  {
    displayName: 'Subject',
    name: 'groupSubject',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'e.g. Sales Team',
    description: 'Name of the new group',
  },
  participantsProperty(
    'Initial members: phone numbers with country code or JIDs (…@s.whatsapp.net, …@lid), separated by commas or new lines. Numbers that are not on WhatsApp are skipped silently: check the participants of the output.',
  ),
  {
    displayName: 'Additional Fields',
    name: 'additionalFields',
    type: 'collection',
    placeholder: 'Add Field',
    default: {},
    options: [
      {
        displayName: 'Description',
        name: 'description',
        type: 'string',
        typeOptions: { rows: 3 },
        default: '',
        description: 'Description of the group, set right after it is created',
      },
      {
        displayName: 'Promote Participants to Admins',
        name: 'promoteParticipants',
        type: 'boolean',
        default: false,
        description: 'Whether to make every initial participant a group admin',
      },
    ],
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['group'], operation: ['create'] } },
  properties,
);

/**
 * POST /group/create/:instanceName { subject, participants, description?, promoteParticipants? }
 * (createGroupSchema) → Baileys GroupMetadata { id: '…@g.us', subject, owner, participants… }
 * (HTTP 201). Participants go through onWhatsApp and the missing ones are dropped. The schema's
 * `profilePicture` is ignored by the service: set the picture with Update Picture.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const subject = String(this.getNodeParameter('groupSubject', itemIndex, '') ?? '').trim();
  if (!subject) {
    throw new NodeOperationError(this.getNode(), 'Subject is required', { itemIndex });
  }
  const participants = normalizeNumberList(this.getNodeParameter('groupParticipants', itemIndex));
  if (participants.length === 0) {
    throw new NodeOperationError(this.getNode(), 'At least one participant is required', {
      itemIndex,
      description: 'WhatsApp does not create groups without other members.',
    });
  }

  const additionalFields = this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject;
  const body: IDataObject = { subject, participants };
  const groupDescription = String(additionalFields.description ?? '');
  if (groupDescription.trim()) body.description = groupDescription;
  if (additionalFields.promoteParticipants === true) body.promoteParticipants = true;

  return (await evolutionApiRequest.call(
    this,
    'POST',
    `/group/create/${instance}`,
    body,
    {},
    { itemIndex },
  )) as IDataObject;
}
