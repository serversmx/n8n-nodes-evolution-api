import { EvolutionApi as EvolutionApiCredential } from '../credentials/EvolutionApi.credentials';
import { CREDENTIAL_TYPE } from '../nodes/EvolutionApi/GenericFunctions';

describe('EvolutionApi credential', () => {
  const credential = new EvolutionApiCredential();

  it('uses a globally unique credential name', () => {
    expect(credential.name).toBe(CREDENTIAL_TYPE);
    expect(['evolutionApi', 'evolutionApiApi', 'evolutionApiV2Api']).not.toContain(credential.name);
  });

  it('authenticates with the apikey header', () => {
    expect(credential.authenticate).toEqual({
      type: 'generic',
      properties: { headers: { apikey: '={{$credentials.apiKey}}' } },
    });
  });

  it('exposes baseUrl, apiKey (password) and defaultInstance', () => {
    const byName = Object.fromEntries(credential.properties.map((p) => [p.name, p]));
    expect(Object.keys(byName)).toEqual(['baseUrl', 'apiKey', 'defaultInstance']);
    expect(byName.apiKey.typeOptions?.password).toBe(true);
    expect(byName.defaultInstance.required).toBeFalsy();
  });

  it('tests against an endpoint accepted by both global keys and instance tokens', () => {
    const url = String(credential.test.request.url);
    expect(url).toContain('/instance/connectionState/');
    expect(url).toContain('/instance/fetchInstances');
    expect(credential.test.request.method).toBe('GET');
  });

  it('explains 503 LICENSE_REQUIRED, 401 and 404 in the credential test', () => {
    const rules = credential.test.rules ?? [];
    const byCode = Object.fromEntries(rules.map((r) => [r.properties.value, r.properties.message]));
    expect(String(byCode[503])).toContain('LICENSE_REQUIRED');
    expect(String(byCode[503])).toContain('/manager/login');
    expect(String(byCode[401])).toContain('API key');
    expect(String(byCode[404])).toContain('Default Instance Name');
  });
});
