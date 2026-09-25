/**
 * Test harness for the Evolution API node.
 *
 * - Queue HTTP responses per method + URL (full URL, path relative to the Base URL, or RegExp).
 * - Throw n8n-shaped errors (NodeApiError wrapping an AxiosError, network errors…).
 * - Every request is recorded (method, url, path, qs, body, headers incl. the injected apikey).
 * - Parameters: shared `params` + per-item `itemParams`; resourceLocator values are supported;
 *   anything not given falls back to the default declared in the node description.
 * - Credentials, continueOnFail and binary input items.
 * - ILoadOptionsFunctions: getCurrentNodeParameter(s) read the same params (item 0).
 * - Anything else a test needs can be added to the returned object (Object.assign(ctx, {...}))
 *   without editing this shared file.
 *
 * The mock mirrors n8n's httpRequestWithAuthentication: when the request does NOT set
 * `ignoreHttpStatusErrors`, a queued status >= 400 is thrown as NodeApiError(AxiosError),
 * exactly like n8n does; otherwise the response is returned (full response when
 * `returnFullResponse` is set).
 */
import type {
  IBinaryData,
  IDataObject,
  IExecuteFunctions,
  IHttpRequestOptions,
  ILoadOptionsFunctions,
  INode,
  INodeExecutionData,
  INodeProperties,
  INodeType,
  JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

import { CREDENTIAL_TYPE } from '../../nodes/EvolutionApi/GenericFunctions';

export const TEST_BASE_URL = 'https://evo.test';
export const TEST_API_KEY = 'test-api-key';

export interface MockHttpResponse {
  /** Defaults to 200. */
  statusCode?: number;
  body?: unknown;
  headers?: IDataObject;
}

export interface RecordedRequest {
  method: string;
  /** Full URL without query string. */
  url: string;
  /** URL relative to the Base URL, e.g. /instance/connectionState/my-instance */
  path: string;
  qs?: IDataObject;
  body?: unknown;
  headers: IDataObject;
  credentialType: string;
  options: IHttpRequestOptions;
}

interface QueueEntry {
  method: string;
  matcher: string | RegExp;
  response?: MockHttpResponse;
  error?: unknown;
}

/** AxiosError look-alike: NodeApiError reads `constructor.name === 'AxiosError'`. */
export class AxiosError extends Error {
  isAxiosError = true;

  response?: { status: number; statusText?: string; data: unknown; headers: IDataObject };

  code?: string;

  constructor(message: string, status?: number, data?: unknown, headers: IDataObject = {}) {
    super(message);
    this.name = 'AxiosError';
    if (status !== undefined) this.response = { status, data, headers };
  }
}

export const TEST_NODE: INode = {
  id: 'evolution-test-node',
  name: 'Evolution API',
  type: '@renatoascencio/n8n-nodes-evolution-api.evolutionApi',
  typeVersion: 1,
  position: [0, 0],
  parameters: {},
};

/** Error n8n throws from httpRequestWithAuthentication for an HTTP error status. */
export function createN8nHttpError(
  statusCode: number,
  body?: unknown,
  headers: IDataObject = {},
  node: INode = TEST_NODE,
): NodeApiError {
  const axiosError = new AxiosError(
    `Request failed with status code ${statusCode}`,
    statusCode,
    body,
    headers,
  );
  return new NodeApiError(node, axiosError as unknown as JsonObject);
}

/** Connection-level error (no HTTP response), e.g. ECONNREFUSED. */
export function createNetworkError(code = 'ECONNREFUSED'): AxiosError {
  const error = new AxiosError(`connect ${code} 127.0.0.1:8080`);
  error.code = code;
  return error;
}

/** Build an input item carrying binary data. */
export function binaryItem(
  json: IDataObject = {},
  files: Record<string, { content: string | Buffer; fileName?: string; mimeType?: string }> = {},
): INodeExecutionData {
  const binary: Record<string, IBinaryData> = {};
  for (const [property, file] of Object.entries(files)) {
    const buffer = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content);
    binary[property] = {
      data: buffer.toString('base64'),
      mimeType: file.mimeType ?? 'application/octet-stream',
      fileName: file.fileName,
      fileSize: String(buffer.length),
    };
  }
  return { json, binary };
}

export interface MockOptions {
  /** Shared parameter values (resource, operation, instanceName, fields…). */
  params?: IDataObject;
  /** Per-item parameter overrides: itemParams[i] wins over params for item i. */
  itemParams?: IDataObject[];
  /** Input items. Defaults to one empty item. */
  items?: INodeExecutionData[];
  /** Credential data. Merged over { baseUrl, apiKey, defaultInstance: '' }. */
  credentials?: IDataObject;
  continueOnFail?: boolean;
  /**
   * When a parameter is not in params/itemParams, return the `default` declared in the node
   * description for the current resource/operation (as n8n does). Default: true.
   */
  useDescriptionDefaults?: boolean;
}

export class MockHttp {
  readonly calls: RecordedRequest[] = [];

  private readonly queueEntries: QueueEntry[] = [];

  constructor(private readonly baseUrl: string) {}

  /** Queue one or more responses (consumed in order) for method + url. */
  queue(method: string, url: string | RegExp, ...responses: MockHttpResponse[]): this {
    for (const response of responses) {
      this.queueEntries.push({ method: method.toUpperCase(), matcher: url, response });
    }
    return this;
  }

  /** Shortcut: queue a response body with an optional status code and headers. */
  reply(
    method: string,
    url: string | RegExp,
    body: unknown,
    statusCode = 200,
    headers: IDataObject = {},
  ): this {
    return this.queue(method, url, { statusCode, body, headers });
  }

  /** Queue a thrown error (n8n-shaped or network) for method + url. */
  queueError(method: string, url: string | RegExp, error: unknown): this {
    this.queueEntries.push({ method: method.toUpperCase(), matcher: url, error });
    return this;
  }

  /** Requests not consumed yet (assert it is empty at the end of a test). */
  get pending(): Array<{ method: string; url: string }> {
    return this.queueEntries.map((entry) => ({ method: entry.method, url: String(entry.matcher) }));
  }

  take(method: string, url: string): QueueEntry {
    const path = url.startsWith(this.baseUrl) ? url.substring(this.baseUrl.length) : url;
    const index = this.queueEntries.findIndex((entry) => {
      if (entry.method !== method.toUpperCase()) return false;
      if (entry.matcher instanceof RegExp)
        return entry.matcher.test(url) || entry.matcher.test(path);
      return entry.matcher === url || entry.matcher === path;
    });
    if (index === -1) {
      throw new Error(
        `Unexpected request ${method} ${url}. Queued: ${JSON.stringify(this.pending)}`,
      );
    }
    return this.queueEntries.splice(index, 1)[0];
  }
}

let nodeProperties: INodeProperties[] | undefined;

/** Default of a top-level parameter visible for resource + operation, from the node description. */
export function getDescriptionDefault(
  name: string,
  resource: unknown,
  operation: unknown,
): unknown {
  if (name.includes('.')) return undefined;
  if (!nodeProperties) {
    // Loaded lazily to keep this helper importable from any test.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { EvolutionApi } = require('../../nodes/EvolutionApi/EvolutionApi.node');
    nodeProperties = (new EvolutionApi() as INodeType).description.properties;
  }
  const property = nodeProperties.find((candidate) => {
    if (candidate.name !== name) return false;
    const show = candidate.displayOptions?.show ?? {};
    const resources = show.resource as unknown[] | undefined;
    const operations = show.operation as unknown[] | undefined;
    if (resources && !resources.includes(resource)) return false;
    if (operations && !operations.includes(operation)) return false;
    return true;
  });
  return property?.default;
}

function getPath(source: IDataObject, name: string): unknown {
  if (name in source) return source[name];
  return name.split('.').reduce<unknown>((value, key) => {
    if (value && typeof value === 'object' && key in (value as IDataObject)) {
      return (value as IDataObject)[key];
    }
    return undefined;
  }, source);
}

export type MockExecuteFunctions = IExecuteFunctions & {
  http: MockHttp;
  credentials: IDataObject;
};

/**
 * Create an IExecuteFunctions mock. Also usable as ILoadOptionsFunctions
 * (see createMockLoadOptionsFunctions).
 */
export function createMockExecuteFunctions(options: MockOptions = {}): MockExecuteFunctions {
  const credentials: IDataObject = {
    baseUrl: TEST_BASE_URL,
    apiKey: TEST_API_KEY,
    defaultInstance: '',
    ...(options.credentials ?? {}),
  };
  const baseUrl = String(credentials.baseUrl).trim().replace(/\/+$/, '');
  const http = new MockHttp(baseUrl);
  const items: INodeExecutionData[] = options.items ?? [{ json: {} }];
  const params = options.params ?? {};

  const httpRequestWithAuthentication = jest.fn(
    async (credentialType: string, requestOptions: IHttpRequestOptions) => {
      const method = String(requestOptions.method ?? 'GET').toUpperCase();
      const url = String(requestOptions.url);
      const headers: IDataObject = {
        ...((requestOptions.headers as IDataObject) ?? {}),
        apikey: credentials.apiKey,
      };
      http.calls.push({
        method,
        url,
        path: url.startsWith(baseUrl) ? url.substring(baseUrl.length) : url,
        qs: requestOptions.qs as IDataObject | undefined,
        body: requestOptions.body,
        headers,
        credentialType,
        options: requestOptions,
      });

      const entry = http.take(method, url);
      if (entry.error !== undefined) throw entry.error;

      const statusCode = entry.response?.statusCode ?? 200;
      const body = entry.response?.body;
      const responseHeaders = entry.response?.headers ?? {};

      if (statusCode >= 400 && !requestOptions.ignoreHttpStatusErrors) {
        throw createN8nHttpError(statusCode, body, responseHeaders);
      }
      if (requestOptions.returnFullResponse) {
        return { body, headers: responseHeaders, statusCode, statusMessage: '' };
      }
      return body;
    },
  );

  const getBinary = (itemIndex: number, propertyName: string): IBinaryData => {
    const binary = items[itemIndex]?.binary?.[propertyName];
    if (!binary) {
      throw new Error(
        `This operation expects the node's input data to contain a binary file '${propertyName}', but none was found [item ${itemIndex}]`,
      );
    }
    return binary;
  };

  /** Parameter lookup shared by getNodeParameter (execute) and getCurrentNodeParameter (UI). */
  const readParameter = (
    name: string,
    itemIndex: number,
    parameterOptions?: { extractValue?: boolean },
  ): unknown => {
    const perItem = options.itemParams?.[itemIndex] ?? {};
    let value = getPath(perItem, name);
    if (value === undefined) value = getPath(params, name);
    if (value === undefined && options.useDescriptionDefaults !== false) {
      value = getDescriptionDefault(
        name,
        getPath(perItem, 'resource') ?? params.resource,
        getPath(perItem, 'operation') ?? params.operation,
      );
    }
    if (
      parameterOptions?.extractValue &&
      value &&
      typeof value === 'object' &&
      '__rl' in (value as IDataObject)
    ) {
      return (value as IDataObject).value;
    }
    return value;
  };

  const context = {
    http,
    credentials,
    logger: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getInputData: jest.fn(() => items),
    getNode: jest.fn(() => TEST_NODE),
    continueOnFail: jest.fn(() => options.continueOnFail === true),
    getCredentials: jest.fn(async (type: string) => {
      if (type !== CREDENTIAL_TYPE) throw new Error(`Unknown credential type "${type}"`);
      return credentials;
    }),
    getNodeParameter: jest.fn(
      (
        name: string,
        itemIndex: number,
        fallbackValue?: unknown,
        parameterOptions?: { extractValue?: boolean },
      ) => {
        const value = readParameter(name, itemIndex, parameterOptions);
        if (value === undefined) {
          if (fallbackValue !== undefined) return fallbackValue;
          throw new Error(`Could not get parameter "${name}"`);
        }
        return value;
      },
    ),
    /** ILoadOptionsFunctions: parameters of the node being edited (item 0 of params/itemParams). */
    getCurrentNodeParameter: jest.fn(
      (name: string, parameterOptions?: { extractValue?: boolean }) =>
        readParameter(name, 0, parameterOptions),
    ),
    getCurrentNodeParameters: jest.fn(() => ({ ...params, ...(options.itemParams?.[0] ?? {}) })),
    helpers: {
      httpRequestWithAuthentication,
      httpRequest: jest.fn(async () => {
        throw new Error('Use httpRequestWithAuthentication: httpRequest must not be called');
      }),
      constructExecutionMetaData: jest.fn(
        (inputData: INodeExecutionData[], metadata: { itemData: IDataObject }) =>
          inputData.map((item) => ({ ...item, pairedItem: metadata.itemData })),
      ),
      returnJsonArray: jest.fn((data: IDataObject | IDataObject[]) =>
        (Array.isArray(data) ? data : [data]).map((json) => ({ json })),
      ),
      assertBinaryData: jest.fn((itemIndex: number, propertyName: string) =>
        getBinary(itemIndex, propertyName),
      ),
      getBinaryDataBuffer: jest.fn(async (itemIndex: number, propertyName: string) =>
        Buffer.from(getBinary(itemIndex, propertyName).data, 'base64'),
      ),
      prepareBinaryData: jest.fn(
        async (buffer: Buffer, fileName?: string, mimeType?: string): Promise<IBinaryData> => ({
          data: buffer.toString('base64'),
          mimeType: mimeType ?? 'application/octet-stream',
          fileName,
          fileSize: String(buffer.length),
        }),
      ),
    },
  };

  return context as unknown as MockExecuteFunctions;
}

/** Same mock typed as ILoadOptionsFunctions (for listSearch/loadOptions methods). */
export function createMockLoadOptionsFunctions(
  options: MockOptions = {},
): ILoadOptionsFunctions & { http: MockHttp } {
  return createMockExecuteFunctions(options) as unknown as ILoadOptionsFunctions & {
    http: MockHttp;
  };
}

/** resourceLocator value helper. */
export function rl(value: string, mode: 'list' | 'name' = 'name'): IDataObject {
  return { __rl: true, mode, value };
}
