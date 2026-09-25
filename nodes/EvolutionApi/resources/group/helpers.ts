import type {
  IExecuteFunctions,
  ILoadOptionsFunctions,
  INodeListSearchResult,
  INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
  evolutionApiRequest,
  extractResourceLocatorValue,
  resolveInstanceNameFromValue,
  toArray,
} from '../../GenericFunctions';

/** Where to find a group JID; repeated in every description that asks for one. */
const GROUP_JID_HINT =
  'Group JID, e.g. 120363025246125244@g.us (a bare group ID gets @g.us appended). Pick it from the list or get it with Group > Get Many.';

/**
 * The "Group" field (parameter `groupJid`) of the operations that act on one group.
 * A factory: every operation gets its own copy, scoped by updateDisplayOptions().
 */
export function groupJidProperty(description = GROUP_JID_HINT): INodeProperties {
  return {
    displayName: 'Group',
    name: 'groupJid',
    type: 'resourceLocator',
    required: true,
    default: { mode: 'list', value: '' },
    description,
    modes: [
      {
        displayName: 'From List',
        name: 'list',
        type: 'list',
        placeholder: 'Select a group...',
        typeOptions: {
          searchListMethod: 'groupSearchGroups',
          searchable: true,
        },
      },
      {
        displayName: 'By JID',
        name: 'id',
        type: 'string',
        placeholder: 'e.g. 120363025246125244@g.us',
      },
    ],
  };
}

/**
 * The "Participants" field (parameter `groupParticipants`) of Create and Update Participants:
 * a comma/newline separated list, split with normalizeNumberList(). Evolution requires at least
 * one entry, each with 10+ characters and digits, and applies createJid() to each one.
 */
export function participantsProperty(description: string): INodeProperties {
  return {
    displayName: 'Participants',
    name: 'groupParticipants',
    type: 'string',
    required: true,
    default: '',
    placeholder: '5215512345678, 5511999999999',
    description,
  };
}

/** Current group IDs (18 digits) and legacy ones ("<creator number>-<timestamp>"). */
const GROUP_ID_PATTERN = /^\d+(-\d+)?$/;

/**
 * E.164 numbers have at most 15 digits; group IDs have 18 (legacy "<number>-<timestamp>" ones
 * even more). Evolution's groupValidate appends @g.us to anything, so a phone number typed in
 * the Group field would only fail later on WhatsApp's side with a vague error.
 */
const MAX_PHONE_DIGITS = 15;

/** A bare value (no "@") made of phone-number characters with at most 15 digits. */
function looksLikePhoneNumber(text: string): boolean {
  return (
    !text.includes('@') &&
    /^\+?[\d\s().-]+$/.test(text) &&
    text.replace(/\D/g, '').length <= MAX_PHONE_DIGITS
  );
}

/**
 * Normalize a group JID the way Evolution's groupValidate expects it (`^[\d-]+@g.us$`):
 * whitespace is removed, a bare group ID gets `@g.us`, the suffix is lower-cased.
 * Returns '' for an empty value and `undefined` for a value that cannot be a group JID
 * (contact/@lid/channel JIDs, invite links, text, bare phone numbers).
 */
export function normalizeGroupJid(value: unknown): string | undefined {
  const text = extractResourceLocatorValue(value).replace(/\s+/g, '');
  if (!text) return '';
  if (looksLikePhoneNumber(text)) return undefined;
  const match = /^(.*)@g\.us$/i.exec(text);
  const id = match ? match[1] : text;
  return GROUP_ID_PATTERN.test(id) ? `${id}@g.us` : undefined;
}

function quote(value: string): string {
  return value.length > 80 ? `"${value.substring(0, 80)}…"` : `"${value}"`;
}

/**
 * Read and normalize the `groupJid` parameter of an item. Evolution only appends `@g.us` on some
 * routes (not on sendInvite) and answers vague errors for anything else, so the JID is always
 * sent complete and invalid values fail here with an explanation.
 */
export function getGroupJid(this: IExecuteFunctions, itemIndex: number): string {
  const raw = extractResourceLocatorValue(
    this.getNodeParameter('groupJid', itemIndex, '', { extractValue: true }),
  );
  const groupJid = normalizeGroupJid(raw);
  if (groupJid) return groupJid;

  if (groupJid === '') {
    throw new NodeOperationError(this.getNode(), 'Group is required', {
      itemIndex,
      description: GROUP_JID_HINT,
    });
  }
  if (/chat\.whatsapp\.com\//i.test(raw)) {
    throw new NodeOperationError(
      this.getNode(),
      `${quote(raw)} is an invite link, not a group JID`,
      {
        itemIndex,
        description:
          'Use Group > Get Invite Info to read the group behind an invite link, or Group > Accept Invite to join it.',
      },
    );
  }
  if (looksLikePhoneNumber(raw)) {
    throw new NodeOperationError(
      this.getNode(),
      `${quote(raw)} looks like a phone number, not a group ID`,
      {
        itemIndex,
        description: `${GROUP_JID_HINT} Group IDs have 18 digits (older groups: <creator number>-<timestamp>).`,
      },
    );
  }
  throw new NodeOperationError(
    this.getNode(),
    raw.includes('@') ? `${quote(raw)} is not a group JID` : `Invalid group JID ${quote(raw)}`,
    {
      itemIndex,
      description: `${GROUP_JID_HINT} Contact (@s.whatsapp.net, @lid) and channel (@newsletter) JIDs cannot be used here.`,
    },
  );
}

/**
 * Extract an invite code from a code or an invite link (https://chat.whatsapp.com/<code>).
 * Returns '' for an empty value and `undefined` when the result is not alphanumeric.
 * Evolution checks the exact format (22 letters or digits) itself.
 */
export function normalizeInviteCode(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const link = /chat\.whatsapp\.com\/(?:invite\/)?([^/?#\s]+)/i.exec(text);
  const code = link ? link[1] : text;
  return /^[A-Za-z0-9]+$/.test(code) ? code : undefined;
}

/** Read and normalize the `inviteCode` parameter of an item. */
export function getInviteCode(this: IExecuteFunctions, itemIndex: number): string {
  const raw = String(this.getNodeParameter('inviteCode', itemIndex, '') ?? '').trim();
  const inviteCode = normalizeInviteCode(raw);
  if (inviteCode) return inviteCode;
  throw new NodeOperationError(
    this.getNode(),
    inviteCode === '' ? 'Invite code is required' : `Invalid invite code ${quote(raw)}`,
    {
      itemIndex,
      description:
        'Use the invite link (https://chat.whatsapp.com/…) or only the code after the last slash (22 letters and digits).',
    },
  );
}

/**
 * listSearch for the "Group" field: the groups of the selected instance (or of the credential's
 * Default Instance Name), filtered by subject or JID. GET /group/fetchAllGroups without
 * participants; Evolution has no server-side search, so the filter is applied here.
 */
export async function searchGroups(
  this: ILoadOptionsFunctions,
  filter?: string,
): Promise<INodeListSearchResult> {
  const instance = await resolveInstanceNameFromValue.call(
    this,
    this.getCurrentNodeParameter('instanceName', { extractValue: true }),
  );
  const response = await evolutionApiRequest.call(
    this,
    'GET',
    `/group/fetchAllGroups/${instance}`,
    {},
    { getParticipants: 'false' },
  );
  const needle = (filter ?? '').trim().toLowerCase();

  const results = toArray(response)
    .map((group) => ({
      id: String(group.id ?? '').trim(),
      subject: String(group.subject ?? '').trim(),
    }))
    .filter(
      (group) =>
        group.id &&
        (!needle ||
          group.subject.toLowerCase().includes(needle) ||
          group.id.toLowerCase().includes(needle)),
    )
    .map((group) => ({ name: group.subject || group.id, value: group.id }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { results };
}
