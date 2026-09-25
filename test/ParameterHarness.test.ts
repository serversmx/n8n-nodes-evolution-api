import { createMockExecuteFunctions, normalizeNodeParameters } from './helpers/mockExecuteFunctions';

describe('n8n parameter normalization', () => {
  it('removes a supplied hidden field and throws when it is read without a fallback', () => {
    const ctx = createMockExecuteFunctions({
      params: { resource: 'chat', operation: 'getMessages', returnAll: true, limit: 123 },
    });
    expect(() => ctx.getNodeParameter('limit', 0)).toThrow('Could not get parameter "limit"');
    expect(ctx.getNodeParameter('limit', 0, 50)).toBe(50);
  });

  it('follows controller values per item and applies only the visible defaults', () => {
    const ctx = createMockExecuteFunctions({
      params: { resource: 'message', operation: 'sendStatus', caption: 'hidden' },
      itemParams: [{ statusType: 'audio' }, { statusType: 'image' }, { statusType: 'text' }],
    });
    expect(() => ctx.getNodeParameter('caption', 0)).toThrow('Could not get parameter');
    expect(ctx.getNodeParameter('caption', 1)).toBe('hidden');
    expect(ctx.getNodeParameter('statusFont', 2)).toBe(1);
    expect(() => ctx.getNodeParameter('statusFont', 1)).toThrow('Could not get parameter');
  });

  it('drops unknown collection options and fields hidden by integration', () => {
    const params = normalizeNodeParameters({
      resource: 'message', operation: 'sendMedia', mediatype: 'image',
      options: { madeUp: 'hidden' },
    });
    // Unknown collection properties are removed too, as in Workflow construction.
    expect(params.options).not.toHaveProperty('madeUp');
    expect(normalizeNodeParameters({
      resource: 'instance', operation: 'create', integration: 'EVOLUTION', businessToken: 'hidden',
    })).not.toHaveProperty('businessToken');
  });
});
