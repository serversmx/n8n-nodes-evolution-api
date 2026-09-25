import type { IDataObject, INodeProperties } from 'n8n-workflow';

import { isPlainObject } from '../../GenericFunctions';

/** The six booleans settingsSchema requires on every POST /settings/set (2.3.7 and 2.4). */
export const REQUIRED_BOOLEAN_KEYS = [
  'rejectCall',
  'groupsIgnore',
  'alwaysOnline',
  'readMessages',
  'readStatus',
  'syncFullHistory',
] as const;

/** Optional string settings (SettingsDto). */
export const OPTIONAL_STRING_KEYS = ['msgCall', 'wavoipToken'] as const;

/** "Options > Include Secrets" of the settings operations. */
export const includeSecretsOption: INodeProperties = {
  displayName: 'Include Secrets',
  name: 'includeSecrets',
  type: 'boolean',
  default: false,
  description:
    'Whether to keep the Wavoip token in the output. Off by default so it is not stored in execution logs.',
};

/**
 * Remove the Wavoip token from a find response (flat row) or a set response
 * ({ settings: { instanceName, settings: {...} } }).
 */
export function redactSettingsSecrets(response: IDataObject): IDataObject {
  const copy: IDataObject = { ...response };
  delete copy.wavoipToken;
  const outer = copy.settings;
  if (isPlainObject(outer)) {
    const outerCopy: IDataObject = { ...outer };
    if (isPlainObject(outerCopy.settings)) {
      const inner: IDataObject = { ...outerCopy.settings };
      delete inner.wavoipToken;
      outerCopy.settings = inner;
    }
    copy.settings = outerCopy;
  }
  return copy;
}
