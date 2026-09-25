import { EvolutionApiTrigger } from '../nodes/EvolutionApi/EvolutionApiTrigger.node';
import { CREDENTIAL_TYPE } from '../nodes/EvolutionApi/GenericFunctions';

// Tests of the trigger node (owned by the trigger agent).

describe('EvolutionApiTrigger stub', () => {
  it('is a webhook trigger using the same credential', () => {
    const { description } = new EvolutionApiTrigger();
    expect(description.group).toEqual(['trigger']);
    expect(description.inputs).toEqual([]);
    expect(description.outputs).toEqual(['main']);
    expect(description.webhooks?.[0]).toMatchObject({ httpMethod: 'POST', path: 'webhook' });
    expect(description.credentials?.[0].name).toBe(CREDENTIAL_TYPE);
  });

  it('emits the received body', async () => {
    const trigger = new EvolutionApiTrigger();
    const body = { event: 'messages.upsert', instance: 'main', data: { key: { id: 'X' } } };
    const ctx = {
      getBodyData: () => body,
      helpers: { returnJsonArray: (data: object) => [{ json: data }] },
    };
    const result = await trigger.webhook.call(ctx as never);
    expect(result.workflowData).toEqual([[{ json: body }]]);
  });
});
