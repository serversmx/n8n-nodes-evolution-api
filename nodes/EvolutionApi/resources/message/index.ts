import type { INodeProperties } from 'n8n-workflow';

import { REQUIRES_24 } from '../../constants';
import type { OperationHandler } from '../../types';
import * as generateMessageId from './generateMessageId.operation';
import * as sendAudio from './sendAudio.operation';
import * as sendButtons from './sendButtons.operation';
import * as sendCarousel from './sendCarousel.operation';
import * as sendContact from './sendContact.operation';
import * as sendList from './sendList.operation';
import * as sendLocation from './sendLocation.operation';
import * as sendMedia from './sendMedia.operation';
import * as sendPoll from './sendPoll.operation';
import * as sendPtv from './sendPtv.operation';
import * as sendReaction from './sendReaction.operation';
import * as sendStatus from './sendStatus.operation';
import * as sendSticker from './sendSticker.operation';
import * as sendTemplate from './sendTemplate.operation';
import * as sendText from './sendText.operation';

/**
 * Message resource: every send route of src/api/routes/sendMessage.router.ts (2.3.7 and
 * 2.4.0-rc2, plus sendCarousel from 2.4) and GET /baileys/generateMessageID (2.4), which
 * provides IDs for the `messageId` send option. Each send operation sends one message per input
 * item and returns the sent message ({ key: { id, remoteJid, fromMe }, message, messageTimestamp,
 * … }). The message routes under /chat (edit, delete, download media, find messages, poll
 * votes…) live in the chat resource.
 * Keep 'sendText' as the default operation: 'message' is the node's default resource.
 */
export const operations: INodeProperties = {
  displayName: 'Operation',
  name: 'operation',
  type: 'options',
  noDataExpression: true,
  displayOptions: {
    show: {
      resource: ['message'],
    },
  },
  options: [
    {
      name: 'Generate Message ID',
      value: 'generateMessageId',
      description: `Generate a valid WhatsApp message ID to pass as Custom Message ID of a send operation, e.g. for retries without duplicates (WhatsApp Baileys only). ${REQUIRES_24}`,
      action: 'Generate a message ID',
    },
    {
      name: 'Send Audio',
      value: 'sendAudio',
      description:
        'Send a voice note (push-to-talk) from a URL, base64 or binary file; converted to OGG/Opus by Evolution',
      action: 'Send a voice message',
    },
    {
      name: 'Send Buttons',
      value: 'sendButtons',
      description:
        'Send a message with quick reply, URL, call, copy code or PIX buttons (1-3 replies or 1-2 call-to-action buttons)',
      action: 'Send a button message',
    },
    {
      name: 'Send Carousel',
      value: 'sendCarousel',
      description: `Send a carousel of 1-10 cards with image, text and buttons (WhatsApp Baileys only). ${REQUIRES_24}`,
      action: 'Send a carousel message',
    },
    {
      name: 'Send Contact',
      value: 'sendContact',
      description: 'Send one or more contact cards (vCards)',
      action: 'Send a contact card',
    },
    {
      name: 'Send List',
      value: 'sendList',
      description: 'Send a message with a button that opens a list of selectable rows',
      action: 'Send a list message',
    },
    {
      name: 'Send Location',
      value: 'sendLocation',
      description: 'Send a map location with a name and an address',
      action: 'Send a location',
    },
    {
      name: 'Send Media',
      value: 'sendMedia',
      description:
        'Send an image, video, document or audio file from a URL, base64 or binary file, with an optional caption',
      action: 'Send an image, video, document or audio file',
    },
    {
      name: 'Send Poll',
      value: 'sendPoll',
      description: 'Send a poll with 2-10 options (WhatsApp Baileys only)',
      action: 'Send a poll',
    },
    {
      name: 'Send Reaction',
      value: 'sendReaction',
      description: 'React to a message with an emoji, or remove a reaction',
      action: 'React to a message',
    },
    {
      name: 'Send Status',
      value: 'sendStatus',
      description:
        'Post a text, image, video or audio status (story) to selected contacts (WhatsApp Baileys only)',
      action: 'Post a status (story)',
    },
    {
      name: 'Send Sticker',
      value: 'sendSticker',
      description:
        'Send an image as a sticker; Evolution converts it to WebP (WhatsApp Baileys only)',
      action: 'Send a sticker',
    },
    {
      name: 'Send Template',
      value: 'sendTemplate',
      description:
        'Send an approved WhatsApp Business template, e.g. to start a conversation (WhatsApp Cloud API instances only)',
      action: 'Send a template message',
    },
    {
      name: 'Send Text',
      value: 'sendText',
      description: 'Send a text message, optionally as a reply or with mentions',
      action: 'Send a text message',
    },
    {
      name: 'Send Video Note',
      value: 'sendPtv',
      description:
        'Send a round video note (PTV) from an MP4 URL, base64 or binary file (WhatsApp Baileys only)',
      action: 'Send a video note',
    },
  ],
  default: 'sendText',
};

export const fields: INodeProperties[] = [
  ...generateMessageId.description,
  ...sendAudio.description,
  ...sendButtons.description,
  ...sendCarousel.description,
  ...sendContact.description,
  ...sendList.description,
  ...sendLocation.description,
  ...sendMedia.description,
  ...sendPoll.description,
  ...sendReaction.description,
  ...sendStatus.description,
  ...sendSticker.description,
  ...sendTemplate.description,
  ...sendText.description,
  ...sendPtv.description,
];

export const execute: Record<string, OperationHandler> = {
  generateMessageId: generateMessageId.execute,
  sendAudio: sendAudio.execute,
  sendButtons: sendButtons.execute,
  sendCarousel: sendCarousel.execute,
  sendContact: sendContact.execute,
  sendList: sendList.execute,
  sendLocation: sendLocation.execute,
  sendMedia: sendMedia.execute,
  sendPoll: sendPoll.execute,
  sendPtv: sendPtv.execute,
  sendReaction: sendReaction.execute,
  sendStatus: sendStatus.execute,
  sendSticker: sendSticker.execute,
  sendTemplate: sendTemplate.execute,
  sendText: sendText.execute,
};

/** After sending a file, keep the input item's binary on the output (for later nodes). */
export const binaryPassThrough = ['sendAudio', 'sendMedia', 'sendPtv', 'sendStatus', 'sendSticker'];
