import type { INodePropertyOptions } from 'n8n-workflow';

import { parseJsonParameter } from '../../GenericFunctions';

/** Meta template categories accepted by templateSchema / templateEditSchema. */
export const TEMPLATE_CATEGORY_OPTIONS: INodePropertyOptions[] = [
  {
    name: 'Authentication',
    value: 'AUTHENTICATION',
    description: 'One-time passcodes',
  },
  {
    name: 'Marketing',
    value: 'MARKETING',
    description: 'Promotions, offers, announcements',
  },
  {
    name: 'Utility',
    value: 'UTILITY',
    description: 'Updates about an existing order or account',
  },
];

/**
 * Parse the "Components" JSON parameter: a non-empty array of Meta template components
 * (HEADER, BODY, FOOTER, BUTTONS). Returns undefined for an empty value; throws a plain Error
 * (wrapped by the node) for anything that is not an array.
 */
export function parseComponents(value: unknown): unknown[] | undefined {
  const parsed = parseJsonParameter(value, 'Components');
  if (parsed === undefined || parsed === null) return undefined;
  if (!Array.isArray(parsed)) {
    throw new Error(
      'Components must be a JSON array, e.g. [{"type": "BODY", "text": "Hello {{1}}"}]',
    );
  }
  return parsed;
}
