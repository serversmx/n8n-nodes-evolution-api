import type { IDataObject, IExecuteFunctions, INode, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import { isPlainObject } from '../../GenericFunctions';
import {
  applySendOptions,
  delayOption,
  getCollectionEntries,
  getRecipient,
  getString,
  interactiveInputModeProperty,
  mentionOptions,
  numberProperty,
  operationError,
  parseJsonArray,
  postMessage,
  quotedOptions,
  sendOptionsProperty,
  str,
} from './helpers';

const SECTIONS_EXAMPLE = `[
  {
    "title": "Menu",
    "rows": [
      { "title": "Pizza", "description": "Large, 8 slices", "rowId": "pizza" },
      { "title": "Salad", "rowId": "salad" }
    ]
  }
]`;

const properties: INodeProperties[] = [
  numberProperty,
  {
    displayName: 'Title',
    name: 'listTitle',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'Our menu',
    description: 'Title of the list message',
  },
  {
    displayName: 'Description',
    name: 'listDescription',
    type: 'string',
    default: '',
    typeOptions: { rows: 2 },
    description: 'Body text shown under the title',
  },
  {
    displayName: 'Button Text',
    name: 'listButtonText',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'See options',
    description: 'Text of the button that opens the list',
  },
  {
    displayName: 'Footer',
    name: 'listFooter',
    type: 'string',
    default: '',
    description: 'Small text shown at the bottom of the message',
  },
  interactiveInputModeProperty,
  {
    displayName: 'Sections',
    name: 'listSections',
    type: 'fixedCollection',
    required: true,
    typeOptions: { multipleValues: true },
    placeholder: 'Add Section',
    default: {},
    description: 'Sections of the list, each with its selectable rows',
    displayOptions: { show: { interactiveInputMode: ['fields'] } },
    options: [
      {
        displayName: 'Section',
        name: 'section',
        values: [
          {
            displayName: 'Title',
            name: 'title',
            type: 'string',
            required: true,
            default: '',
          },
          {
            displayName: 'Rows',
            name: 'rows',
            type: 'fixedCollection',
            typeOptions: { multipleValues: true },
            placeholder: 'Add Row',
            default: {},
            options: [
              {
                displayName: 'Row',
                name: 'row',
                values: [
                  {
                    displayName: 'Title',
                    name: 'title',
                    type: 'string',
                    required: true,
                    default: '',
                  },
                  {
                    displayName: 'Description',
                    name: 'description',
                    type: 'string',
                    default: '',
                    description: 'Optional on WhatsApp Baileys; required on WhatsApp Cloud API',
                  },
                  {
                    displayName: 'Row ID',
                    name: 'rowId',
                    type: 'string',
                    required: true,
                    default: '',
                    description: 'ID sent back in the reply webhook when this row is selected',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    displayName: 'Sections (JSON)',
    name: 'listSectionsJson',
    type: 'json',
    required: true,
    default: SECTIONS_EXAMPLE,
    description:
      'Array of sections: [{ "title", "rows": [{ "title", "description"?, "rowId" }] }]. An object with a "sections" key is accepted too.',
    displayOptions: { show: { interactiveInputMode: ['json'] } },
  },
  sendOptionsProperty([delayOption(), ...mentionOptions, ...quotedOptions()]),
];

export const description = updateDisplayOptions(
  { show: { resource: ['message'], operation: ['sendList'] } },
  properties,
);

/** Validate sections (listMessageSchema) and drop empty row descriptions (isNotEmpty rule). */
export function normalizeSections(
  node: INode,
  itemIndex: number,
  rawSections: IDataObject[],
): IDataObject[] {
  if (rawSections.length === 0) {
    throw operationError(node, itemIndex, 'Add at least one section with at least one row');
  }
  const rowIds = new Set<string>();
  return rawSections.map((rawSection, sectionIndex) => {
    const label = `Section ${sectionIndex + 1}`;
    const title = str(rawSection, 'title');
    if (!title) throw operationError(node, itemIndex, `${label}: Title is required`);
    const rawRows: unknown[] = Array.isArray(rawSection.rows)
      ? rawSection.rows
      : getCollectionEntries(rawSection.rows, 'row');
    if (rawRows.length === 0) {
      throw operationError(node, itemIndex, `${label}: add at least one row`);
    }

    const rows = rawRows.map((rawRow, rowIndex) => {
      const rowLabel = `${label}, row ${rowIndex + 1}`;
      const row: IDataObject = isPlainObject(rawRow) ? rawRow : {};
      const rowTitle = str(row, 'title');
      // "id" is accepted as an alias (the shape of Cloud API list replies).
      const rowId = str(row, 'rowId') || str(row, 'id');
      if (!rowTitle) throw operationError(node, itemIndex, `${rowLabel}: Title is required`);
      if (!rowId) throw operationError(node, itemIndex, `${rowLabel}: Row ID is required`);
      if (rowIds.has(rowId)) {
        throw operationError(node, itemIndex, `${rowLabel}: Row ID "${rowId}" is used twice`);
      }
      rowIds.add(rowId);
      const normalized: IDataObject = { title: rowTitle, rowId };
      const rowDescription = str(row, 'description');
      if (rowDescription) normalized.description = rowDescription;
      return normalized;
    });
    return { title, rows };
  });
}

/**
 * POST /message/sendList/:instanceName (listMessageSchema, HTTP 201)
 * { number, title, description?, buttonText, footerText, sections: [{ title, rows: [{ title,
 *   description?, rowId }] }], delay?, quoted?, mentionsEveryOne?, mentioned? }.
 * `footerText` is schema-required (sent empty when not set) and the key is `sections` (the
 * owner's MCP sent `values`, which fails with 400). Row descriptions must be non-empty when
 * present, so empty ones are omitted.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const node = this.getNode();
  const number = getRecipient.call(this, itemIndex);
  const title = getString.call(this, 'listTitle', itemIndex);
  const buttonText = getString.call(this, 'listButtonText', itemIndex);
  if (!title) throw operationError(node, itemIndex, 'Title is required');
  if (!buttonText) throw operationError(node, itemIndex, 'Button Text is required');

  const mode = this.getNodeParameter('interactiveInputMode', itemIndex, 'fields') as string;
  const rawSections =
    mode === 'json'
      ? parseJsonArray(
          node,
          itemIndex,
          this.getNodeParameter('listSectionsJson', itemIndex, ''),
          'Sections (JSON)',
          ['sections', 'values'],
        )
      : getCollectionEntries(this.getNodeParameter('listSections', itemIndex, {}), 'section');
  const sections = normalizeSections(node, itemIndex, rawSections);

  const body: IDataObject = {
    number,
    title,
    buttonText,
    footerText: getString.call(this, 'listFooter', itemIndex),
    sections,
  };
  const listDescription = getString.call(this, 'listDescription', itemIndex);
  if (listDescription) body.description = listDescription;

  const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
  applySendOptions(node, itemIndex, options, body);
  return await postMessage.call(this, itemIndex, 'sendList', body);
}
