import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeProperties,
  INodePropertyOptions,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { CREDENTIAL_TYPE, isPlainObject, searchInstances } from './GenericFunctions';
import { getResourceModule, RESOURCES, resourceProperty } from './resources';
import type {
  ListSearchMethod,
  LoadOptionsMethod,
  OperationHandler,
  OperationResult,
  ResourceDefinition,
  ResourceModule,
} from './types';

/**
 * Shared "Instance Name" field (resource locator: list of instances or a name/expression).
 * Empty value → the credential's Default Instance Name (see resolveInstanceName()).
 */
export const instanceNameProperty: INodeProperties = {
  displayName: 'Instance Name',
  name: 'instanceName',
  type: 'resourceLocator',
  default: { mode: 'list', value: '' },
  description:
    'Evolution API instance to use. Leave empty to use the credential default, except for Delete and Logout, which require an explicit instance. Empty expressions always fail.',
  modes: [
    {
      displayName: 'From List',
      name: 'list',
      type: 'list',
      placeholder: 'Select an instance...',
      typeOptions: {
        searchListMethod: 'searchInstances',
        searchable: true,
      },
    },
    {
      displayName: 'By Name',
      name: 'name',
      type: 'string',
      placeholder: 'e.g. my-instance',
    },
  ],
};

/**
 * Build the "Instance Name" field variants (all named `instanceName`, only one visible at a time):
 * one for every resource without `noInstanceOperations`, plus one per resource that has them,
 * restricted to its other operations. Operation values stay scoped to their resource.
 */
export function buildInstanceNameProperties(resources: ResourceDefinition[]): INodeProperties[] {
  const properties: INodeProperties[] = [];
  const everyOperation = resources
    .filter(({ module }) => !module.noInstanceOperations?.length)
    .map(({ value }) => value);
  if (everyOperation.length > 0) {
    properties.push({
      ...instanceNameProperty,
      displayOptions: { show: { resource: everyOperation } },
    });
  }

  for (const { value, module } of resources) {
    const excluded = module.noInstanceOperations ?? [];
    if (excluded.length === 0) continue;
    const operations = ((module.operations.options ?? []) as INodePropertyOptions[])
      .map((option) => String(option.value))
      .filter((operation) => !excluded.includes(operation));
    if (operations.length === 0) continue;
    properties.push({
      ...instanceNameProperty,
      displayOptions: { show: { resource: [value], operation: operations } },
    });
  }

  return properties;
}

/**
 * The node's `methods`: the shared `searchInstances` plus every resource's own loadOptions /
 * listSearch methods (ResourceModule.methods). Names are global; the first registration wins
 * and test/Resources.test.ts fails on duplicates.
 */
export function buildMethods(resources: ResourceDefinition[]): {
  loadOptions: Record<string, LoadOptionsMethod>;
  listSearch: Record<string, ListSearchMethod>;
} {
  const loadOptions: Record<string, LoadOptionsMethod> = {};
  const listSearch: Record<string, ListSearchMethod> = { searchInstances };
  for (const { module } of resources) {
    for (const [name, method] of Object.entries(module.methods?.loadOptions ?? {})) {
      if (!(name in loadOptions)) loadOptions[name] = method;
    }
    for (const [name, method] of Object.entries(module.methods?.listSearch ?? {})) {
      if (!(name in listSearch)) listSearch[name] = method;
    }
  }
  return { loadOptions, listSearch };
}

/** Handler of an operation. Own properties only: "constructor" or "toString" are not operations. */
export function getOperationHandler(
  resourceModule: ResourceModule | undefined,
  operation: string,
): OperationHandler | undefined {
  if (!resourceModule || !Object.prototype.hasOwnProperty.call(resourceModule.execute, operation)) {
    return undefined;
  }
  return resourceModule.execute[operation];
}

const EXECUTION_DATA_KEYS = new Set(['json', 'binary', 'pairedItem', 'error', 'metadata']);

/** True when a handler returned INodeExecutionData[] instead of plain JSON objects. */
export function isExecutionDataArray(result: OperationResult): result is INodeExecutionData[] {
  return (
    Array.isArray(result) &&
    result.length > 0 &&
    result.every(
      (entry) =>
        isPlainObject(entry) &&
        isPlainObject(entry.json) &&
        Object.keys(entry).every((key) => EXECUTION_DATA_KEYS.has(key)),
    )
  );
}

/** Convert a handler result into output items (pairedItem is added by the caller). */
export function toOutputItems(
  result: OperationResult,
  inputItem: INodeExecutionData | undefined,
  passThroughBinary: boolean,
): INodeExecutionData[] {
  if (isExecutionDataArray(result)) return result;

  const jsonItems: IDataObject[] = Array.isArray(result)
    ? (result as unknown[]).map((entry) =>
        isPlainObject(entry) ? entry : { value: entry as string },
      )
    : [isPlainObject(result) ? result : {}];

  return jsonItems.map((json) => {
    const item: INodeExecutionData = { json };
    if (passThroughBinary && inputItem?.binary) item.binary = inputItem.binary;
    return item;
  });
}

export class EvolutionApi implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Evolution API',
    name: 'evolutionApi',
    icon: 'file:evolution.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description:
      'Send WhatsApp messages and manage instances, chats, groups and integrations with Evolution API v2',
    defaults: {
      name: 'Evolution API',
    },
    usableAsTool: true,
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [
      {
        name: CREDENTIAL_TYPE,
        required: true,
      },
    ],
    properties: [
      resourceProperty,
      ...RESOURCES.map(({ module }) => module.operations),
      ...buildInstanceNameProperties(RESOURCES),
      ...RESOURCES.flatMap(({ module }) => module.fields),
    ],
  };

  methods = buildMethods(RESOURCES);

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    // Both parameters are noDataExpression: identical for every item.
    const resource = this.getNodeParameter('resource', 0) as string;
    const operation = this.getNodeParameter('operation', 0) as string;
    const resourceModule = getResourceModule(resource);
    const handler = getOperationHandler(resourceModule, operation);

    if (!handler) {
      throw new NodeOperationError(
        this.getNode(),
        `The operation "${operation}" is not supported for resource "${resource}"`,
      );
    }

    const passThroughBinary = resourceModule?.binaryPassThrough?.includes(operation) ?? false;

    for (let i = 0; i < items.length; i++) {
      try {
        const result = await handler.call(this, i);
        const executionData = this.helpers.constructExecutionMetaData(
          toOutputItems(result, items[i], passThroughBinary),
          { itemData: { item: i } },
        );
        returnData.push(...executionData);
      } catch (error) {
        const nodeError =
          error instanceof NodeApiError || error instanceof NodeOperationError
            ? error
            : new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
        if (nodeError.context.itemIndex === undefined) nodeError.context.itemIndex = i;

        if (this.continueOnFail()) {
          const json: IDataObject = { error: nodeError.message };
          if (nodeError.description) json.description = nodeError.description;
          if (nodeError instanceof NodeApiError && nodeError.httpCode) {
            json.httpCode = nodeError.httpCode;
          }
          returnData.push({ json, pairedItem: { item: i } });
          continue;
        }
        throw nodeError;
      }
    }

    return [returnData];
  }
}
