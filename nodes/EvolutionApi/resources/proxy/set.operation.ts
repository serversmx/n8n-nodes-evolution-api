import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError, updateDisplayOptions } from 'n8n-workflow';

import { evolutionApiRequest, resolveInstanceName } from '../../GenericFunctions';
import { includeSecretsOption, redactProxySecrets } from './helpers';

const properties: INodeProperties[] = [
  {
    displayName: 'Enabled',
    name: 'proxyEnabled',
    type: 'boolean',
    default: true,
    description:
      "Whether to route the instance's WhatsApp connection through the proxy. Turn it off to remove the proxy: Evolution then clears the stored host, port and credentials.",
  },
  {
    displayName: 'Host',
    name: 'proxyHost',
    type: 'string',
    default: '',
    placeholder: 'proxy.example.com',
    displayOptions: { show: { proxyEnabled: [true] } },
    description: 'Host name or IP address of the proxy. Leave empty to keep the current host.',
  },
  {
    displayName: 'Port',
    name: 'proxyPort',
    type: 'string',
    default: '',
    placeholder: '8080',
    displayOptions: { show: { proxyEnabled: [true] } },
    description: 'Port of the proxy. Leave empty to keep the current port.',
  },
  {
    displayName: 'Additional Fields',
    name: 'additionalFields',
    type: 'collection',
    placeholder: 'Add Field',
    default: {},
    displayOptions: { show: { proxyEnabled: [true] } },
    description: 'Fields not added here keep their current value',
    options: [
      {
        displayName: 'Password',
        name: 'password',
        type: 'string',
        typeOptions: { password: true },
        default: '',
        description: 'Proxy password. Add it empty to remove the stored password.',
      },
      {
        displayName: 'Protocol',
        name: 'protocol',
        type: 'options',
        options: [
          { name: 'HTTP', value: 'http' },
          { name: 'SOCKS', value: 'socks' },
          { name: 'SOCKS5', value: 'socks5' },
        ],
        default: 'http',
        description: 'Proxy protocol. Defaults to the current protocol, or HTTP for a new proxy.',
      },
      {
        displayName: 'Username',
        name: 'username',
        type: 'string',
        default: '',
        description: 'Proxy username. Add it empty to remove the stored username.',
      },
    ],
  },
  {
    displayName: 'Options',
    name: 'options',
    type: 'collection',
    placeholder: 'Add Option',
    default: {},
    options: [includeSecretsOption],
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['proxy'], operation: ['set'] } },
  properties,
);

/**
 * Body of POST /proxy/set that disables the proxy. proxySchema requires host, port and protocol
 * even then (and non-empty when the body has no other keys), but proxy.controller.ts#createProxy
 * blanks all of them when `enabled` is false, so these placeholders are never stored. Sending
 * `enabled: false` as a JSON boolean is what the community node got wrong (EVONODE-6).
 */
export const DISABLE_PROXY_BODY: IDataObject = {
  enabled: false,
  host: 'disabled',
  port: '0',
  protocol: 'http',
};

function readString(source: IDataObject, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * - Disabled: POST /proxy/set/:instanceName with DISABLE_PROXY_BODY (no read needed).
 * - Enabled: GET /proxy/find/:instanceName, keep the current host, port, protocol and
 *   credentials that were not changed, then POST /proxy/set. Evolution tests the proxy against
 *   https://icanhazip.com/ and answers 400 "Invalid proxy" when the public IP does not change.
 *   The new proxy is used from the next connection (Instance > Restart applies it now).
 * Answers 201 { proxy: { instanceName, proxy: {...as sent, password included} } }.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const node = this.getNode();
  const instance = await resolveInstanceName.call(this, itemIndex);
  const enabled = this.getNodeParameter('proxyEnabled', itemIndex, true) as boolean;
  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

  let body: IDataObject;
  if (!enabled) {
    body = { ...DISABLE_PROXY_BODY };
  } else {
    const fields = this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject;
    const current = (await evolutionApiRequest.call(
      this,
      'GET',
      `/proxy/find/${instance}`,
      {},
      {},
      { itemIndex },
    )) as IDataObject;

    const host =
      String(this.getNodeParameter('proxyHost', itemIndex, '')).trim() ||
      (readString(current, 'host') ?? '').trim();
    const port =
      String(this.getNodeParameter('proxyPort', itemIndex, '')).trim() ||
      (readString(current, 'port') ?? '').trim();
    if (!host || !port) {
      throw new NodeOperationError(node, 'Proxy Host and Port are required', {
        itemIndex,
        description: 'No proxy host and port are stored for this instance, so both must be set.',
      });
    }
    const portNumber = Number(port);
    if (!/^\d+$/.test(port) || portNumber < 1 || portNumber > 65535) {
      throw new NodeOperationError(node, `Invalid proxy port "${port}"`, {
        itemIndex,
        description: 'Use a number between 1 and 65535.',
      });
    }

    body = {
      enabled: true,
      host,
      port,
      protocol: String(fields.protocol || readString(current, 'protocol') || 'http'),
    };
    for (const key of ['username', 'password']) {
      const value = key in fields ? String(fields[key] ?? '') : readString(current, key);
      if (value !== undefined) body[key] = value;
    }
  }

  const response = (await evolutionApiRequest.call(
    this,
    'POST',
    `/proxy/set/${instance}`,
    body,
    {},
    { itemIndex },
  )) as IDataObject;

  return options.includeSecrets === true ? response : redactProxySecrets(response);
}
