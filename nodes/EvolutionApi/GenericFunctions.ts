import type {
  IBinaryData,
  IDataObject,
  IExecuteFunctions,
  IHookFunctions,
  IHttpRequestMethods,
  IHttpRequestOptions,
  ILoadOptionsFunctions,
  INode,
  INodeListSearchResult,
  IWebhookFunctions,
  JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

import type { IEvolutionLicenseErrorBody } from './types';

// ============================================================================
// Constants
// ============================================================================

/** Internal name of the credential (see credentials/EvolutionApi.credentials.ts). */
export const CREDENTIAL_TYPE = 'evolutionWhatsAppApi';

/** Routes that accept a multipart upload in field "file" (multer upload.single('file')). */
export const MULTIPART_ROUTES = [
  'sendMedia',
  'sendPtv',
  'sendWhatsAppAudio',
  'sendStatus',
  'sendSticker',
] as const;

/** Suffixes of WhatsApp JIDs that must never be rewritten. */
export const JID_SUFFIXES = [
  '@s.whatsapp.net',
  '@g.us',
  '@lid',
  '@broadcast',
  '@newsletter',
  '@c.us',
] as const;

export type EvolutionContext =
  IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions | IWebhookFunctions;

// ============================================================================
// Retry policy
// ============================================================================

export interface RetryPolicy {
  /** Retries after the first attempt (0 disables retries). */
  maxRetries: number;
  /** First backoff delay; doubles on every retry. */
  baseDelayMs: number;
  /** Upper bound for a single wait (also caps Retry-After). */
  maxDelayMs: number;
  /** Wait implementation. Tests replace it to avoid real delays. */
  sleep: (ms: number) => Promise<void>;
}

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 15000,
  sleep: async (ms: number) => await sleep(ms),
};

let retryPolicy: RetryPolicy = { ...DEFAULT_RETRY_POLICY };

/** Override parts of the retry policy (used by tests to inject a fake sleep). */
export function setRetryPolicy(overrides: Partial<RetryPolicy>): void {
  retryPolicy = { ...retryPolicy, ...overrides };
}

/** Restore the default retry policy. */
export function resetRetryPolicy(): void {
  retryPolicy = { ...DEFAULT_RETRY_POLICY };
}

export function getRetryPolicy(): Readonly<RetryPolicy> {
  return retryPolicy;
}

const IDEMPOTENT_METHODS: IHttpRequestMethods[] = ['GET', 'HEAD', 'PUT', 'DELETE'];
const SAFE_METHODS: IHttpRequestMethods[] = ['GET', 'HEAD'];

export function isIdempotentMethod(method: IHttpRequestMethods): boolean {
  return IDEMPOTENT_METHODS.includes(method.toUpperCase() as IHttpRequestMethods);
}

/** GET/HEAD: repeating them never changes anything on the server. */
export function isSafeMethod(method: IHttpRequestMethods): boolean {
  return SAFE_METHODS.includes(method.toUpperCase() as IHttpRequestMethods);
}

/**
 * Decide whether a failed response may be retried.
 * - 429 is always retried: only proxies/rate limiters answer it (Evolution never does), and
 *   they reject the request before it reaches the server.
 * - 502/503 (the proxy could not reach Evolution) are retried for idempotent methods.
 * - 504 (the proxy gave up waiting, Evolution may have processed the request) is retried only
 *   for GET/HEAD: Evolution's DELETE routes answer 404/400 the second time (instance delete,
 *   logout on 2.3.x, leave group), which would turn a success into an error.
 * - `idempotent` overrides the method check for 502/503/504 (true for POST read routes,
 *   false for GET routes with side effects such as /group/acceptInviteCode).
 * - 503 LICENSE_REQUIRED is never retried.
 */
export function shouldRetry(
  statusCode: number,
  method: IHttpRequestMethods,
  body: unknown,
  idempotent?: boolean,
): boolean {
  if (statusCode === 429) return true;
  if (statusCode !== 502 && statusCode !== 503 && statusCode !== 504) return false;
  if (isLicenseRequiredError(statusCode, body)) return false;
  if (idempotent !== undefined) return idempotent;
  return statusCode === 504 ? isSafeMethod(method) : isIdempotentMethod(method);
}

/** Parse a Retry-After header (seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(value: unknown, now = Date.now()): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  const text = String(raw).trim();
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(parseFloat(text) * 1000);
  const date = Date.parse(text);
  if (!Number.isNaN(date)) return Math.max(0, date - now);
  return undefined;
}

/** Backoff for retry number `attempt` (0-based): Retry-After when present, else exponential. */
export function computeRetryDelay(
  attempt: number,
  retryAfterMs: number | undefined,
  policy: Pick<RetryPolicy, 'baseDelayMs' | 'maxDelayMs'> = retryPolicy,
): number {
  const delay = retryAfterMs ?? policy.baseDelayMs * Math.pow(2, attempt);
  return Math.min(Math.max(0, delay), policy.maxDelayMs);
}

// ============================================================================
// Small utilities
// ============================================================================

/**
 * Normalize and validate the base URL: trims whitespace and trailing slashes.
 */
export function normalizeBaseUrl(baseUrl: unknown): string {
  const trimmed = String(baseUrl ?? '')
    .trim()
    .replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(
      'Base URL must start with http:// or https:// (e.g. https://evolution.example.com)',
    );
  }
  return trimmed;
}

export function isPlainObject(value: unknown): value is IDataObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Return a copy without `undefined`, `null` and empty-string values (nested objects included). */
export function compactObject<T extends IDataObject>(obj: T): T {
  const result: IDataObject = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null || value === '') continue;
    result[key] = isPlainObject(value) ? compactObject(value) : value;
  }
  return result as T;
}

/** Wrap a single value into an array of objects. */
export function toArray(value: unknown): IDataObject[] {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) {
    return value.map((entry) => (isPlainObject(entry) ? entry : { value: entry as string }));
  }
  if (isPlainObject(value)) return [value];
  return [{ value: value as string }];
}

/**
 * Parse a JSON parameter that may arrive as a string (type: 'json') or already as an object.
 * Throws a plain Error; operation handlers run inside the node's error wrapper.
 */
export function parseJsonParameter(value: unknown, fieldName: string): unknown {
  if (typeof value !== 'string') return value;
  if (value.trim() === '') return undefined;
  let parsed: unknown;
  let valid = true;
  try {
    parsed = JSON.parse(value);
  } catch {
    valid = false;
  }
  // Thrown outside the catch block (n8n community lint: require-node-api-error).
  if (!valid) throw new Error(`Invalid JSON in "${fieldName}": check the JSON syntax`);
  return parsed;
}

function safeStringify(value: unknown, maxLength = 300): string {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  return text.length > maxLength ? `${text.substring(0, maxLength)}…` : text;
}

// ============================================================================
// Error normalization
// ============================================================================

/** True for the Evolution API 2.4+ license gate response (503 + code LICENSE_REQUIRED). */
export function isLicenseRequiredError(statusCode: number | undefined, body: unknown): boolean {
  return statusCode === 503 && isPlainObject(body) && body.code === 'LICENSE_REQUIRED';
}

/**
 * Collect human readable messages from any Evolution error body:
 * - `{ status, error, response: { message: [...] } }` (global error handler)
 * - `{ status, error, message: [...] }` (exception returned as-is, e.g. /chat/whatsappNumbers)
 * - `{ property, message }` entries (group/label validators)
 * - Meta template errors `{ message, details: { whatsapp_error } }`
 * - `{ error: true, message }` soft errors returned with HTTP 200
 */
export function extractEvolutionMessages(body: unknown): string[] {
  const messages: string[] = [];
  collectMessages(body, messages, 0);
  return [...new Set(messages)];
}

function collectMessages(value: unknown, out: string[], depth: number): void {
  if (value === undefined || value === null || depth > 6) return;
  if (typeof value === 'string') {
    const text = value.trim();
    // `error.toString()` of the plain objects Evolution throws yields "[object Object]"
    if (text && text !== '[object Object]') out.push(text);
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    if (depth > 0) out.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectMessages(entry, out, depth + 1);
    return;
  }
  if (!isPlainObject(value)) return;

  // whatsappNumber() result thrown by every send route (and fetchProfile) for unknown numbers:
  // { jid, exists: false, number, name?, lid? }
  if (depth > 0 && value.exists === false && (value.number || value.jid)) {
    const who = String(value.number ?? value.jid);
    const jid = value.jid && value.jid !== value.number ? ` (${String(value.jid)})` : '';
    out.push(`The number ${who}${jid} is not on WhatsApp`);
    return;
  }

  if (typeof value.property === 'string' && value.message !== undefined) {
    const inner: string[] = [];
    collectMessages(value.message, inner, depth + 1);
    out.push(inner.length ? `${value.property}: ${inner.join(', ')}` : value.property);
    return;
  }

  const start = out.length;
  const response = value.response;
  if (isPlainObject(response) && response.message !== undefined) {
    collectMessages(response.message, out, depth + 1);
  } else if (value.message !== undefined) {
    collectMessages(value.message, out, depth + 1);
  }

  const details = value.details;
  if (isPlainObject(details)) {
    const metaMessage = details.whatsapp_error ?? details.error_user_msg;
    if (typeof metaMessage === 'string' && metaMessage !== value.message) {
      collectMessages(metaMessage, out, depth + 1);
    }
  }

  if (out.length === start) {
    if (depth === 0) {
      if (typeof value.error === 'string') out.push(value.error);
    } else {
      out.push(safeStringify(value));
    }
  }
}

const STATUS_TEXT: Record<number, { title: string; hint: string }> = {
  400: {
    title: 'Bad request',
    hint: 'Evolution API rejected the request parameters. Check the fields mentioned in the message.',
  },
  401: {
    title: 'Unauthorized',
    hint: 'The API key was rejected. Use the global API key (AUTHENTICATION_API_KEY) or the token of this instance in the Evolution API credential.',
  },
  403: {
    title: 'Forbidden',
    hint: 'The request is not allowed (for example the instance name is already in use, or the operation needs the global API key).',
  },
  404: {
    title: 'Not found',
    hint: 'Check the instance name and the IDs you sent. A message like "Cannot POST /..." means this Evolution API version does not have the endpoint (features marked "Requires Evolution API 2.4+" need 2.4 or later).',
  },
  413: {
    title: 'Payload too large',
    hint: 'The request body is too large for Evolution API or its reverse proxy. Send media as a URL or reduce the file size.',
  },
  429: {
    title: 'Too many requests',
    hint: 'Evolution API (or a proxy in front of it) is rate limiting. The node already retried with backoff; reduce the batch size or add a Wait node.',
  },
  500: {
    title: 'Evolution API internal error',
    hint: 'The server failed to process the request. WhatsApp-side problems (instance not connected, invalid number) often surface as 500; check the Evolution API logs.',
  },
  502: {
    title: 'Bad gateway',
    hint: 'The reverse proxy in front of Evolution API could not reach it. Check that the Evolution API container is running.',
  },
  503: {
    title: 'Evolution API unavailable',
    hint: 'The server is temporarily unavailable. Idempotent requests were retried automatically.',
  },
  504: {
    title: 'Gateway timeout',
    hint: 'Evolution API did not answer in time and may still have processed the request. Only read requests are retried automatically; check the result before repeating a write.',
  },
};

export interface EvolutionErrorDetails {
  statusCode: number;
  body: unknown;
  method?: IHttpRequestMethods;
  endpoint?: string;
  baseUrl?: string;
  itemIndex?: number;
}

/**
 * Build a NodeApiError from an Evolution API error response.
 * 503 LICENSE_REQUIRED (Evolution 2.4+) gets a dedicated message that includes register_url.
 */
export function buildEvolutionApiError(node: INode, details: EvolutionErrorDetails): NodeApiError {
  const { statusCode, body, method, endpoint, baseUrl, itemIndex } = details;
  const errorResponse: JsonObject = isPlainObject(body)
    ? (body as JsonObject)
    : { response: body === undefined || body === null ? '' : safeStringify(body, 1000) };
  const where = method && endpoint ? ` (${method} ${endpoint})` : '';

  if (isLicenseRequiredError(statusCode, body)) {
    const license = body as IEvolutionLicenseErrorBody;
    const registerUrl =
      license.register_url || (baseUrl ? `${baseUrl}/manager/login` : '<Base URL>/manager/login');
    const statusUrl = baseUrl ? `${baseUrl}/license/status` : '<Base URL>/license/status';
    const docs = license.docs_url ? ` Docs: ${license.docs_url}` : '';
    return new NodeApiError(node, errorResponse, {
      message: `Evolution API license not activated (503 LICENSE_REQUIRED). Activate it at ${registerUrl}`,
      description: `Evolution API 2.4+ blocks every API route until the server license is activated. Open ${registerUrl} to activate it (or set AUTHENTICATION_API_KEY to a valid licensing key and restart the server), then confirm with GET ${statusUrl}. Retrying will not help until then.${docs}${where}`,
      httpCode: '503',
      itemIndex,
    });
  }

  const text = STATUS_TEXT[statusCode] ?? {
    title: statusCode >= 500 ? 'Evolution API server error' : 'Evolution API request failed',
    hint: 'Check the request parameters and the Evolution API logs.',
  };
  const apiMessages = extractEvolutionMessages(body);
  const detail = apiMessages.join('; ');
  const shortDetail = detail.length > 400 ? `${detail.substring(0, 400)}…` : detail;

  return new NodeApiError(node, errorResponse, {
    message: shortDetail ? `${text.title}: ${shortDetail}` : `${text.title} (HTTP ${statusCode})`,
    description: `${text.hint}${where}`,
    httpCode: String(statusCode),
    itemIndex,
  });
}

/**
 * Some Evolution routes (instance connect/restart) catch their own errors and answer HTTP 200
 * with `{ error: true, message }`. Turn those into real errors.
 */
export function assertNoSoftError(
  node: INode,
  response: unknown,
  itemIndex: number | undefined,
  fallbackMessage: string,
): void {
  if (!isPlainObject(response) || response.error !== true) return;
  const detail = extractEvolutionMessages(response).join('; ');
  throw new NodeApiError(node, response as JsonObject, {
    message: detail ? `Evolution API reported an error: ${detail}` : fallbackMessage,
    description: 'Evolution API answered HTTP 200 but flagged the result as an error.',
    itemIndex,
  });
}

interface ExtractedHttpError {
  statusCode?: number;
  body?: unknown;
  headers?: IDataObject;
}

/**
 * Read status/body from errors thrown by n8n request helpers:
 * NodeApiError (httpCode + context.data), AxiosError (response.status/data) and
 * request-promise style errors (statusCode + error).
 */
export function extractHttpErrorDetails(error: unknown): ExtractedHttpError {
  if (!isPlainObject(error) && !(error instanceof Error)) return {};
  const err = error as unknown as IDataObject;
  const response = isPlainObject(err.response) ? err.response : undefined;
  const cause = isPlainObject(err.cause) ? err.cause : undefined;
  const causeResponse = cause && isPlainObject(cause.response) ? cause.response : undefined;
  const context = isPlainObject(err.context) ? err.context : undefined;

  const candidates: unknown[] = [
    response?.status,
    response?.statusCode,
    err.statusCode,
    err.httpCode,
    causeResponse?.status,
    cause?.statusCode,
  ];
  let statusCode: number | undefined;
  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (
      candidate !== undefined &&
      candidate !== null &&
      Number.isInteger(parsed) &&
      parsed >= 100
    ) {
      statusCode = parsed;
      break;
    }
  }
  if (statusCode === undefined) return {};

  const body =
    response?.data ??
    response?.body ??
    causeResponse?.data ??
    context?.data ??
    err.errorResponse ??
    err.error;
  const headers =
    (isPlainObject(response?.headers) ? response?.headers : undefined) ??
    (isPlainObject(causeResponse?.headers) ? causeResponse?.headers : undefined);

  return { statusCode, body, headers: headers as IDataObject | undefined };
}

// ============================================================================
// HTTP requests
// ============================================================================

export interface EvolutionRequestOptions {
  /** Item index, attached to errors so n8n highlights the failing item. */
  itemIndex?: number;
  /**
   * Mark a non-idempotent method as safe to repeat, enabling 502/503/504 retries.
   * Use it for read routes that Evolution exposes as POST (e.g. /chat/findChats).
   */
  idempotent?: boolean;
  /** Override the policy's retry count (0 disables retries for this call). */
  maxRetries?: number;
  /** Request timeout in milliseconds. */
  timeout?: number;
  /** Extra headers. Authentication always comes from the credential. */
  headers?: IDataObject;
}

export interface EvolutionFullResponse {
  statusCode: number;
  headers: IDataObject;
  body: unknown;
}

async function getBaseUrl(this: EvolutionContext, itemIndex?: number): Promise<string> {
  const credentials = await this.getCredentials(CREDENTIAL_TYPE);
  try {
    return normalizeBaseUrl(credentials.baseUrl);
  } catch (error) {
    throw new NodeOperationError(this.getNode(), (error as Error).message, { itemIndex });
  }
}

function isFormData(value: unknown): value is FormData {
  return typeof FormData !== 'undefined' && value instanceof FormData;
}

function unwrapFullResponse(response: unknown): EvolutionFullResponse {
  if (isPlainObject(response) && typeof response.statusCode === 'number' && 'body' in response) {
    return {
      statusCode: response.statusCode,
      headers: isPlainObject(response.headers) ? response.headers : {},
      body: response.body,
    };
  }
  // Helper ignored returnFullResponse: whatever came back is the body of a 2xx response.
  return { statusCode: 200, headers: {}, body: response };
}

function getHeader(headers: IDataObject, name: string): unknown {
  const key = Object.keys(headers).find((header) => header.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

/**
 * Low-level request: authentication through the credential (header `apikey`), retries and
 * error normalization. Returns status, headers and the raw body of a successful response.
 */
export async function evolutionApiRawRequest(
  this: EvolutionContext,
  method: IHttpRequestMethods,
  endpoint: string,
  body: IDataObject | IDataObject[] | FormData = {},
  qs: IDataObject = {},
  options: EvolutionRequestOptions = {},
): Promise<EvolutionFullResponse> {
  const baseUrl = await getBaseUrl.call(this, options.itemIndex);
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

  const requestOptions: IHttpRequestOptions = {
    method,
    url: `${baseUrl}${path}`,
    json: true,
    returnFullResponse: true,
    ignoreHttpStatusErrors: true,
    headers: { Accept: 'application/json', ...(options.headers ?? {}) },
  };

  const cleanQs = compactObject(qs);
  if (Object.keys(cleanQs).length > 0) requestOptions.qs = cleanQs;

  if (isFormData(body)) {
    // Let the HTTP client set multipart/form-data with its boundary.
    requestOptions.body = body;
  } else if (method !== 'GET' && method !== 'HEAD') {
    const hasBody = Array.isArray(body) ? body.length > 0 : Object.keys(body).length > 0;
    if (hasBody) {
      requestOptions.body = body;
      requestOptions.headers = { ...requestOptions.headers, 'Content-Type': 'application/json' };
    }
  }

  if (options.timeout !== undefined) requestOptions.timeout = options.timeout;

  const policy = retryPolicy;
  const maxRetries = Math.max(0, options.maxRetries ?? policy.maxRetries);

  for (let attempt = 0; ; attempt++) {
    let result: EvolutionFullResponse;
    try {
      const response: unknown = await this.helpers.httpRequestWithAuthentication.call(
        this,
        CREDENTIAL_TYPE,
        requestOptions,
      );
      result = unwrapFullResponse(response);
    } catch (error) {
      const extracted = extractHttpErrorDetails(error);
      if (extracted.statusCode === undefined) {
        // Network or unexpected error: no HTTP status to act upon.
        const apiError = new NodeApiError(this.getNode(), error as JsonObject, {
          itemIndex: options.itemIndex,
        });
        if (options.itemIndex !== undefined) apiError.context.itemIndex = options.itemIndex;
        throw apiError;
      }
      result = {
        statusCode: extracted.statusCode,
        headers: extracted.headers ?? {},
        body: extracted.body,
      };
    }

    if (result.statusCode < 400) return result;

    if (
      attempt < maxRetries &&
      shouldRetry(result.statusCode, method, result.body, options.idempotent)
    ) {
      const retryAfter = parseRetryAfter(getHeader(result.headers, 'retry-after'));
      await policy.sleep(computeRetryDelay(attempt, retryAfter, policy));
      continue;
    }

    throw buildEvolutionApiError(this.getNode(), {
      statusCode: result.statusCode,
      body: result.body,
      method,
      endpoint: path,
      baseUrl,
      itemIndex: options.itemIndex,
    });
  }
}

/**
 * Make an authenticated request to Evolution API and return the parsed body.
 *
 * - `endpoint` is relative to the Base URL, e.g. `/instance/connectionState/${instance}`
 *   (use resolveInstanceName() to get the URL-encoded instance).
 * - `body` is sent as JSON (omitted when empty); pass a FormData for multipart routes.
 * - Empty bodies (`null`, `''`) come back as `{}`; primitives as `{ result: value }`.
 */
export async function evolutionApiRequest(
  this: EvolutionContext,
  method: IHttpRequestMethods,
  endpoint: string,
  body: IDataObject | IDataObject[] | FormData = {},
  qs: IDataObject = {},
  options: EvolutionRequestOptions = {},
): Promise<IDataObject | IDataObject[]> {
  const response = await evolutionApiRawRequest.call(this, method, endpoint, body, qs, options);
  const data = response.body;
  if (data === undefined || data === null || data === '') return {};
  if (Array.isArray(data)) return data as IDataObject[];
  if (isPlainObject(data)) return data;
  return { result: data as string };
}

// ============================================================================
// Instance name
// ============================================================================

/** Value of a resourceLocator (or plain string) parameter, trimmed. */
export function extractResourceLocatorValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (isPlainObject(value)) return String(value.value ?? '').trim();
  return String(value).trim();
}

/** Values that survive encodeURIComponent() but are removed by URL path normalization. */
const UNSAFE_PATH_SEGMENTS = ['', '.', '..'];

/**
 * Encode one URL path segment (instance name, bot ID, credential ID…).
 * "", "." and ".." are rejected: `/instance/connectionState/..` would be normalized to
 * `/instance/` and reach another route. Throws a plain Error (handlers run inside the node's
 * error wrapper, which adds the item index).
 */
export function encodePathSegment(value: unknown, label = 'ID'): string {
  const text = value === undefined || value === null ? '' : String(value);
  if (UNSAFE_PATH_SEGMENTS.includes(text)) {
    throw new Error(
      text ? `${label} "${text}" is not allowed in a URL path` : `${label} is required`,
    );
  }
  return encodeURIComponent(text);
}

/**
 * Resolve an instance from a raw parameter value (string or resourceLocator): the value, else
 * the credential's Default Instance Name, else a clear error. URL-encoded unless
 * `encode: false`. Works in every context (execute, loadOptions/listSearch, hooks, webhooks):
 * - loadOptions: `resolveInstanceNameFromValue.call(this, this.getCurrentNodeParameter('instanceName', { extractValue: true }))`
 * - trigger hooks: `resolveInstanceNameFromValue.call(this, this.getNodeParameter('instanceName', '', { extractValue: true }))`
 */
export async function resolveInstanceNameFromValue(
  this: EvolutionContext,
  value: unknown,
  options: { itemIndex?: number; encode?: boolean; allowDefault?: boolean } = {},
): Promise<string> {
  let name = extractResourceLocatorValue(value);

  if (!name && options.allowDefault === false) {
    throw new NodeOperationError(this.getNode(), 'Instance Name is required for this operation', {
      itemIndex: options.itemIndex,
      description: 'Select an explicit instance. This operation does not use the credential default.',
    });
  }

  if (!name) {
    const credentials = await this.getCredentials(CREDENTIAL_TYPE);
    name = String(credentials.defaultInstance ?? '').trim();
  }

  if (!name) {
    throw new NodeOperationError(this.getNode(), 'No instance selected', {
      itemIndex: options.itemIndex,
      description:
        'Choose an instance in the "Instance Name" field or set "Default Instance Name" in the Evolution API credential.',
    });
  }

  if (UNSAFE_PATH_SEGMENTS.includes(name)) {
    throw new NodeOperationError(this.getNode(), `Invalid instance name "${name}"`, {
      itemIndex: options.itemIndex,
      description: '"." and ".." cannot be used as instance names in a URL.',
    });
  }

  return options.encode === false ? name : encodeURIComponent(name);
}

/**
 * Resolve the instance for an item: the node's "Instance Name" parameter, else the
 * credential's Default Instance Name, else a clear error. URL-encoded unless `encode: false`.
 */
export async function resolveInstanceName(
  this: IExecuteFunctions,
  itemIndex: number,
  options: { parameterName?: string; encode?: boolean; allowDefault?: boolean } = {},
): Promise<string> {
  const parameterName = options.parameterName ?? 'instanceName';
  const value = this.getNodeParameter(parameterName, itemIndex, '', { extractValue: true });
  if (!extractResourceLocatorValue(value)) {
    const raw = this.getNodeParameter(parameterName, itemIndex, '', { rawExpressions: true });
    // A locator can contain an expression in `value`, or the entire parameter can be one.
    if (extractResourceLocatorValue(raw).startsWith('=')) {
      throw new NodeOperationError(this.getNode(), 'Instance Name expression resolved to an empty value', {
        itemIndex,
        description: `Provide an instance for item ${itemIndex + 1}. Empty expressions do not use the credential default.`,
      });
    }
  }
  return await resolveInstanceNameFromValue.call(this, value, {
    itemIndex,
    encode: options.encode,
    allowDefault: options.allowDefault,
  });
}

/** listSearch method for the shared "Instance Name" resource locator. */
export async function searchInstances(
  this: ILoadOptionsFunctions,
  filter?: string,
): Promise<INodeListSearchResult> {
  const response = await evolutionApiRequest.call(this, 'GET', '/instance/fetchInstances');
  const needle = (filter ?? '').trim().toLowerCase();

  const results = toArray(response)
    .map((instance) => {
      const legacy = isPlainObject(instance.instance) ? instance.instance : {};
      const name = String(instance.name ?? legacy.instanceName ?? '').trim();
      const status = instance.connectionStatus ?? legacy.status;
      return { name, status: typeof status === 'string' ? status : '' };
    })
    .filter(
      (instance) => instance.name && (!needle || instance.name.toLowerCase().includes(needle)),
    )
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((instance) => ({
      name: instance.status ? `${instance.name} (${instance.status})` : instance.name,
      value: instance.name,
    }));

  return { results };
}

// ============================================================================
// Numbers and JIDs
// ============================================================================

/**
 * Normalize a phone number or JID for Evolution "number"-style fields.
 *
 * - Anything containing "@" is a JID and is returned unchanged (only trimmed), so
 *   `@lid`, `@g.us`, `@s.whatsapp.net`, `@broadcast` and `@newsletter` identifiers survive.
 * - Legacy group ids ("5511999999999-1600000000") are kept.
 * - Formatted phone numbers are reduced to digits: "+52 1 (55) 1234-5678" → "5215512345678".
 * - Anything else is returned trimmed; Evolution's createJid() has the final word
 *   (country-specific rules such as the Brazilian 9th digit are applied server side).
 */
export function normalizeNumber(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (text.includes('@')) return text;
  if (/^\d+-\d+$/.test(text) && text.length >= 24) return text;
  const digits = text.replace(/[\s+().-]/g, '');
  return /^\d+$/.test(digits) ? digits : text;
}

/**
 * Build a full JID for fields that expect one (e.g. `remoteJid` inside a message key).
 * JIDs are preserved; numbers get `@s.whatsapp.net`, group ids get `@g.us`.
 */
export function toJid(value: unknown): string {
  const normalized = normalizeNumber(value);
  if (!normalized || normalized.includes('@')) return normalized;
  if (/^\d+-\d+$/.test(normalized) || /^\d{18,}$/.test(normalized)) return `${normalized}@g.us`;
  return `${normalized}@s.whatsapp.net`;
}

/** Split a comma/newline separated string (or array) of numbers/JIDs, normalize and dedupe. */
export function normalizeNumberList(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : String(value ?? '').split(/[,\n;]/);
  const normalized = entries.map((entry) => normalizeNumber(entry)).filter((entry) => entry);
  return [...new Set(normalized)];
}

export function isGroupJid(value: unknown): boolean {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .endsWith('@g.us');
}

export function isLidJid(value: unknown): boolean {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .endsWith('@lid');
}

// ============================================================================
// Media and binary data
// ============================================================================

export type MediaInputType = 'url' | 'base64' | 'binary';

export interface IMediaInput {
  type: MediaInputType;
  /** type 'url': http(s) URL reachable by the Evolution server. */
  url?: string;
  /** type 'base64': raw base64 or a data: URI (the prefix is stripped). */
  base64?: string;
  /** type 'binary': name of the binary property of the input item (e.g. "data"). */
  binaryPropertyName?: string;
  /** Optional overrides. */
  fileName?: string;
  mimeType?: string;
}

export interface IResolvedMedia {
  type: MediaInputType;
  /** URL or raw base64 (never a data: URI), ready for JSON bodies. */
  value: string;
  /** File contents when the source was an n8n binary property. */
  buffer?: Buffer;
  fileName?: string;
  mimeType?: string;
}

/** Split a data: URI into mime type and base64 payload. Other strings are returned as data. */
export function parseDataUri(value: string): { mimeType?: string; data: string } {
  const match = /^data:([^;,]*)(;[^,]*)?,(.*)$/s.exec(value.trim());
  if (!match) return { data: value.trim() };
  return { mimeType: match[1] || undefined, data: match[3] };
}

/** Strip whitespace and a data: prefix; validate the base64 alphabet and padding. */
export function cleanBase64(value: string): { data: string; mimeType?: string; valid: boolean } {
  const { mimeType, data } = parseDataUri(value);
  const cleaned = data.replace(/\s+/g, '');
  const valid =
    cleaned.length > 0 && cleaned.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(cleaned);
  return { data: cleaned, mimeType, valid };
}

/**
 * Resolve media from a URL, a base64 string or an n8n binary property.
 * Evolution rejects data: URIs ("Owned media must be a url or base64"), so they are stripped.
 */
export async function resolveMedia(
  this: IExecuteFunctions,
  itemIndex: number,
  input: IMediaInput,
): Promise<IResolvedMedia> {
  if (input.type === 'url') {
    const url = String(input.url ?? '').trim();
    if (!/^https?:\/\//i.test(url)) {
      throw new NodeOperationError(
        this.getNode(),
        'Media URL must start with http:// or https://',
        {
          itemIndex,
        },
      );
    }
    return { type: 'url', value: url, fileName: input.fileName, mimeType: input.mimeType };
  }

  if (input.type === 'base64') {
    const { data, mimeType, valid } = cleanBase64(String(input.base64 ?? ''));
    if (!valid) {
      throw new NodeOperationError(this.getNode(), 'Media is not valid base64', {
        itemIndex,
        description: 'Send raw base64 (a data: URI prefix is removed automatically) or use a URL.',
      });
    }
    return {
      type: 'base64',
      value: data,
      fileName: input.fileName,
      mimeType: input.mimeType ?? mimeType,
    };
  }

  const propertyName = String(input.binaryPropertyName ?? 'data').trim() || 'data';
  const binaryData = this.helpers.assertBinaryData(itemIndex, propertyName);
  const buffer = await this.helpers.getBinaryDataBuffer(itemIndex, propertyName);
  return {
    type: 'binary',
    value: buffer.toString('base64'),
    buffer,
    fileName: input.fileName || binaryData.fileName,
    mimeType: input.mimeType || binaryData.mimeType,
  };
}

/**
 * True when every value is a string (or string array/object of strings). Evolution validates
 * multipart text fields with the same JSON schema as JSON bodies, so numbers and booleans
 * (delay, linkPreview, mentionsEveryOne, quoted.key.fromMe…) fail validation in multipart.
 */
export function isMultipartSafe(fields: IDataObject): boolean {
  const check = (value: unknown): boolean => {
    if (value === undefined || value === null) return true;
    if (typeof value === 'string') return true;
    if (Array.isArray(value)) return value.every(check);
    if (isPlainObject(value)) return Object.values(value).every(check);
    return false;
  };
  return check(fields);
}

function appendFormValue(form: FormData, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => appendFormValue(form, `${key}[${index}]`, entry));
    return;
  }
  if (isPlainObject(value)) {
    for (const [subKey, subValue] of Object.entries(value)) {
      appendFormValue(form, `${key}[${subKey}]`, subValue);
    }
    return;
  }
  form.append(key, String(value));
}

/**
 * Build a multipart body: text fields (nested values use bracket notation, parsed by multer)
 * plus an optional file in `fileField` (Evolution uses "file").
 */
export function buildMultipartBody(
  fields: IDataObject,
  file?: { buffer: Buffer; fileName?: string; mimeType?: string },
  fileField = 'file',
): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) appendFormValue(form, key, value);
  if (file) {
    // Uint8Array copy: a Buffer may sit on a shared/pooled ArrayBuffer, which the DOM
    // typing of BlobPart (and some runtimes) reject.
    const blob = new Blob([new Uint8Array(file.buffer)], {
      type: file.mimeType || 'application/octet-stream',
    });
    form.append(fileField, blob, file.fileName || 'file');
  }
  return form;
}

/**
 * Build the body for a media route. Binary media goes as multipart when the route accepts
 * uploads (`allowMultipart`, see MULTIPART_ROUTES) and every other field is a string;
 * otherwise the media is inlined as `mediaField` (URL or base64) in a JSON body.
 */
export function buildMediaRequestBody(
  media: IResolvedMedia,
  fields: IDataObject,
  options: { mediaField?: string; allowMultipart?: boolean; fileField?: string } = {},
): IDataObject | FormData {
  const mediaField = options.mediaField ?? 'media';
  if (
    media.type === 'binary' &&
    media.buffer &&
    options.allowMultipart &&
    isMultipartSafe(fields)
  ) {
    return buildMultipartBody(
      fields,
      { buffer: media.buffer, fileName: media.fileName, mimeType: media.mimeType },
      options.fileField ?? 'file',
    );
  }
  return { ...fields, [mediaField]: media.value };
}

/**
 * Convert base64 (or a data: URI such as Evolution's QR code `base64`) to n8n binary data.
 */
export async function base64ToBinary(
  this: IExecuteFunctions,
  value: string,
  fileName?: string,
  mimeType?: string,
): Promise<IBinaryData> {
  const { data, mimeType: detectedMimeType } = cleanBase64(value);
  return await this.helpers.prepareBinaryData(
    Buffer.from(data, 'base64'),
    fileName,
    mimeType ?? detectedMimeType,
  );
}
