import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

import {
  encodePathSegment,
  evolutionApiRequest,
  resolveInstanceName,
} from '../../GenericFunctions';
import { openaiCredentialProperty } from './fields';
import { withChatbotHint } from './helpers';

const properties: INodeProperties[] = [
  {
    ...openaiCredentialProperty,
    description:
      'OpenAI credential to delete. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
  },
];

export const description = updateDisplayOptions(
  { show: { resource: ['chatbot'], operation: ['deleteCredential'] } },
  properties,
);

/**
 * DELETE /openai/creds/:openaiCredsId/:instanceName → 200 { openaiCreds: { id } }.
 * 500 "Openai Creds not found" for an unknown ID or a credential of another instance.
 */
export async function execute(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
  const instance = await resolveInstanceName.call(this, itemIndex);
  const credsId = String(this.getNodeParameter('openaiCredsId', itemIndex, '')).trim();
  try {
    return (await evolutionApiRequest.call(
      this,
      'DELETE',
      `/openai/creds/${encodePathSegment(credsId, 'OpenAI Credential ID')}/${instance}`,
      {},
      {},
      { itemIndex },
    )) as IDataObject;
  } catch (error) {
    throw withChatbotHint(
      error,
      'Check that the credential exists on this instance (Get OpenAI Credentials) and that no OpenAI bot still uses it.',
    );
  }
}
