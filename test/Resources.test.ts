import type { INodeProperties, INodePropertyOptions } from 'n8n-workflow';

import { EvolutionApi } from '../nodes/EvolutionApi/EvolutionApi.node';
import { CREDENTIAL_TYPE } from '../nodes/EvolutionApi/GenericFunctions';
import { DEFAULT_RESOURCE, RESOURCES, resourceProperty } from '../nodes/EvolutionApi/resources';

const PLANNED_RESOURCES = [
  'call',
  'chat',
  'chatbot',
  'chatwoot',
  'group',
  'instance',
  'label',
  'message',
  'profile',
  'proxy',
  'settings',
  'template',
  'webhook',
];

type OperationOption = { name: string; value: string; description: string; action: string };

describe('Resource registry', () => {
  it('registers every planned resource exactly once', () => {
    expect(RESOURCES.map((r) => r.value).sort()).toEqual([...PLANNED_RESOURCES].sort());
  });

  it('lists resources alphabetically in the selector', () => {
    const names = RESOURCES.map((r) => r.name);
    expect(names).toEqual([...names].sort());
  });

  it('has a valid default resource', () => {
    expect(resourceProperty.default).toBe(DEFAULT_RESOURCE);
    expect(RESOURCES.map((r) => r.value)).toContain(DEFAULT_RESOURCE);
    expect(resourceProperty.noDataExpression).toBe(true);
  });
});

describe.each(RESOURCES.map((r) => ({ name: r.value, module: r.module })))(
  '$name resource',
  ({ name, module }) => {
    const { operations, fields, execute } = module;
    const options = operations.options as OperationOption[];

    it('has the operation selector structure', () => {
      expect(operations.displayName).toBe('Operation');
      expect(operations.name).toBe('operation');
      expect(operations.type).toBe('options');
      expect(operations.noDataExpression).toBe(true);
      expect(operations.displayOptions?.show?.resource).toEqual([name]);
    });

    it('has at least one complete operation (name, value, description, action)', () => {
      expect(options.length).toBeGreaterThan(0);
      for (const option of options) {
        expect(option.name).toBeTruthy();
        expect(option.value).toBeTruthy();
        expect(option.description).toBeTruthy();
        expect(option.action).toBeTruthy();
      }
    });

    it('has unique and alphabetically sorted operations', () => {
      const values = options.map((o) => o.value);
      expect(values).toEqual([...new Set(values)]);
      const names = options.map((o) => o.name);
      expect(names).toEqual([...names].sort());
    });

    it('has a valid default operation', () => {
      expect(options.map((o) => o.value)).toContain(operations.default);
    });

    it('has a handler for every operation and an operation for every handler', () => {
      expect(Object.keys(execute).sort()).toEqual(options.map((o) => o.value).sort());
      for (const handler of Object.values(execute)) expect(typeof handler).toBe('function');
    });

    it('scopes every field to this resource and to existing operations', () => {
      const values = options.map((o) => o.value);
      for (const field of fields) {
        expect(field.displayOptions?.show?.resource).toEqual([name]);
        const fieldOperations = field.displayOptions?.show?.operation as string[] | undefined;
        expect(fieldOperations).toBeDefined();
        for (const operation of fieldOperations ?? []) expect(values).toContain(operation);
      }
    });

    it('describes 2.4-only fields consistently', () => {
      const text = JSON.stringify(fields);
      // "2.4" as a version (not inside 12.45 or 2.40): \b stops at digits on the left.
      if (/\b2\.4(?!\d)/.test(text)) expect(text).toContain('Requires Evolution API 2.4+');
    });

    it('declares loadOptions/listSearch methods with functions', () => {
      for (const group of [module.methods?.loadOptions, module.methods?.listSearch]) {
        for (const method of Object.values(group ?? {})) expect(typeof method).toBe('function');
      }
    });
  },
);

describe('EvolutionApi node description', () => {
  const node = new EvolutionApi();
  const { description } = node;
  const properties = description.properties;

  it('is usable as an AI tool and uses main connections', () => {
    expect(description.usableAsTool).toBe(true);
    expect(description.inputs).toEqual(['main']);
    expect(description.outputs).toEqual(['main']);
    expect(description.icon).toBe('file:evolution.svg');
    expect(description.subtitle).toBeTruthy();
  });

  it('uses the Evolution credential', () => {
    expect(description.credentials).toEqual([{ name: CREDENTIAL_TYPE, required: true }]);
  });

  it('orders resource, operations, instance name variants, then fields', () => {
    expect(properties[0].name).toBe('resource');
    const firstInstance = properties.findIndex((p) => p.name === 'instanceName');
    expect(properties.slice(1, firstInstance).every((p) => p.name === 'operation')).toBe(true);
    expect(firstInstance).toBe(RESOURCES.length + 1);
    // One variant for the resources without noInstanceOperations, plus one per resource with
    // them; all contiguous, before every resource field.
    const variants = properties.filter((p) => p.name === 'instanceName').length;
    const expected =
      (RESOURCES.some(({ module }) => !module.noInstanceOperations?.length) ? 1 : 0) +
      RESOURCES.filter(({ module }) => module.noInstanceOperations?.length).length;
    expect(variants).toBe(expected);
    expect(
      properties
        .slice(firstInstance, firstInstance + variants)
        .every((p) => p.name === 'instanceName'),
    ).toBe(true);
  });

  it('shows the instance locator for every operation except noInstanceOperations', () => {
    const variants = properties.filter((p) => p.name === 'instanceName');
    for (const variant of variants) {
      expect(variant.type).toBe('resourceLocator');
      expect(variant.required).toBeFalsy();
      expect(variant.modes?.map((m) => m.name)).toEqual(['list', 'name']);
      expect(variant.modes?.[0].typeOptions?.searchListMethod).toBe('searchInstances');
    }
    expect(node.methods.listSearch.searchInstances).toBeDefined();

    // Exactly one variant is visible for every resource/operation that needs an instance,
    // and none for the operations listed in noInstanceOperations.
    const isVisible = (variant: INodeProperties, resource: string, operation: string) => {
      const show = variant.displayOptions?.show ?? {};
      const resources = show.resource as string[] | undefined;
      const operations = show.operation as string[] | undefined;
      return (
        (!resources || resources.includes(resource)) &&
        (!operations || operations.includes(operation))
      );
    };
    for (const { value, module } of RESOURCES) {
      for (const option of module.operations.options as OperationOption[]) {
        const visible = variants.filter((v) => isVisible(v, value, option.value)).length;
        const expected = module.noInstanceOperations?.includes(option.value) ? 0 : 1;
        expect(`${value}.${option.value}:${visible}`).toBe(`${value}.${option.value}:${expected}`);
      }
    }
  });

  it('declares noInstanceOperations only with existing operation values', () => {
    for (const { module } of RESOURCES) {
      const values = (module.operations.options as OperationOption[]).map((o) => o.value);
      for (const operation of module.noInstanceOperations ?? [])
        expect(values).toContain(operation);
    }
  });

  it('never reuses a parameter name with a different type', () => {
    const types = new Map<string, string>();
    for (const property of properties) {
      if (property.name === 'operation') continue;
      const known = types.get(property.name);
      if (known) expect(`${property.name}:${property.type}`).toBe(`${property.name}:${known}`);
      types.set(property.name, property.type);
    }
  });

  it('registers every loadOptions/listSearch method referenced by a field', () => {
    const referenced = { loadOptions: new Set<string>(), listSearch: new Set<string>() };
    const visit = (list: Array<INodeProperties | INodePropertyOptions>) => {
      for (const entry of list) {
        if (!('type' in entry) && !('values' in entry)) continue;
        const property = entry as INodeProperties & { values?: INodeProperties[] };
        const loadOptionsMethod = property.typeOptions?.loadOptionsMethod;
        if (loadOptionsMethod) referenced.loadOptions.add(String(loadOptionsMethod));
        for (const mode of property.modes ?? []) {
          const searchListMethod = mode.typeOptions?.searchListMethod;
          if (searchListMethod) referenced.listSearch.add(String(searchListMethod));
        }
        if (property.options) visit(property.options as INodeProperties[]);
        if (property.values) visit(property.values);
      }
    };
    visit(properties);

    const methods = node.methods as {
      loadOptions: Record<string, unknown>;
      listSearch: Record<string, unknown>;
    };
    for (const name of referenced.loadOptions) {
      expect(`loadOptions.${name}:${typeof methods.loadOptions[name]}`).toBe(
        `loadOptions.${name}:function`,
      );
    }
    for (const name of referenced.listSearch) {
      expect(`listSearch.${name}:${typeof methods.listSearch[name]}`).toBe(
        `listSearch.${name}:function`,
      );
    }
  });

  it('never registers the same method name twice across resources', () => {
    for (const group of ['loadOptions', 'listSearch'] as const) {
      const names = RESOURCES.flatMap(({ module }) => Object.keys(module.methods?.[group] ?? {}));
      if (group === 'listSearch') names.push('searchInstances');
      expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([]);
    }
  });

  it('keeps every option list free of duplicate values', () => {
    const check = (list: INodeProperties[]) => {
      for (const property of list) {
        const opts = property.options as Array<INodePropertyOptions | INodeProperties> | undefined;
        if (!opts) continue;
        const values = opts.map((o) => ('value' in o ? String(o.value) : o.name));
        expect(values).toEqual([...new Set(values)]);
        const nested = opts.filter((o): o is INodeProperties => 'type' in o);
        check(nested);
      }
    };
    check(properties);
  });
});
