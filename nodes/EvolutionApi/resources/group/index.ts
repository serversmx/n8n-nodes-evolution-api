import type { INodeProperties } from 'n8n-workflow';

import { REQUIRES_24 } from '../../constants';
import type { OperationHandler, ResourceMethods } from '../../types';
import * as acceptInvite from './acceptInvite.operation';
import * as create from './create.operation';
import * as get from './get.operation';
import * as getInviteCode from './getInviteCode.operation';
import * as getInviteInfo from './getInviteInfo.operation';
import * as getMany from './getMany.operation';
import * as getParticipants from './getParticipants.operation';
import { searchGroups } from './helpers';
import * as leave from './leave.operation';
import * as revokeInviteCode from './revokeInviteCode.operation';
import * as sendInvite from './sendInvite.operation';
import * as toggleEphemeral from './toggleEphemeral.operation';
import * as updateDescription from './updateDescription.operation';
import * as updateMemberAddMode from './updateMemberAddMode.operation';
import * as updateParticipants from './updateParticipants.operation';
import * as updatePicture from './updatePicture.operation';
import * as updateSetting from './updateSetting.operation';
import * as updateSubject from './updateSubject.operation';

/**
 * Group resource. Routes: src/api/routes/group.router.ts (2.4.0-rc2 adds updateMemberAddMode).
 * Every route is WhatsApp Baileys only: Cloud API and Evolution channel instances fail.
 * Group JIDs are always sent complete (…@g.us, see helpers.getGroupJid).
 */
export const operations: INodeProperties = {
  displayName: 'Operation',
  name: 'operation',
  type: 'options',
  noDataExpression: true,
  displayOptions: {
    show: {
      resource: ['group'],
    },
  },
  options: [
    {
      name: 'Accept Invite',
      value: 'acceptInvite',
      description: 'Join a group with an invite code or link; the instance becomes a member',
      action: 'Join a group by invite code',
    },
    {
      name: 'Create',
      value: 'create',
      description: 'Create a group with a subject and initial participants',
      action: 'Create a group',
    },
    {
      name: 'Get',
      value: 'get',
      description: 'Get the details of a group by JID, including its participants',
      action: 'Get a group',
    },
    {
      name: 'Get Invite Code',
      value: 'getInviteCode',
      description: 'Get the invite code and link of a group (the instance must be an admin)',
      action: 'Get the invite code of a group',
    },
    {
      name: 'Get Invite Info',
      value: 'getInviteInfo',
      description: 'Get the details of a group from an invite code or link, without joining it',
      action: 'Get group info from an invite code',
    },
    {
      name: 'Get Many',
      value: 'getMany',
      description:
        'Get the groups the instance belongs to, one item per group (slow on accounts with many groups: Evolution API fetches every group picture)',
      action: 'Get many groups',
    },
    {
      name: 'Get Participants',
      value: 'getParticipants',
      description: 'Get the participants of a group and their admin role, one item per participant',
      action: 'Get the participants of a group',
    },
    {
      name: 'Leave',
      value: 'leave',
      description: 'Make the instance leave a group',
      action: 'Leave a group',
    },
    {
      name: 'Revoke Invite Code',
      value: 'revokeInviteCode',
      description:
        'Invalidate the current invite link of a group and get a new one (the instance must be an admin)',
      action: 'Revoke the invite code of a group',
    },
    {
      name: 'Send Invite',
      value: 'sendInvite',
      description:
        'Send the invite link of a group to one or more numbers as a text message (the instance must be an admin)',
      action: 'Send a group invite link',
    },
    {
      name: 'Toggle Ephemeral',
      value: 'toggleEphemeral',
      description: 'Turn disappearing messages on (24 hours, 7 days or 90 days) or off for a group',
      action: 'Set disappearing messages',
    },
    {
      name: 'Update Description',
      value: 'updateDescription',
      description: 'Change the description of a group',
      action: 'Update the group description',
    },
    {
      name: 'Update Member Add Mode',
      value: 'updateMemberAddMode',
      description: `Choose whether only admins or all members can add participants. ${REQUIRES_24}`,
      action: 'Update who can add members',
    },
    {
      name: 'Update Participants',
      value: 'updateParticipants',
      description:
        'Add, remove, promote or demote participants of a group, with one result item per participant',
      action: 'Add, remove, promote or demote participants',
    },
    {
      name: 'Update Picture',
      value: 'updatePicture',
      description: 'Change the picture of a group from a URL, base64 data or a binary file',
      action: 'Update the group picture',
    },
    {
      name: 'Update Setting',
      value: 'updateSetting',
      description: 'Choose whether only admins can send messages or edit the group info',
      action: 'Update a group setting',
    },
    {
      name: 'Update Subject',
      value: 'updateSubject',
      description: 'Change the name (subject) of a group',
      action: 'Update the group name',
    },
  ],
  default: 'getMany',
};

export const fields: INodeProperties[] = [
  ...acceptInvite.description,
  ...create.description,
  ...get.description,
  ...getInviteCode.description,
  ...getInviteInfo.description,
  ...getMany.description,
  ...getParticipants.description,
  ...leave.description,
  ...revokeInviteCode.description,
  ...sendInvite.description,
  ...toggleEphemeral.description,
  ...updateDescription.description,
  ...updateMemberAddMode.description,
  ...updateParticipants.description,
  ...updatePicture.description,
  ...updateSetting.description,
  ...updateSubject.description,
];

export const execute: Record<string, OperationHandler> = {
  acceptInvite: acceptInvite.execute,
  create: create.execute,
  get: get.execute,
  getInviteCode: getInviteCode.execute,
  getInviteInfo: getInviteInfo.execute,
  getMany: getMany.execute,
  getParticipants: getParticipants.execute,
  leave: leave.execute,
  revokeInviteCode: revokeInviteCode.execute,
  sendInvite: sendInvite.execute,
  toggleEphemeral: toggleEphemeral.execute,
  updateDescription: updateDescription.execute,
  updateMemberAddMode: updateMemberAddMode.execute,
  updateParticipants: updateParticipants.execute,
  updatePicture: updatePicture.execute,
  updateSetting: updateSetting.execute,
  updateSubject: updateSubject.execute,
};

/** The picture stays available downstream after it has been uploaded. */
export const binaryPassThrough = ['updatePicture'];

/** listSearch of the "Group" field (groupJid). */
export const methods: ResourceMethods = {
  listSearch: {
    groupSearchGroups: searchGroups,
  },
};
