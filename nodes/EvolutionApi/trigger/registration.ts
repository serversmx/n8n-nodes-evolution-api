import type { IDataObject, IHookFunctions } from 'n8n-workflow';

import { evolutionApiRequest, isPlainObject } from '../GenericFunctions';
import { EVOLUTION_EVENT_OPTIONS } from '../constants';
import { SECRET_HEADER_NAME } from './constants';

/**
 * "Automatic" mode: the trigger takes over the instance webhook while the workflow is active.
 *
 * Evolution keeps exactly ONE webhook per instance (`Webhook.instanceId` is unique and
 * /webhook/set upserts it), so activation saves the current configuration and deactivation
 * restores it (or disables the webhook when there was none).
 *
 * State lives in the node's static data under `registrations`, keyed by the n8n webhook URL:
 * the production URL (active workflow) and the test URL ("Listen for test event") never share
 * secrets or saved configurations. n8n keeps the test registration in its own copy of the
 * static data (`setTestStaticData`), so each endpoint normally sees only its own entry.
 */

/** How Evolution proves its identity to the trigger in Automatic mode. */
export type AutomaticAuthMethod = 'jwtAndHeader' | 'jwt' | 'header';

export interface WebhookRegistration extends IDataObject {
  /** Raw (not URL-encoded) instance name the webhook was registered on. */
  instanceName: string;
  auth: AutomaticAuthMethod;
  /** HS256 secret sent as `headers.jwt_key`. */
  jwtSecret?: string;
  /** Value of the SECRET_HEADER_NAME header. */
  headerSecret?: string;
  /** Webhook configuration found before the takeover (null: the instance had none). */
  previous: IDataObject | null;
  registeredAt: string;
  /** Registered for "Listen for test event" (the n8n test URL), not by an active workflow. */
  test?: boolean;
}

const REGISTRATIONS_KEY = 'registrations';
const MAX_RECOVERY_REGISTRATIONS = 1000;
const recoveryRegistrations = new Map<string, WebhookRegistration>();

const KNOWN_EVENTS = new Set(EVOLUTION_EVENT_OPTIONS.map((option) => String(option.value)));

function recoveryKey(context: IHookFunctions, webhookUrl: string): string {
  return JSON.stringify([context.getWorkflow().id ?? '', context.getNode().id, webhookUrl]);
}

/**
 * n8n activation rollback reloads static data from the database before newly created webhook
 * registrations have been saved. Keep a bounded process-local copy for that cleanup path.
 * It cannot recover a snapshot after a process restart or on another worker.
 */
export function rememberRegistration(
  context: IHookFunctions,
  webhookUrl: string,
  registration: WebhookRegistration,
): void {
  const key = recoveryKey(context, webhookUrl);
  recoveryRegistrations.delete(key);
  recoveryRegistrations.set(key, registration);
  if (recoveryRegistrations.size > MAX_RECOVERY_REGISTRATIONS) {
    const oldest = recoveryRegistrations.keys().next().value;
    if (oldest !== undefined) recoveryRegistrations.delete(oldest);
  }
}

export function getRecoveryRegistration(
  context: IHookFunctions,
  webhookUrl: string,
): WebhookRegistration | undefined {
  return recoveryRegistrations.get(recoveryKey(context, webhookUrl));
}

export function forgetRegistration(context: IHookFunctions, webhookUrl: string): void {
  recoveryRegistrations.delete(recoveryKey(context, webhookUrl));
}

/** Forget process-local recovery state (tests simulate a restart). */
export function resetRegistrationMemory(): void {
  recoveryRegistrations.clear();
}

/** Recognize only the random-secret header shapes this trigger writes. */
export function hasTriggerHeaders(found: IDataObject): boolean {
  if (!isPlainObject(found.headers)) return false;
  const entries = Object.entries(found.headers);
  return (
    entries.length > 0 &&
    entries.every(
      ([name, value]) =>
        (name === 'jwt_key' || name === SECRET_HEADER_NAME) &&
        typeof value === 'string' &&
        /^[a-f0-9]{64}$/.test(value),
    )
  );
}

export function getRegistrations(staticData: IDataObject): Record<string, WebhookRegistration> {
  const raw = staticData[REGISTRATIONS_KEY];
  const registrations: Record<string, WebhookRegistration> = {};
  if (!isPlainObject(raw)) return registrations;
  for (const [url, value] of Object.entries(raw)) {
    if (isPlainObject(value) && typeof value.instanceName === 'string') {
      registrations[url] = value as WebhookRegistration;
    }
  }
  return registrations;
}

/** Store the registrations as a new object so n8n detects the change and saves it. */
export function saveRegistrations(
  staticData: IDataObject,
  registrations: Record<string, WebhookRegistration>,
): void {
  staticData[REGISTRATIONS_KEY] = { ...registrations };
}

/**
 * The part of a /webhook/find row needed to restore it later, or null when the instance has
 * no webhook (`find` answers `null`, which the request helper turns into `{}`). A row without a
 * URL (possible through /instance/create) counts as none: /webhook/set rejects an empty `url`,
 * so restoring it would fail on every deactivation.
 */
export function snapshotWebhook(found: IDataObject): IDataObject | null {
  if (typeof found.url !== 'string' || found.url.trim() === '') return null;
  return {
    url: found.url,
    enabled: found.enabled === true,
    events: Array.isArray(found.events) ? found.events.map(String) : [],
    headers: isPlainObject(found.headers) ? found.headers : {},
    webhookByEvents: found.webhookByEvents === true,
    webhookBase64: found.webhookBase64 === true,
  };
}

/**
 * True when `url` is the other n8n endpoint of the same trigger node: the test URL while
 * `webhookUrl` is the production one, or the reverse. Both end with `/<node webhookId>/<path>`
 * (the webhookId is a UUID, unique per node) and only the base differs.
 */
export function isOtherEndpointOfNode(
  url: unknown,
  webhookUrl: string,
  webhookId: string | undefined,
): boolean {
  if (typeof url !== 'string' || url === webhookUrl || !webhookId) return false;
  const start = webhookUrl.lastIndexOf(`/${webhookId}/`);
  return start > 0 && url.endsWith(webhookUrl.slice(start));
}

/** Custom headers that make Evolution authenticate its deliveries to this trigger. */
export function buildAuthHeaders(registration: WebhookRegistration): IDataObject {
  const headers: IDataObject = {};
  if (registration.jwtSecret) headers.jwt_key = registration.jwtSecret;
  if (registration.headerSecret) headers[SECRET_HEADER_NAME] = registration.headerSecret;
  return headers;
}

/**
 * True when a /webhook/find row still carries this registration's secrets (someone may have
 * replaced the headers, e.g. from the Evolution manager, without changing the URL).
 */
export function hasRegistrationHeaders(
  found: IDataObject,
  registration: WebhookRegistration,
): boolean {
  const headers = isPlainObject(found.headers) ? found.headers : {};
  return Object.entries(buildAuthHeaders(registration)).every(
    ([name, value]) => headers[name] === value,
  );
}

/**
 * Body of POST /webhook/set (keys `byEvents`/`base64`, not the column names; `events` always
 * sent: a missing array makes 2.3.7/2.4 answer 500, and `[]` means every event).
 */
export function buildSetBody(webhook: {
  url: string;
  enabled: boolean;
  events: string[];
  headers: IDataObject;
  byEvents: boolean;
  base64: boolean;
}): IDataObject {
  return { webhook: { ...webhook } };
}

/**
 * Body that puts a saved configuration back. Event names that /webhook/set would reject
 * (stored through /instance/create, which does not validate them) are dropped, unless that
 * would leave an empty list (which means "every event").
 */
export function buildRestoreBody(previous: IDataObject): IDataObject {
  const events = Array.isArray(previous.events) ? previous.events.map(String) : [];
  const known = events.filter((event) => KNOWN_EVENTS.has(event));
  return buildSetBody({
    url: String(previous.url ?? ''),
    enabled: previous.enabled === true,
    events: known.length > 0 ? known : events,
    headers: isPlainObject(previous.headers) ? previous.headers : {},
    byEvents: previous.webhookByEvents === true,
    base64: previous.webhookBase64 === true,
  });
}

/** Body that disables the webhook and removes the trigger's secrets from Evolution. */
export function buildDisableBody(url: string): IDataObject {
  return buildSetBody({
    url,
    enabled: false,
    events: [],
    headers: {},
    byEvents: false,
    base64: false,
  });
}

export async function findWebhook(this: IHookFunctions, instance: string): Promise<IDataObject> {
  const found = await evolutionApiRequest.call(this, 'GET', `/webhook/find/${instance}`);
  return Array.isArray(found) ? {} : found;
}

export async function setWebhook(
  this: IHookFunctions,
  instance: string,
  body: IDataObject,
): Promise<void> {
  // /webhook/set is an upsert: repeating it after a 502/503 from a proxy is safe.
  await evolutionApiRequest.call(
    this,
    'POST',
    `/webhook/set/${instance}`,
    body,
    {},
    { idempotent: true },
  );
}

/** Semantic version of the server from the public `GET /` (undefined when unavailable). */
export async function getServerVersion(this: IHookFunctions): Promise<string | undefined> {
  try {
    const info = await evolutionApiRequest.call(this, 'GET', '/', {}, {}, { maxRetries: 0 });
    const version = Array.isArray(info) ? undefined : info.version;
    return typeof version === 'string' ? version : undefined;
  } catch (error) {
    this.logger.debug('Evolution API version check failed', { error: (error as Error).message });
    return undefined;
  }
}

/** True when `version` (e.g. "2.3.7") is lower than major.minor. */
export function isVersionBelow(version: string, major: number, minor: number): boolean {
  const match = /^(\d+)\.(\d+)/.exec(version.trim());
  if (!match) return false;
  const [actualMajor, actualMinor] = [Number(match[1]), Number(match[2])];
  return actualMajor < major || (actualMajor === major && actualMinor < minor);
}
