import type { INodeProperties } from 'n8n-workflow';

import type { OperationHandler } from '../../types';
import * as connect from './connect.operation';
import * as create from './create.operation';
import * as deleteInstance from './delete.operation';
import * as getConnectionState from './getConnectionState.operation';
import * as getMany from './getMany.operation';
import * as logout from './logout.operation';
import * as restart from './restart.operation';
import * as setPresence from './setPresence.operation';

/**
 * Instance resource — reference implementation for the other resources.
 * Routes: src/api/routes/instance.router.ts (identical in 2.3.7 and 2.4.0-rc2).
 */
export const operations: INodeProperties = {
  displayName: 'Operation',
  name: 'operation',
  type: 'options',
  noDataExpression: true,
  displayOptions: {
    show: {
      resource: ['instance'],
    },
  },
  options: [
    {
      name: 'Connect',
      value: 'connect',
      description: 'Start the WhatsApp session and get a QR code or pairing code',
      action: 'Connect an instance',
    },
    {
      name: 'Create',
      value: 'create',
      description: 'Create a new instance (requires the global API key)',
      action: 'Create an instance',
    },
    {
      name: 'Delete',
      value: 'delete',
      description: 'Delete an instance, logging it out first when connected',
      action: 'Delete an instance',
    },
    {
      name: 'Get Connection State',
      value: 'getConnectionState',
      description: 'Get the connection state of an instance (open, connecting or close)',
      action: 'Get the connection state of an instance',
    },
    {
      name: 'Get Many',
      value: 'getMany',
      description: 'List instances with their settings and integrations',
      action: 'Get many instances',
    },
    {
      name: 'Logout',
      value: 'logout',
      description: 'Log out the WhatsApp session but keep the instance',
      action: 'Log out an instance',
    },
    {
      name: 'Restart',
      value: 'restart',
      description: 'Restart the connection of a connected instance',
      action: 'Restart an instance',
    },
    {
      name: 'Set Presence',
      value: 'setPresence',
      description: 'Set the global presence of the account (WhatsApp Baileys only)',
      action: 'Set the presence of an instance',
    },
  ],
  default: 'getConnectionState',
};

export const fields: INodeProperties[] = [
  ...connect.description,
  ...create.description,
  ...deleteInstance.description,
  ...getConnectionState.description,
  ...getMany.description,
  ...logout.description,
  ...restart.description,
  ...setPresence.description,
];

export const execute: Record<string, OperationHandler> = {
  connect: connect.execute,
  create: create.execute,
  delete: deleteInstance.execute,
  getConnectionState: getConnectionState.execute,
  getMany: getMany.execute,
  logout: logout.execute,
  restart: restart.execute,
  setPresence: setPresence.execute,
};

/** Operations that do not target an existing instance: the shared "Instance Name" is hidden. */
export const noInstanceOperations = ['create', 'getMany'];
