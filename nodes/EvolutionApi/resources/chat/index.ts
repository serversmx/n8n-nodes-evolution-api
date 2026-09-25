import type { INodeProperties } from 'n8n-workflow';

import { REQUIRES_24 } from '../../constants';
import type { OperationHandler } from '../../types';
import * as archive from './archive.operation';
import * as checkNumbers from './checkNumbers.operation';
import * as deleteMessage from './deleteMessage.operation';
import * as downloadMedia from './downloadMedia.operation';
import * as editMessage from './editMessage.operation';
import * as get from './get.operation';
import * as getChannels from './getChannels.operation';
import * as getContacts from './getContacts.operation';
import * as getMany from './getMany.operation';
import * as getMessages from './getMessages.operation';
import * as getPollVotes from './getPollVotes.operation';
import * as getStatusUpdates from './getStatusUpdates.operation';
import * as markAsPlayed from './markAsPlayed.operation';
import * as markAsRead from './markAsRead.operation';
import * as markUnread from './markUnread.operation';
import * as sendPresence from './sendPresence.operation';
import * as updateBlockStatus from './updateBlockStatus.operation';

/**
 * Chat resource. Routes: src/api/routes/chat.router.ts (2.3.7 and 2.4.0-rc2). The profile routes
 * of the same router (fetchProfile, fetchProfilePictureUrl, privacy…) belong to the "profile"
 * resource. POST /chat/fetchLid only exists on the unreleased develop branch and is not exposed.
 */
export const operations: INodeProperties = {
  displayName: 'Operation',
  name: 'operation',
  type: 'options',
  noDataExpression: true,
  displayOptions: {
    show: {
      resource: ['chat'],
    },
  },
  options: [
    {
      name: 'Archive',
      value: 'archive',
      description: 'Archive or unarchive a chat',
      action: 'Archive or unarchive a chat',
    },
    {
      name: 'Check Numbers',
      value: 'checkNumbers',
      description:
        'Check whether phone numbers have WhatsApp and get their JIDs (one item per number)',
      action: 'Check whether numbers are on WhatsApp',
    },
    {
      name: 'Delete Message for Everyone',
      value: 'deleteMessage',
      description: 'Delete (revoke) a sent message for everyone in the chat',
      action: 'Delete a message for everyone',
    },
    {
      name: 'Download Media',
      value: 'downloadMedia',
      description:
        'Download the image, video, audio, document or sticker of a message as a binary file',
      action: 'Download the media of a message',
    },
    {
      name: 'Edit Message',
      value: 'editMessage',
      description: 'Edit the text or caption of a message sent by this instance',
      action: 'Edit a sent message',
    },
    {
      name: 'Get',
      value: 'get',
      description: 'Get a chat stored by Evolution (name, labels, unread count)',
      action: 'Get a chat',
    },
    {
      name: 'Get Channels',
      value: 'getChannels',
      description: `Get the WhatsApp channels (newsletters) with stored messages. ${REQUIRES_24}`,
      action: 'Get followed channels',
    },
    {
      name: 'Get Contacts',
      value: 'getContacts',
      description: 'Get contacts stored by Evolution, optionally filtered by JID or push name',
      action: 'Get contacts',
    },
    {
      name: 'Get Many',
      value: 'getMany',
      description:
        'Get many chats with their last message and unread count, newest first (only chats with stored messages)',
      action: 'Get many chats',
    },
    {
      name: 'Get Messages',
      value: 'getMessages',
      description:
        'Get messages stored by Evolution, newest first, filtered by chat, ID, type or date',
      action: 'Get messages',
    },
    {
      name: 'Get Poll Votes',
      value: 'getPollVotes',
      description: `Get the results and voters of a poll. ${REQUIRES_24}`,
      action: 'Get the votes of a poll',
    },
    {
      name: 'Get Status Updates',
      value: 'getStatusUpdates',
      description: 'Get the delivery and read receipts of messages (sent, delivered, read, played)',
      action: 'Get delivery status updates of messages',
    },
    {
      name: 'Mark as Played',
      value: 'markAsPlayed',
      description: `Send the "played" receipt (blue microphone) for voice messages. ${REQUIRES_24}`,
      action: 'Mark voice messages as played',
    },
    {
      name: 'Mark as Read',
      value: 'markAsRead',
      description: 'Send read receipts (blue ticks) for messages',
      action: 'Mark messages as read',
    },
    {
      name: 'Mark as Unread',
      value: 'markUnread',
      description: 'Mark a whole chat as unread',
      action: 'Mark a chat as unread',
    },
    {
      name: 'Send Presence',
      value: 'sendPresence',
      description: 'Show "typing…" or "recording audio…" in a chat for a while',
      action: 'Send a typing or recording indicator',
    },
    {
      name: 'Update Block Status',
      value: 'updateBlockStatus',
      description: 'Block or unblock a contact',
      action: 'Block or unblock a contact',
    },
  ],
  default: 'checkNumbers',
};

export const fields: INodeProperties[] = [
  ...archive.description,
  ...checkNumbers.description,
  ...deleteMessage.description,
  ...downloadMedia.description,
  ...editMessage.description,
  ...get.description,
  ...getChannels.description,
  ...getContacts.description,
  ...getMany.description,
  ...getMessages.description,
  ...getPollVotes.description,
  ...getStatusUpdates.description,
  ...markAsPlayed.description,
  ...markAsRead.description,
  ...markUnread.description,
  ...sendPresence.description,
  ...updateBlockStatus.description,
];

export const execute: Record<string, OperationHandler> = {
  archive: archive.execute,
  checkNumbers: checkNumbers.execute,
  deleteMessage: deleteMessage.execute,
  downloadMedia: downloadMedia.execute,
  editMessage: editMessage.execute,
  get: get.execute,
  getChannels: getChannels.execute,
  getContacts: getContacts.execute,
  getMany: getMany.execute,
  getMessages: getMessages.execute,
  getPollVotes: getPollVotes.execute,
  getStatusUpdates: getStatusUpdates.execute,
  markAsPlayed: markAsPlayed.execute,
  markAsRead: markAsRead.execute,
  markUnread: markUnread.execute,
  sendPresence: sendPresence.execute,
  updateBlockStatus: updateBlockStatus.execute,
};
