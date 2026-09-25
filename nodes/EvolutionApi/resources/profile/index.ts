import type { INodeProperties } from 'n8n-workflow';

import type { OperationHandler } from '../../types';
import * as get from './get.operation';
import * as getBusinessProfile from './getBusinessProfile.operation';
import * as getPicture from './getPicture.operation';
import * as getPrivacySettings from './getPrivacySettings.operation';
import * as removePicture from './removePicture.operation';
import * as updateName from './updateName.operation';
import * as updatePicture from './updatePicture.operation';
import * as updatePrivacySettings from './updatePrivacySettings.operation';
import * as updateStatus from './updateStatus.operation';

/**
 * Profile resource. Routes: the profile section of src/api/routes/chat.router.ts (fetchProfile,
 * fetchBusinessProfile, fetchProfilePictureUrl, updateProfileName, updateProfileStatus,
 * updateProfilePicture, removeProfilePicture, fetchPrivacySettings, updatePrivacySettings).
 * The update/remove operations change the WhatsApp account of the selected instance.
 */
export const operations: INodeProperties = {
  displayName: 'Operation',
  name: 'operation',
  type: 'options',
  noDataExpression: true,
  displayOptions: {
    show: {
      resource: ['profile'],
    },
  },
  options: [
    {
      name: 'Get',
      value: 'get',
      description:
        'Get the WhatsApp profile (name, picture, about, business info) of a number or of the instance itself',
      action: 'Get a profile',
    },
    {
      name: 'Get Business Profile',
      value: 'getBusinessProfile',
      description:
        'Get the WhatsApp Business profile (description, email, websites, category, address, hours) of a number or of the instance',
      action: 'Get a business profile',
    },
    {
      name: 'Get Picture',
      value: 'getPicture',
      description: 'Get the profile picture URL of a contact or group',
      action: 'Get a profile picture URL',
    },
    {
      name: 'Get Privacy Settings',
      value: 'getPrivacySettings',
      description: 'Get the privacy settings of the instance account',
      action: 'Get privacy settings',
    },
    {
      name: 'Remove Picture',
      value: 'removePicture',
      description: 'Remove the profile picture of the instance account',
      action: 'Remove the profile picture',
    },
    {
      name: 'Update Name',
      value: 'updateName',
      description: 'Change the display name of the instance account',
      action: 'Update the profile name',
    },
    {
      name: 'Update Picture',
      value: 'updatePicture',
      description:
        'Change the profile picture of the instance account (URL, base64 or binary file)',
      action: 'Update the profile picture',
    },
    {
      name: 'Update Privacy Settings',
      value: 'updatePrivacySettings',
      description: 'Change some privacy settings of the instance account, keeping the others',
      action: 'Update privacy settings',
    },
    {
      name: 'Update Status',
      value: 'updateStatus',
      description: 'Change the "About" text of the instance account',
      action: 'Update the profile status text',
    },
  ],
  default: 'get',
};

export const fields: INodeProperties[] = [
  ...get.description,
  ...getBusinessProfile.description,
  ...getPicture.description,
  ...getPrivacySettings.description,
  ...removePicture.description,
  ...updateName.description,
  ...updatePicture.description,
  ...updatePrivacySettings.description,
  ...updateStatus.description,
];

export const execute: Record<string, OperationHandler> = {
  get: get.execute,
  getBusinessProfile: getBusinessProfile.execute,
  getPicture: getPicture.execute,
  getPrivacySettings: getPrivacySettings.execute,
  removePicture: removePicture.execute,
  updateName: updateName.execute,
  updatePicture: updatePicture.execute,
  updatePrivacySettings: updatePrivacySettings.execute,
  updateStatus: updateStatus.execute,
};
