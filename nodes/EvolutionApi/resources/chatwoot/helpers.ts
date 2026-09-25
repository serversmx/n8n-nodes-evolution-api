import type { IDataObject, INodeProperties } from 'n8n-workflow';

import { toJid } from '../../GenericFunctions';

/** "Options > Include Secrets" of the Chatwoot operations. */
export const includeSecretsOption: INodeProperties = {
  displayName: 'Include Secrets',
  name: 'includeSecrets',
  type: 'boolean',
  default: false,
  description:
    'Whether to keep the Chatwoot access token in the output. Off by default so it is not stored in execution logs.',
};

/** Remove the Chatwoot access token from a find/set response. */
export function redactChatwootSecrets(response: IDataObject): IDataObject {
  if (!('token' in response)) return response;
  const copy: IDataObject = { ...response };
  delete copy.token;
  return copy;
}

/**
 * JIDs from a comma/newline separated string or an array. Numbers become full JIDs; the
 * wildcards "@g.us" (every group) and "@s.whatsapp.net" (every 1:1 chat) are kept as-is.
 */
export function parseJidList(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : String(value ?? '').split(/[,\n;]/);
  const jids = entries.map((entry) => toJid(String(entry ?? ''))).filter((entry) => entry);
  return [...new Set(jids)];
}
