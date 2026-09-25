import type { INodeProperties } from 'n8n-workflow';

import type { OperationHandler } from '../../types';
import * as get from './get.operation';

/**
 * Profile resource (STUB — owned by the profile agent). Routes: the profile section of
 * src/api/routes/chat.router.ts (fetchProfile, fetchBusinessProfile, updateProfileName,
 * updateProfileStatus, updateProfilePicture, removeProfilePicture, fetchPrivacySettings,
 * updatePrivacySettings, fetchProfilePictureUrl).
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
      description: 'Get the WhatsApp profile of a number or of the instance itself',
      action: 'Get a profile',
    },
  ],
  default: 'get',
};

export const fields: INodeProperties[] = [...get.description];

export const execute: Record<string, OperationHandler> = {
  get: get.execute,
};
