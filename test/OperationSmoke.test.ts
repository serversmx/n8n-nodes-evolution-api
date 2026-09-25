import type { IDataObject, INodeParameters, INodeProperties, INodePropertyOptions } from 'n8n-workflow';
import { NodeApiError, NodeHelpers, NodeOperationError } from 'n8n-workflow';

import { EvolutionApi } from '../nodes/EvolutionApi/EvolutionApi.node';
import { resetRetryPolicy, setRetryPolicy } from '../nodes/EvolutionApi/GenericFunctions';
import { RESOURCES } from '../nodes/EvolutionApi/resources';
import { binaryItem, createMockExecuteFunctions, rl } from './helpers/mockExecuteFunctions';

const { description } = new EvolutionApi();
const properties = description.properties;
const visible = (params: IDataObject, property: INodeProperties) => NodeHelpers.displayParameter(
  params as INodeParameters, property, { typeVersion: 1 }, description,
);

function sample(property: INodeProperties): IDataObject[string] {
  const name = property.name.toLowerCase();
  if (property.type === 'resourceLocator') return rl(name.includes('group') ? '120363000000000000@g.us' : 'fixture');
  if (property.type === 'json') return property.placeholder || property.default || '{}';
  if (property.type !== 'string') return property.default as IDataObject[string];
  if (name.includes('url')) return 'https://example.test/file.png';
  if (name.includes('base64')) return 'aGVsbG8=';
  if (name.includes('jid')) return '525512345678@s.whatsapp.net';
  if (name.includes('number') || name.includes('participants') || name.includes('recipients')) return '525512345678';
  if (name.includes('options')) return 'A\nB';
  if (name === 'binarypropertyname') return 'data';
  return `fixture-${property.name}`;
}

function seed(values: IDataObject): IDataObject {
  // Resource and operation cannot be expressions. Preselect their fields while generating
  // fixtures; execution below still uses the full description in the shared harness.
  const scoped = properties.filter((property) => {
    const show = property.displayOptions?.show;
    return (!show?.resource || show.resource.includes(String(values.resource))) &&
      (!show?.operation || show.operation.includes(String(values.operation)));
  });
  const normalize = (input: IDataObject) => (NodeHelpers.getNodeParameters(
    scoped, input as INodeParameters, true, false, { typeVersion: 1 }, description,
  ) ?? {}) as IDataObject;
  let params = normalize(values);
  for (let pass = 0; pass < 3; pass++) {
    for (const property of scoped) {
      if (!visible(params, property)) continue;
      if (property.name === 'instanceName') params.instanceName = rl('main');
      if (!property.required) continue;
      const current = params[property.name];
      if (current === '' || current === undefined || (typeof current === 'object' && current !== null &&
        (Object.keys(current).length === 0 || ('__rl' in current && !current.value)))) {
        params[property.name] = sample(property);
      }
    }
    params = normalize({ ...params, ...values });
  }
  return params;
}

// These are deliberately permissive: the smoke suite tests parameter structure, not API schemas.
const shapes = [
  { name: 'empty', body: {} },
  { name: 'object', body: { id: '1', key: { id: 'K', remoteJid: '525512345678@s.whatsapp.net' },
    message: {}, base64: 'aGVsbG8=', mimetype: 'image/png', webhook: {}, settings: {}, enabled: true,
    instance: { instanceName: 'main' }, records: [], messages: { records: [], total: 0, pages: 0 }, total: 0 } },
  { name: 'array', body: [{ id: '1', name: 'fixture', remoteJid: '525512345678@s.whatsapp.net' }] },
];

const controllers = new Set<string>();
function collectControllers(fields: INodeProperties[]): void {
  for (const field of fields) {
    for (const rules of [field.displayOptions?.show, field.displayOptions?.hide]) {
      for (const name of Object.keys(rules ?? {})) controllers.add(name.replace(/^\//, ''));
    }
    for (const option of field.options ?? []) {
      if ('type' in option) collectControllers([option as INodeProperties]);
      if ('values' in option) collectControllers(option.values);
    }
  }
}
collectControllers(properties);

const cases = RESOURCES.flatMap(({ value: resource, module }) =>
  Object.entries(module.execute).flatMap(([operation, handler]) => {
    const variants: IDataObject[] = [{ resource, operation }];
    const covered = new Set<string>();
    // Discover options made visible by an earlier controller (e.g. audio -> mediaSource).
    for (let index = 0; index < variants.length; index++) {
      const params = seed(variants[index]);
      for (const property of properties) {
        if (!controllers.has(property.name) || ['resource', 'operation'].includes(property.name) || !visible(params, property)) continue;
        const values = property.type === 'boolean' ? [false, true] : property.type === 'options'
          ? (property.options as INodePropertyOptions[] | undefined)?.map((option) => option.value) ?? [] : [];
        for (const value of values) {
          const key = `${property.name}:${value}`;
          if (covered.has(key)) continue;
          covered.add(key);
          variants.push({ ...variants[index], [property.name]: value });
        }
      }
    }
    return variants.flatMap((variant) => {
      const params = seed(variant);
      return shapes.map((shape) => ({
        label: `${resource}.${operation} ${JSON.stringify(variant)} ${shape.name}`,
        params, handler, body: shape.body,
      }));
    });
  }));

beforeEach(() => setRetryPolicy({ sleep: async () => undefined, maxRetries: 0 }));
afterEach(() => resetRetryPolicy());

it.each(cases)('$label reads only displayed parameters and reports structured errors', async ({ params, handler, body }) => {
  const ctx = createMockExecuteFunctions({
    params,
    items: [binaryItem({}, { data: { content: 'PNGDATA', fileName: 'image.png', mimeType: 'image/png' } })],
  });
  jest.spyOn(ctx.helpers, 'httpRequestWithAuthentication').mockImplementation(async () => ({
    statusCode: 200, headers: {}, body: JSON.parse(JSON.stringify(body)), statusMessage: '',
  }));
  let failure: unknown;
  try {
    await handler.call(ctx, 0);
  } catch (error) {
    failure = error;
  }
  if (failure !== undefined) {
    expect(failure instanceof NodeApiError || failure instanceof NodeOperationError).toBe(true);
    expect(String(failure)).not.toContain('Could not get parameter');
  }
  const displayed = new Set(properties.filter((property) => visible(params, property)).map((property) => property.name));
  for (const [name] of (ctx.getNodeParameter as jest.Mock).mock.calls) {
    expect(displayed.has(String(name).split('.')[0])).toBe(true);
  }
});
