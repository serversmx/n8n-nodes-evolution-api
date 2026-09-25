import type {
  IAuthenticateGeneric,
  Icon,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow';

/**
 * Evolution API v2 credential.
 *
 * The internal name is `evolutionWhatsAppApi` on purpose: `evolutionApi`, `evolutionApiApi` and
 * `evolutionApiV2Api` are already taken by other community packages, and n8n credential type
 * names are global. Reusing one of them would break both packages when installed side by side.
 */
export class EvolutionApi implements ICredentialType {
  name = 'evolutionWhatsAppApi';

  displayName = 'Evolution API v2';

  // Same theme-agnostic glyph as the node (see EvolutionApi.node.ts) for both variants.
  icon: Icon = {
    light: 'file:../nodes/EvolutionApi/evolution.svg',
    dark: 'file:../nodes/EvolutionApi/evolution.svg',
  };

  documentationUrl = 'https://doc.evolution-api.com/v2/en/get-started/introduction';

  properties: INodeProperties[] = [
    {
      displayName: 'Base URL',
      name: 'baseUrl',
      type: 'string',
      default: '',
      placeholder: 'https://evolution.example.com',
      description:
        'URL of your Evolution API server (the address that answers GET / with the version), without a trailing slash',
      required: true,
    },
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'string',
      typeOptions: {
        password: true,
      },
      default: '',
      description:
        'The global API key (AUTHENTICATION_API_KEY) or the token of one instance. An instance token only works for that instance; creating instances and listing all instances require the global key.',
      required: true,
    },
    {
      displayName: 'Default Instance Name',
      name: 'defaultInstance',
      type: 'string',
      default: '',
      placeholder: 'my-instance',
      description:
        'Instance used when the node\'s "Instance Name" field is left empty. Recommended when the API key is an instance token: the credential test then checks that instance.',
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        apikey: '={{$credentials.apiKey}}',
      },
    },
  };

  // The auth guard accepts both a global key and an instance token on
  // GET /instance/connectionState/:instanceName (token of that instance) and on
  // GET /instance/fetchInstances (token lookup when DATABASE_SAVE_DATA_INSTANCE=true).
  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.baseUrl.trim().replace(/\\/+$/, "")}}',
      url: '={{ ($credentials.defaultInstance || "").trim() ? "/instance/connectionState/" + encodeURIComponent($credentials.defaultInstance.trim()) : "/instance/fetchInstances" }}',
      method: 'GET',
    },
    rules: [
      {
        type: 'responseCode',
        properties: {
          value: 503,
          message:
            'Evolution API answered 503. On Evolution API 2.4+ this means the server license is not activated (LICENSE_REQUIRED): open <Base URL>/manager/login to activate it and check GET <Base URL>/license/status, then test again. Otherwise the server is temporarily unavailable.',
        },
      },
      {
        type: 'responseCode',
        properties: {
          value: 401,
          message:
            'Invalid API key. Use the global key (AUTHENTICATION_API_KEY) or an instance token; when using an instance token, set "Default Instance Name" to that instance.',
        },
      },
      {
        type: 'responseCode',
        properties: {
          value: 404,
          message:
            'Not found. Check the Base URL and, if set, that the "Default Instance Name" exists on this server.',
        },
      },
    ],
  };
}
