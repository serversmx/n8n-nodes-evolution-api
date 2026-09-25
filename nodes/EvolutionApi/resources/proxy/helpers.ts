import type { IDataObject, INodeProperties } from 'n8n-workflow';

import { isPlainObject } from '../../GenericFunctions';

/** "Options > Include Secrets" of the proxy operations. */
export const includeSecretsOption: INodeProperties = {
  displayName: 'Include Secrets',
  name: 'includeSecrets',
  type: 'boolean',
  default: false,
  description:
    'Whether to keep the proxy password in the output. Off by default so it is not stored in execution logs.',
};

/**
 * Remove the proxy password from a find response (Proxy row) or a set response
 * ({ proxy: { instanceName, proxy: {...} } }, which echoes the password).
 */
export function redactProxySecrets(response: IDataObject): IDataObject {
  const copy: IDataObject = { ...response };
  delete copy.password;
  const outer = copy.proxy;
  if (isPlainObject(outer)) {
    const outerCopy: IDataObject = { ...outer };
    if (isPlainObject(outerCopy.proxy)) {
      const inner: IDataObject = { ...outerCopy.proxy };
      delete inner.password;
      outerCopy.proxy = inner;
    }
    copy.proxy = outerCopy;
  }
  return copy;
}
