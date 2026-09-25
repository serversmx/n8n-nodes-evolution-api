import type {
  IDataObject,
  IHookFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  IWebhookFunctions,
  IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { REQUIRES_24 } from './constants';
import {
  CREDENTIAL_TYPE,
  isPlainObject,
  resolveInstanceNameFromValue,
  searchInstances,
} from './GenericFunctions';
import type { VerificationConfig, VerificationResult } from './trigger/auth';
import { generateSecret, getHeaderValue, verifyWebhookRequest } from './trigger/auth';
import {
  DEFAULT_JWT_LEEWAY_SECONDS,
  MESSAGE_TYPE_OPTIONS,
  SECRET_HEADER_NAME,
  TRIGGER_24_ONLY_EVENTS,
  TRIGGER_EVENT_OPTIONS,
} from './trigger/constants';
import { getDeliveryKey, isDuplicateDelivery, rememberDelivery } from './trigger/dedupe';
import {
  findWebhookMedia,
  getEventTimestamp,
  getFilterReason,
  getMessageFields,
  normalizeEventName,
  parseList,
  withoutMediaBase64,
} from './trigger/payload';
import type { AutomaticAuthMethod, WebhookRegistration } from './trigger/registration';
import {
  buildAuthHeaders,
  buildDisableBody,
  buildRestoreBody,
  buildSetBody,
  findWebhook,
  forgetRegistration,
  getRecoveryRegistration,
  getRegistrations,
  getServerVersion,
  hasRegistrationHeaders,
  hasTriggerHeaders,
  isOtherEndpointOfNode,
  isVersionBelow,
  rememberRegistration,
  saveRegistrations,
  setWebhook,
  snapshotWebhook,
} from './trigger/registration';

type TriggerMode = 'automatic' | 'manual';
type ManualAuthMethod = 'none' | AutomaticAuthMethod;

const MANUAL_AUTH_METHODS: ManualAuthMethod[] = ['none', 'jwt', 'jwtAndHeader', 'header'];

function getTriggerMode(context: IHookFunctions | IWebhookFunctions): TriggerMode {
  return context.getNodeParameter('mode', 'automatic') === 'manual' ? 'manual' : 'automatic';
}

function getAutomaticAuth(context: IHookFunctions): AutomaticAuthMethod {
  const value = context.getNodeParameter('autoAuth', 'jwtAndHeader');
  return value === 'jwt' || value === 'header' ? value : 'jwtAndHeader';
}

function getSelectedEvents(context: IHookFunctions | IWebhookFunctions): string[] {
  const events = context.getNodeParameter('events', []);
  return Array.isArray(events) ? events.map(String) : [];
}

function getWebhookUrl(context: IHookFunctions): string {
  const url = context.getNodeWebhookUrl('default');
  if (!url) {
    throw new NodeOperationError(
      context.getNode(),
      'The webhook URL of this node is not available',
    );
  }
  return url;
}

async function getInstanceName(context: IHookFunctions): Promise<string> {
  return await resolveInstanceNameFromValue.call(
    context,
    context.getNodeParameter('instanceName', '', { extractValue: true }),
    { encode: false },
  );
}

/**
 * Manual-mode secrets from the node parameters. Returns an error message when the selected
 * method lacks its secret (checked on activation, so the user sees it immediately).
 */
function getManualVerification(
  context: IHookFunctions | IWebhookFunctions,
): { config: Omit<VerificationConfig, 'jwtLeewaySeconds' | 'nowSeconds'> } | { error: string } {
  const method = context.getNodeParameter('manualAuth', 'jwt') as ManualAuthMethod;
  if (!MANUAL_AUTH_METHODS.includes(method)) {
    return { error: `Unknown authentication method "${String(method)}"` };
  }
  const config: Omit<VerificationConfig, 'jwtLeewaySeconds' | 'nowSeconds'> = {};
  if (method === 'header' || method === 'jwtAndHeader') {
    const name = String(context.getNodeParameter('headerName', SECRET_HEADER_NAME)).trim();
    const value = String(context.getNodeParameter('headerValue', ''));
    if (!value) return { error: 'Set "Header Value" (the secret header Evolution sends)' };
    config.secretHeader = { name: name || SECRET_HEADER_NAME, value };
  }
  if (method === 'jwt' || method === 'jwtAndHeader') {
    const secret = String(context.getNodeParameter('jwtSecret', ''));
    if (!secret) return { error: 'Set "JWT Secret" (the jwt_key of the Evolution webhook)' };
    config.jwtSecret = secret;
  }
  return { config };
}

/**
 * The n8n URL this request arrived on, when n8n can tell. `IWebhookFunctions.getNodeWebhookUrl`
 * always returns the PRODUCTION URL, also while serving "Listen for test event"; newer n8n
 * versions add `getWebhookResourceUrl`, which returns the endpoint actually served.
 */
function getServedWebhookUrl(context: IWebhookFunctions): string | undefined {
  return (
    context as IWebhookFunctions & {
      getWebhookResourceUrl?: (name: 'default') => string | undefined;
    }
  ).getWebhookResourceUrl?.('default');
}

/**
 * Automatic-mode registrations whose secrets may sign this request: the one of the served URL.
 * Without `getWebhookResourceUrl`, a test delivery (execution mode 'manual') is matched against
 * the registrations of the test URL, i.e. every registration except the production one.
 */
function getRequestRegistrations(
  context: IWebhookFunctions,
  staticData: IDataObject,
  productionUrl: string,
): WebhookRegistration[] {
  const registrations = getRegistrations(staticData);
  const servedUrl = getServedWebhookUrl(context);
  if (servedUrl || context.getMode() !== 'manual') {
    const registration = registrations[servedUrl || productionUrl];
    return registration ? [registration] : [];
  }
  return Object.entries(registrations)
    .filter(([url]) => url !== productionUrl)
    .map(([, registration]) => registration);
}

/** Answer the request directly (no workflow run), e.g. 401 for unauthenticated calls. */
function respond(
  context: IWebhookFunctions,
  status: number,
  message: string,
): IWebhookResponseData {
  context.getResponseObject().status(status).json({ message });
  return { noWebhookResponse: true };
}

/**
 * Evolution API Trigger: one workflow run per webhook delivery (the envelope
 * `{ event, instance, data, destination, date_time, sender, server_url }` plus normalized fields).
 *
 * - Automatic mode takes over the instance webhook (POST /webhook/set) while the workflow is
 *   active and restores the previous configuration afterwards (see trigger/registration.ts).
 * - Manual mode receives what the user configured (instance or global webhook).
 * - Every request is verified (JWT HS256 and/or secret header, trigger/auth.ts), filtered,
 *   deduplicated (trigger/dedupe.ts) and answered with 200 right away (`onReceived`);
 *   unauthenticated requests get 401, which Evolution does not retry.
 */
export class EvolutionApiTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Evolution API Trigger',
    name: 'evolutionApiTrigger',
    icon: 'file:evolution.svg',
    group: ['trigger'],
    version: 1,
    subtitle:
      '={{($parameter["events"] || []).length ? $parameter["events"].join(", ") : "All events"}}',
    description: 'Starts the workflow when Evolution API (WhatsApp) sends a webhook event',
    defaults: {
      name: 'Evolution API Trigger',
    },
    eventTriggerDescription: 'Waiting for Evolution API to send an event',
    activationMessage: 'Evolution API webhook events will now start this workflow.',
    inputs: [],
    outputs: [NodeConnectionTypes.Main],
    credentials: [
      {
        name: CREDENTIAL_TYPE,
        required: true,
        displayOptions: { show: { mode: ['automatic'] } },
      },
    ],
    webhooks: [
      {
        name: 'default',
        httpMethod: 'POST',
        responseMode: 'onReceived',
        path: 'webhook',
      },
    ],
    properties: [
      {
        displayName: 'Mode',
        name: 'mode',
        type: 'options',
        noDataExpression: true,
        options: [
          {
            name: 'Automatic (Instance Webhook)',
            value: 'automatic',
            description:
              'On activation n8n registers this URL as the instance webhook (authenticated with a random secret) and restores the previous webhook on deactivation',
          },
          {
            name: 'Manual / Global Webhook',
            value: 'manual',
            description:
              'You configure the webhook in Evolution API yourself (instance webhook or WEBHOOK_GLOBAL_URL); n8n only receives and verifies the events',
          },
        ],
        default: 'automatic',
      },
      {
        displayName:
          "Evolution API keeps only ONE webhook per instance. While this workflow is active (or listening for a test event), this trigger takes over the instance webhook: it saves the current configuration and replaces it with this node's URL, protected by a random JWT secret and/or secret header. The saved configuration is restored when the workflow is deactivated. Do not use the same instance in two automatic triggers or with other webhook consumers at the same time.",
        name: 'automaticNotice',
        type: 'notice',
        default: '',
        displayOptions: { show: { mode: ['automatic'] } },
      },
      {
        displayName:
          'Configure Evolution API yourself with the webhook URL above and "Webhook by Events" off: either as the instance webhook (Webhook > Set; add a secret header or a jwt_key in its headers) or as WEBHOOK_GLOBAL_URL. The global webhook cannot send headers or a JWT, so it cannot be authenticated: use Authentication "None" and restrict access to the URL at network level.',
        name: 'manualNotice',
        type: 'notice',
        default: '',
        displayOptions: { show: { mode: ['manual'] } },
      },
      {
        displayName: 'Instance Name',
        name: 'instanceName',
        type: 'resourceLocator',
        default: { mode: 'list', value: '' },
        description:
          'Instance whose webhook this trigger takes over. Leave empty to use the "Default Instance Name" of the credential.',
        displayOptions: { show: { mode: ['automatic'] } },
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
      },
      {
        displayName: 'Events',
        name: 'events',
        type: 'multiOptions',
        options: TRIGGER_EVENT_OPTIONS,
        default: ['MESSAGES_UPSERT'],
        description: `Events that start the workflow; leave empty for every event. In Automatic mode only these events are registered in Evolution. Messaging History Set: ${REQUIRES_24}`,
      },
      {
        displayName: 'Authentication',
        name: 'autoAuth',
        type: 'options',
        noDataExpression: true,
        options: [
          {
            name: 'JWT Only',
            value: 'jwt',
            description:
              'Evolution signs every delivery with an HS256 JWT (jwt_key); the secret itself never travels with the request',
          },
          {
            name: 'JWT and Secret Header',
            value: 'jwtAndHeader',
            description:
              'Evolution signs every delivery with an HS256 JWT (jwt_key) and also sends a random secret header; both are verified',
          },
          {
            name: 'Secret Header Only',
            value: 'header',
            description: `Evolution sends a random secret in the "${SECRET_HEADER_NAME}" header; does not depend on the server clocks`,
          },
        ],
        default: 'jwtAndHeader',
        description:
          'How Evolution proves that a delivery comes from it. The secrets are generated on activation and stored in the workflow static data. Unauthenticated requests get 401. Missing registration state gets 503 so Evolution can retry while activation completes.',
        displayOptions: { show: { mode: ['automatic'] } },
      },
      {
        displayName: 'Authentication',
        name: 'manualAuth',
        type: 'options',
        noDataExpression: true,
        options: [
          {
            name: 'JWT Only',
            value: 'jwt',
            description:
              'Verify the "Authorization: Bearer" HS256 JWT that Evolution sends when the instance webhook headers contain jwt_key',
          },
          {
            name: 'JWT and Secret Header',
            value: 'jwtAndHeader',
            description: 'Require both the secret header and a valid JWT',
          },
          {
            name: 'None',
            value: 'none',
            description:
              'Accept every request: the webhook URL is the only protection. Required for the global webhook, which cannot send headers.',
          },
          {
            name: 'Secret Header Only',
            value: 'header',
            description: 'Require a static header configured in the instance webhook headers',
          },
        ],
        default: 'jwt',
        description:
          'How to verify deliveries. Requests that fail verification get 401 (Evolution does not retry 401).',
        displayOptions: { show: { mode: ['manual'] } },
      },
      {
        displayName: 'Header Name',
        name: 'headerName',
        type: 'string',
        default: SECRET_HEADER_NAME,
        description: 'Name of the secret header, as configured in the Evolution webhook headers',
        displayOptions: { show: { mode: ['manual'], manualAuth: ['header', 'jwtAndHeader'] } },
      },
      {
        displayName: 'Header Value',
        name: 'headerValue',
        type: 'string',
        typeOptions: { password: true },
        default: '',
        required: true,
        description: 'Expected value of the secret header (compared in constant time)',
        displayOptions: { show: { mode: ['manual'], manualAuth: ['header', 'jwtAndHeader'] } },
      },
      {
        displayName: 'JWT Secret',
        name: 'jwtSecret',
        type: 'string',
        typeOptions: { password: true },
        default: '',
        required: true,
        description:
          'The jwt_key set in the headers of the Evolution instance webhook (HS256 secret)',
        displayOptions: { show: { mode: ['manual'], manualAuth: ['jwt', 'jwtAndHeader'] } },
      },
      {
        displayName: 'Options',
        name: 'options',
        type: 'collection',
        placeholder: 'Add Option',
        default: {},
        options: [
          {
            displayName: 'Binary Property',
            name: 'binaryPropertyName',
            type: 'string',
            default: 'data',
            description:
              'Binary property that receives the media when "Output Media as Binary" is on',
          },
          {
            displayName: 'Deduplicate Retried Deliveries',
            name: 'deduplicate',
            type: 'boolean',
            default: true,
            description:
              'Whether to ignore an event already received in the last 30 minutes. Evolution retries a delivery up to 10 times when n8n does not answer in time, and the instance and global webhooks both deliver the same event.',
          },
          {
            displayName: 'Ignore Groups',
            name: 'ignoreGroups',
            type: 'boolean',
            default: false,
            description:
              'Whether to ignore events of group chats (remoteJid ending in @g.us). Group-only events such as Group Participants Update are controlled by Events.',
          },
          {
            displayName: 'Ignore Messages From Me',
            name: 'ignoreFromMe',
            type: 'boolean',
            default: false,
            description:
              'Whether to ignore events of messages sent by the connected number itself (fromMe = true), including Send Message. Useful to avoid reply loops in bots.',
          },
          {
            displayName: 'Ignore Newsletters',
            name: 'ignoreNewsletters',
            type: 'boolean',
            default: false,
            description:
              'Whether to ignore events of WhatsApp channels (remoteJid ending in @newsletter)',
          },
          {
            displayName: 'Ignore Status and Broadcasts',
            name: 'ignoreBroadcasts',
            type: 'boolean',
            default: false,
            description:
              'Whether to ignore status updates (status@broadcast) and broadcast lists (remoteJid ending in @broadcast)',
          },
          {
            displayName: 'Include Media as Base64',
            name: 'webhookBase64',
            type: 'boolean',
            default: false,
            description:
              'Whether Evolution embeds the downloaded media in media messages (data.message.base64). Automatic mode registers the webhook with "Webhook Base64" on; in Manual mode enable it in Evolution yourself. Evolution only reads this setting when the instance connects, so restart the instance (Instance > Restart) after activating the workflow. Large files can exceed the n8n payload limit (N8N_PAYLOAD_SIZE_MAX).',
          },
          {
            displayName: 'JWT Expiry Leeway (Seconds)',
            name: 'jwtLeeway',
            type: 'number',
            typeOptions: { minValue: 0 },
            default: DEFAULT_JWT_LEEWAY_SECONDS,
            description:
              'Seconds a JWT is still accepted after its expiry. Evolution signs each event once (valid 600 s) and reuses the token for retries that can arrive about 20 minutes later; the signature is always verified.',
          },
          {
            displayName: 'Keep API Key Field',
            name: 'keepApiKey',
            type: 'boolean',
            default: false,
            description:
              'Whether to keep the "apikey" field of the payload. Evolution puts the instance token there when AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true; it is removed by default so it is not stored in the executions.',
          },
          {
            displayName: 'Message Types',
            name: 'messageTypes',
            type: 'multiOptions',
            options: MESSAGE_TYPE_OPTIONS,
            default: [],
            description:
              'Only start the workflow for these message types (data.messageType). Events without a message type are not affected. Leave empty for every type.',
          },
          {
            displayName: 'Only Instances',
            name: 'instanceNames',
            type: 'string',
            default: '',
            placeholder: 'e.g. sales, support',
            description:
              'Comma-separated instance names; events of other instances are ignored. Useful with the global webhook, which delivers the events of every instance.',
          },
          {
            displayName: 'Output Media as Binary',
            name: 'binaryOutput',
            type: 'boolean',
            default: true,
            description:
              'Whether to convert the embedded media (data.message.base64) into n8n binary data and remove the base64 string from the JSON',
          },
        ],
      },
    ],
  };

  methods = {
    listSearch: { searchInstances },
  };

  webhookMethods = {
    default: {
      /**
       * Automatic: the instance webhook points to this URL, is enabled and still carries the
       * secrets of this node's registration. Manual: nothing to register (the secrets are
       * validated so that a misconfiguration fails the activation instead of every delivery).
       */
      async checkExists(this: IHookFunctions): Promise<boolean> {
        if (getTriggerMode(this) === 'manual') {
          const manual = getManualVerification(this);
          if ('error' in manual) {
            throw new NodeOperationError(this.getNode(), manual.error);
          }
          if (!manual.config.jwtSecret && !manual.config.secretHeader) {
            this.logger.warn(
              `Evolution API Trigger: Manual mode without authentication accepts any request to ${getWebhookUrl(this)}`,
            );
          }
          return true;
        }

        const webhookUrl = getWebhookUrl(this);
        const instanceName = await getInstanceName(this);
        const registration = getRegistrations(this.getWorkflowStaticData('node'))[webhookUrl];
        if (
          !registration ||
          registration.instanceName !== instanceName ||
          registration.auth !== getAutomaticAuth(this)
        ) {
          return false;
        }

        const found = await findWebhook.call(this, encodeURIComponent(instanceName));
        return (
          found.url === webhookUrl &&
          found.enabled === true &&
          // "Webhook by Events" appends /<event> to the URL, so nothing would reach this node.
          found.webhookByEvents !== true &&
          hasRegistrationHeaders(found, registration)
        );
      },

      /**
       * Save the current instance webhook, then POST /webhook/set with this URL, the selected
       * events (`[]` = all), byEvents off (the path must not change), the base64 option and
       * fresh secrets (`jwt_key` and/or the secret header).
       */
      async create(this: IHookFunctions): Promise<boolean> {
        if (getTriggerMode(this) === 'manual') return true;

        const webhookUrl = getWebhookUrl(this);
        const instanceName = await getInstanceName(this);
        const instance = encodeURIComponent(instanceName);
        const events = getSelectedEvents(this);
        const auth = getAutomaticAuth(this);
        const options = this.getNodeParameter('options', {}) as IDataObject;

        const newerEvents = events.filter((event) => TRIGGER_24_ONLY_EVENTS.includes(event));
        if (newerEvents.length > 0) {
          const version = await getServerVersion.call(this);
          if (version && isVersionBelow(version, 2, 4)) {
            throw new NodeOperationError(
              this.getNode(),
              `Event ${newerEvents.join(', ')} requires Evolution API 2.4+ (this server runs ${version})`,
              { description: 'Remove it from Events or upgrade Evolution API.' },
            );
          }
        }

        // n8n registers "Listen for test event" webhooks in mode 'manual' (active workflows:
        // 'trigger').
        const isTest = this.getMode() === 'manual';
        const staticData = this.getWorkflowStaticData('node');
        const registrations = getRegistrations(staticData);
        const existing = registrations[webhookUrl] ?? getRecoveryRegistration(this, webhookUrl);
        const found = await findWebhook.call(this, instance);

        if (
          !isTest &&
          existing?.instanceName !== instanceName &&
          isOtherEndpointOfNode(found.url, webhookUrl, this.getNode().webhookId)
        ) {
          throw new NodeOperationError(
            this.getNode(),
            "A 'Listen for test event' session currently holds the instance webhook; stop it and activate again",
            {
              description:
                'Its original webhook snapshot is in the test session. Stop that session so it can restore the original before activation.',
            },
          );
        }

        let previous: IDataObject | null;
        if (
          found.url === webhookUrl ||
          // A test listener of this same node that n8n never stopped (e.g. restart while
          // listening): its URL is not the configuration to restore, the saved one is.
          (!isTest &&
            existing?.instanceName === instanceName &&
            isOtherEndpointOfNode(found.url, webhookUrl, this.getNode().webhookId))
        ) {
          // Our own URL is still registered (an earlier deactivation could not restore it):
          // keep the configuration saved back then instead of saving our own webhook.
          previous = existing?.instanceName === instanceName ? existing.previous : null;
        } else {
          previous = snapshotWebhook(found);
          if (previous?.url) {
            this.logger.info(
              `Evolution API Trigger: replacing the webhook of instance "${instanceName}" (${String(previous.url)}); it will be restored when the workflow is deactivated`,
            );
          }
        }
        if (existing && existing.instanceName !== instanceName) {
          this.logger.warn(
            `Evolution API Trigger: the webhook of instance "${existing.instanceName}" was not restored before switching to "${instanceName}"; check it in Evolution API`,
          );
        }

        const registration: WebhookRegistration = {
          instanceName,
          auth,
          ...(auth !== 'header' ? { jwtSecret: generateSecret() } : {}),
          ...(auth !== 'jwt' ? { headerSecret: generateSecret() } : {}),
          previous,
          registeredAt: new Date().toISOString(),
          ...(isTest ? { test: true } : {}),
        };

        // Keep the snapshot before the HTTP write: a timeout may hide a successful takeover.
        rememberRegistration(this, webhookUrl, registration);
        await setWebhook.call(
          this,
          instance,
          buildSetBody({
            url: webhookUrl,
            enabled: true,
            events,
            headers: buildAuthHeaders(registration),
            byEvents: false,
            base64: options.webhookBase64 === true,
          }),
        );

        registrations[webhookUrl] = registration;
        saveRegistrations(staticData, registrations);
        return true;
      },

      /**
       * Restore the saved configuration (or disable the webhook when the instance had none),
       * unless someone replaced our webhook meanwhile. Never throws: a failure is logged and
       * the registration is kept, so the next activation still knows the original webhook.
       *
       * An active workflow also restores when the webhook points to this node's test URL (a
       * "Listen for test event" started while it was active took it over): the test listener
       * would otherwise put the production URL back after the workflow is gone. A test
       * registration never touches the production URL.
       */
      async delete(this: IHookFunctions): Promise<boolean> {
        const webhookUrl = this.getNodeWebhookUrl('default');
        const staticData = this.getWorkflowStaticData('node');
        const registrations = getRegistrations(staticData);
        if (!webhookUrl) return true;
        const persisted = registrations[webhookUrl];
        const registration = persisted ?? getRecoveryRegistration(this, webhookUrl);
        if (!registration) {
          if (getTriggerMode(this) === 'manual') return true;
          // After a restart there is no trustworthy snapshot to restore. Only disable this
          // exact endpoint with the generated-header shape; never touch its other endpoint.
          try {
            const instanceName = await getInstanceName(this);
            const instance = encodeURIComponent(instanceName);
            const found = await findWebhook.call(this, instance);
            if (found.url === webhookUrl && hasTriggerHeaders(found)) {
              await setWebhook.call(this, instance, buildDisableBody(webhookUrl));
              this.logger.error(
                `Evolution API Trigger: disabled the orphaned webhook of instance "${instanceName}"; its original configuration could not be recovered`,
              );
            }
            return true;
          } catch (error) {
            this.logger.error('Evolution API Trigger: could not clean up an unregistered webhook', {
              error: (error as Error).message,
            });
            return false;
          }
        }

        const instance = encodeURIComponent(registration.instanceName);
        try {
          const found = await findWebhook.call(this, instance);
          // Process-local recovery is usable only while Evolution still carries our exact
          // secrets. A different registration at the same URL belongs to its current owner.
          if (
            !persisted &&
            (found.url !== webhookUrl || !hasRegistrationHeaders(found, registration))
          ) {
            forgetRegistration(this, webhookUrl);
            this.logger.info(
              `Evolution API Trigger: the webhook of instance "${registration.instanceName}" no longer matches the pending registration; left untouched`,
            );
            return true;
          }
          if (
            found.url === webhookUrl ||
            (registration.test !== true &&
              isOtherEndpointOfNode(found.url, webhookUrl, this.getNode().webhookId))
          ) {
            await setWebhook.call(
              this,
              instance,
              registration.previous
                ? buildRestoreBody(registration.previous)
                : buildDisableBody(webhookUrl),
            );
          } else {
            this.logger.info(
              `Evolution API Trigger: the webhook of instance "${registration.instanceName}" no longer points to n8n; left untouched`,
            );
          }
        } catch (error) {
          this.logger.error(
            `Evolution API Trigger: could not restore the webhook of instance "${registration.instanceName}"`,
            { error: (error as Error).message },
          );
          if (persisted && registration.previous) {
            // Stop Evolution from calling a URL that is about to disappear.
            try {
              await setWebhook.call(this, instance, buildDisableBody(webhookUrl));
            } catch (disableError) {
              this.logger.error(
                `Evolution API Trigger: could not disable the webhook of instance "${registration.instanceName}"`,
                { error: (disableError as Error).message },
              );
            }
          }
          return false;
        }

        delete registrations[webhookUrl];
        saveRegistrations(staticData, registrations);
        forgetRegistration(this, webhookUrl);
        return true;
      },
    },
  };

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const options = this.getNodeParameter('options', {}) as IDataObject;
    const headers = this.getHeaderData() as Record<string, string | string[] | undefined>;
    // Production URL (see getServedWebhookUrl), used to find the registration and dedupe scope.
    const webhookUrl = this.getNodeWebhookUrl('default') ?? '';
    const staticData = this.getWorkflowStaticData('node');
    const leeway = Number(options.jwtLeeway ?? DEFAULT_JWT_LEEWAY_SECONDS);
    const timing = {
      jwtLeewaySeconds: Number.isFinite(leeway) ? leeway : DEFAULT_JWT_LEEWAY_SECONDS,
      nowSeconds: Math.floor(Date.now() / 1000),
    };

    // 1. Authentication.
    let result: VerificationResult;
    if (getTriggerMode(this) === 'manual') {
      const manual = getManualVerification(this);
      if ('error' in manual) {
        this.logger.error(`Evolution API Trigger: ${manual.error}`);
        return respond(this, 401, 'Unauthorized');
      }
      result = verifyWebhookRequest(headers, { ...manual.config, ...timing });
    } else {
      const registrations = getRequestRegistrations(this, staticData, webhookUrl).filter(
        (registration) => registration.jwtSecret || registration.headerSecret,
      );
      if (registrations.length === 0) {
        this.logger.warn(
          'Evolution API Trigger: request rejected, this webhook is not registered (deactivate and activate the workflow again)',
        );
        this.getResponseObject().setHeader('Retry-After', '5');
        return respond(this, 503, 'Webhook registration is not ready; retry later');
      }
      // Normally one candidate; a request is genuine when any of our registrations signed it.
      const attempts = registrations.map((registration) =>
        verifyWebhookRequest(headers, {
          ...(registration.jwtSecret ? { jwtSecret: registration.jwtSecret } : {}),
          ...(registration.headerSecret
            ? { secretHeader: { name: SECRET_HEADER_NAME, value: registration.headerSecret } }
            : {}),
          ...timing,
        }),
      );
      result = attempts.find((attempt) => attempt.valid) ?? attempts[0];
    }
    if (!result.valid) {
      this.logger.warn(`Evolution API Trigger: request rejected (${result.reason})`);
      return respond(this, 401, 'Unauthorized');
    }

    // 2. Envelope.
    const body = this.getBodyData();
    if (!isPlainObject(body) || typeof body.event !== 'string' || body.event === '') {
      return respond(this, 400, 'Not an Evolution API webhook event');
    }

    // 3. Filters (answered with 200 so Evolution does not retry).
    const fields = getMessageFields(body.data);
    const reason = getFilterReason(body, fields, {
      events: getSelectedEvents(this),
      instanceNames: parseList(options.instanceNames),
      ignoreFromMe: options.ignoreFromMe === true,
      ignoreGroups: options.ignoreGroups === true,
      ignoreNewsletters: options.ignoreNewsletters === true,
      ignoreBroadcasts: options.ignoreBroadcasts === true,
      messageTypes: Array.isArray(options.messageTypes) ? options.messageTypes.map(String) : [],
    });
    if (reason) return { webhookResponse: { received: true, ignored: reason } };

    // 4. Retried deliveries.
    let delivery: { scope: string; key: string } | undefined;
    if (options.deduplicate !== false) {
      const endpoint = getServedWebhookUrl(this) ?? `${webhookUrl}:${this.getMode()}`;
      const scope = `${String(this.getWorkflow().id ?? '')}:${this.getNode().id}:${endpoint}`;
      delivery = { scope, key: getDeliveryKey(body) };
      if (isDuplicateDelivery(staticData, scope, delivery.key, Date.now())) {
        return { webhookResponse: { received: true, ignored: 'duplicate delivery' } };
      }
    }

    // 5. Output: envelope without the instance token, plus normalized fields.
    const json: IDataObject = { ...body };
    if (options.keepApiKey !== true) delete json.apikey;
    json.eventType = normalizeEventName(body.event);
    json.timestamp = getEventTimestamp(getHeaderValue(headers, 'x-timestamp'), body.data);
    if (fields) Object.assign(json, fields);

    const item: INodeExecutionData = { json };
    if (options.binaryOutput !== false) {
      const media = findWebhookMedia(body.data, fields?.messageId ?? null);
      if (media) {
        const property = String(options.binaryPropertyName ?? 'data').trim() || 'data';
        item.binary = {
          [property]: await this.helpers.prepareBinaryData(
            Buffer.from(media.data, 'base64'),
            media.fileName,
            media.mimeType,
          ),
        };
        json.data = withoutMediaBase64(body.data as IDataObject);
      }
    }

    if (delivery) {
      // Binary preparation can yield. Re-check so two simultaneous retries cannot both run.
      if (isDuplicateDelivery(staticData, delivery.scope, delivery.key, Date.now())) {
        return { webhookResponse: { received: true, ignored: 'duplicate delivery' } };
      }
      rememberDelivery(staticData, delivery.scope, delivery.key, Date.now());
    }
    return { workflowData: [[item]] };
  }
}
