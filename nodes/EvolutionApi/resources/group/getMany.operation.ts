import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName, toArray } from '../../GenericFunctions';

const properties: INodeProperties[] = [
  {
    displayName: 'Return All',
    name: 'returnAll',
    type: 'boolean',
    default: false,
    description: 'Whether to return all results or only up to a given limit',
  },
  {
    displayName: 'Limit',
    name: 'limit',
    type: 'number',
    typeOptions: { minValue: 1 },
    default: 50,
    displayOptions: { show: { returnAll: [false] } },
    description: 'Max number of results to return',
  },
  {
    displayName: 'Include Participants',
    name: 'getParticipants',
    type: 'boolean',
    default: false,
    description:
      'Whether to include the participant list (JID and admin role of every member) of each group. It only makes the output larger: the request takes as long either way.',
  },
  {
    displayName: 'Filters',
    name: 'filters',
    type: 'collection',
    placeholder: 'Add Filter',
    default: {},
    options: [
      {
        displayName: 'Subject Contains',
        name: 'subject',
        type: 'string',
        default: '',
        placeholder: 'e.g. Sales',
        description:
          'Only return groups whose name (subject) contains this text (case-insensitive). Applied by the node: Evolution API always returns every group.',
      },
    ],
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['group'], operation: ['getMany'] } },
  properties,
);

/**
 * GET /group/fetchAllGroups/:instanceName?getParticipants=true|false
 * The query parameter is mandatory (getParticipantsValidate answers 400 without it).
 * Evolution has no server-side pagination or search: filters and Limit are applied client side.
 * Slow on accounts with many groups (Evolution fetches every group picture one by one).
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject[]> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const getParticipants = this.getNodeParameter('getParticipants', itemIndex, false) as boolean;
  const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
  const response = await evolutionApiRequest.call(
    this,
    'GET',
    `/group/fetchAllGroups/${instance}`,
    {},
    { getParticipants: getParticipants ? 'true' : 'false' },
    { itemIndex },
  );

  let groups = toArray(response);
  const subject = String(filters.subject ?? '')
    .trim()
    .toLowerCase();
  if (subject) {
    groups = groups.filter((group) =>
      String(group.subject ?? '')
        .toLowerCase()
        .includes(subject),
    );
  }

  if (this.getNodeParameter('returnAll', itemIndex, false) as boolean) return groups;
  return groups.slice(0, this.getNodeParameter('limit', itemIndex, 50) as number);
}
