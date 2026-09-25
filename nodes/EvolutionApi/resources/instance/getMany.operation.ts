import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeApiError, NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import {
  evolutionApiRequest,
  isPlainObject,
  normalizeNumber,
  toArray,
} from '../../GenericFunctions';

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
    displayName: 'Filters',
    name: 'filters',
    type: 'collection',
    placeholder: 'Add Filter',
    default: {},
    options: [
      {
        displayName: 'Instance ID',
        name: 'instanceId',
        type: 'string',
        default: '',
      },
      {
        displayName: 'Instance Name',
        name: 'instanceName',
        type: 'string',
        default: '',
        description: 'Exact name of the instance',
      },
      {
        displayName: 'Number',
        name: 'number',
        type: 'string',
        default: '',
        description: 'Number stored on the instance (only honored with the global API key)',
      },
    ],
  },
  {
    displayName: 'Options',
    name: 'options',
    type: 'collection',
    placeholder: 'Add Option',
    default: {},
    options: [
      {
        displayName: 'Include Secrets',
        name: 'includeSecrets',
        type: 'boolean',
        default: false,
        description:
          'Whether to keep secrets in the output: the instance token, Chatwoot.token, Proxy.password and Setting.wavoipToken. Off by default so they are not stored in execution logs.',
      },
    ],
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['instance'], operation: ['getMany'] } },
  properties,
);

/** Nested relation → secret keys removed unless "Include Secrets" is on. */
const SECRET_PATHS: Array<[string | null, string]> = [
  [null, 'token'],
  ['Chatwoot', 'token'],
  ['Proxy', 'password'],
  ['Setting', 'wavoipToken'],
];

export function redactInstanceSecrets(instance: IDataObject): IDataObject {
  const copy: IDataObject = { ...instance };
  for (const [relation, key] of SECRET_PATHS) {
    if (relation === null) {
      delete copy[key];
      continue;
    }
    const nested = copy[relation];
    if (isPlainObject(nested) && key in nested) {
      const nestedCopy = { ...nested };
      delete nestedCopy[key];
      copy[relation] = nestedCopy;
    }
  }
  return copy;
}

/**
 * 404 bodies of fetchInstances when a filter matches nothing (monitor.service.ts instanceInfo /
 * instanceInfoById): `Instance "x" not found` / `Instances "x, y" not found`. A route-level 404
 * ("Cannot GET /instance/fetchInstances", wrong Base URL) does not match and is still an error.
 */
const FILTER_NOT_FOUND = /Instances? ".*" not found/;

export function isFilterNotFoundError(error: unknown): boolean {
  return (
    error instanceof NodeApiError &&
    error.httpCode === '404' &&
    FILTER_NOT_FOUND.test(error.message)
  );
}

/**
 * GET /instance/fetchInstances[?instanceName=&instanceId=&number=]
 * Global key: all instances (or the filtered one). Instance token: only instances with that
 * token (the server must run with DATABASE_SAVE_DATA_INSTANCE=true).
 * Filters are also applied client side because Evolution develop builds drop ?instanceName.
 * With the global key a filter that matches nothing is answered 404 → returned as no items.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject[]> {
  const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
  const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

  const instanceName = String(filters.instanceName ?? '').trim();
  const instanceId = String(filters.instanceId ?? '').trim();
  const number = normalizeNumber(filters.number);

  const qs: IDataObject = {};
  if (instanceName) qs.instanceName = instanceName;
  if (instanceId) qs.instanceId = instanceId;
  if (number) qs.number = number;

  let response: IDataObject | IDataObject[];
  try {
    response = await evolutionApiRequest.call(this, 'GET', '/instance/fetchInstances', {}, qs, {
      itemIndex,
    });
  } catch (error) {
    if (Object.keys(qs).length > 0 && isFilterNotFoundError(error)) return [];
    const nodeError = error as NodeApiError | NodeOperationError;
    throw nodeError;
  }

  let instances = toArray(response).filter((instance) => {
    if (instanceName && instance.name !== undefined && instance.name !== instanceName) return false;
    if (instanceId && instance.id !== undefined && instance.id !== instanceId) return false;
    if (number && instance.number !== undefined && normalizeNumber(instance.number) !== number) {
      return false;
    }
    return true;
  });

  if (!returnAll) {
    const limit = this.getNodeParameter('limit', itemIndex, 50) as number;
    instances = instances.slice(0, limit);
  }

  return options.includeSecrets === true ? instances : instances.map(redactInstanceSecrets);
}
