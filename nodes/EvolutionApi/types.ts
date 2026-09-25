import type {
  IDataObject,
  IExecuteFunctions,
  ILoadOptionsFunctions,
  INodeExecutionData,
  INodeListSearchResult,
  INodeProperties,
  INodePropertyOptions,
} from 'n8n-workflow';

// ============================================================================
// Resource registry contract
// ============================================================================

/**
 * What an operation handler may return:
 * - `IDataObject` → one output item
 * - `IDataObject[]` → one output item per element
 * - `INodeExecutionData[]` → used as-is (every element MUST have a `json` key). Use this to
 *   emit binary data (e.g. a QR code or a downloaded media file).
 *
 * `pairedItem` is always added by the node, handlers never set it.
 */
export type OperationResult = IDataObject | IDataObject[] | INodeExecutionData[];

/** Operation handler. Called once per input item. */
export type OperationHandler = (
  this: IExecuteFunctions,
  itemIndex: number,
) => Promise<OperationResult>;

/** `loadOptionsMethod` implementation (options fields). */
export type LoadOptionsMethod = (this: ILoadOptionsFunctions) => Promise<INodePropertyOptions[]>;

/** `searchListMethod` implementation (resourceLocator fields in "list" mode). */
export type ListSearchMethod = (
  this: ILoadOptionsFunctions,
  filter?: string,
  paginationToken?: string,
) => Promise<INodeListSearchResult>;

/**
 * UI methods a resource contributes to the node's `methods`. Names are global across the node
 * (a test enforces uniqueness): prefix them with the resource, e.g. `chatbotSearchBots`.
 */
export interface ResourceMethods {
  loadOptions?: Record<string, LoadOptionsMethod>;
  listSearch?: Record<string, ListSearchMethod>;
}

/**
 * Shape of every `nodes/EvolutionApi/resources/<resource>/index.ts` module.
 * Only `operations`, `fields` and `execute` are mandatory.
 */
export interface ResourceModule {
  /** The "Operation" options property, shown only for this resource. */
  operations: INodeProperties;
  /** Every field of every operation of this resource (each scoped with displayOptions). */
  fields: INodeProperties[];
  /** Operation value → handler. */
  execute: Record<string, OperationHandler>;
  /**
   * Operations that do not act on an existing instance (e.g. instance → create / getMany).
   * The shared "Instance Name" field is hidden for them. Values are scoped to this resource,
   * so the same value (e.g. "create") can still need an instance in another resource.
   */
  noInstanceOperations?: string[];
  /**
   * Operations whose JSON output keeps the binary data of the input item (e.g. after sending a
   * file you may still want the file downstream). Ignored when the handler returns
   * INodeExecutionData[] (then the handler decides).
   */
  binaryPassThrough?: string[];
  /**
   * loadOptions / listSearch methods used by this resource's fields. The node merges them into
   * its own `methods`, so adding one never requires editing EvolutionApi.node.ts.
   */
  methods?: ResourceMethods;
}

/** Entry of the resource registry (`resources/index.ts`). */
export interface ResourceDefinition {
  /** Display name in the "Resource" selector. */
  name: string;
  /** Internal value of the resource (folder name). */
  value: string;
  /** Short description shown in the selector. */
  description: string;
  module: ResourceModule;
}

// ============================================================================
// Evolution API payloads
// ============================================================================

/** Error body produced by Evolution's global error handler (src/main.ts). */
export interface IEvolutionErrorBody extends IDataObject {
  status?: number;
  error?: string;
  response?: {
    message?: string | string[] | IDataObject[];
  };
}

/** 503 body returned by the Evolution API 2.4+ license gate (src/licensing/runtime.ts). */
export interface IEvolutionLicenseErrorBody extends IDataObject {
  error?: string;
  code?: 'LICENSE_REQUIRED';
  register_url?: string;
  instance_id?: string;
  docs_url?: string;
  message?: string;
}

/** QR code / pairing code payload (wa.QrCode). */
export interface IEvolutionQrCode extends IDataObject {
  pairingCode?: string;
  code?: string;
  base64?: string;
  count?: number;
}
