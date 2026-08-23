import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { NodeOperationError } from 'n8n-workflow';

import { JsonForm } from './JsonForm.node';

/** An import document replacing builder Fields in the tests below. */
const importedDoc = JSON.stringify({
  schema: {
    type: 'object',
    title: 'Imported form',
    properties: {
      email: { type: 'string', maxLength: 254 },
      plan: { type: 'string', enum: ['free', 'pro'] },
    },
    required: ['email'],
  },
  uiSchema: {
    type: 'VerticalLayout',
    elements: [
      { type: 'Control', scope: '#/properties/email', label: 'Email' },
      { type: 'Control', scope: '#/properties/plan', label: 'Plan' },
    ],
  },
});

/**
 * An import whose schema collides with the system-set submission timestamp —
 * the one structural rejection every import shares.
 */
const reservedDoc = JSON.stringify({
  schema: {
    type: 'object',
    properties: {
      submittedAt: { type: 'string' },
    },
  },
  uiSchema: { type: 'VerticalLayout', elements: [] },
});

/** A passthrough import: nested objects and UI rules must survive untouched. */
const nestedDoc = JSON.stringify({
  schema: {
    type: 'object',
    title: 'Nested form',
    properties: {
      provideAddress: { type: 'boolean' },
      address: { type: 'object', properties: { city: { type: 'string', minLength: 3 } } },
    },
  },
  uiSchema: {
    type: 'Categorization',
    options: { variant: 'stepper' },
    elements: [
      {
        type: 'Category',
        label: 'Address',
        rule: {
          effect: 'SHOW',
          condition: { scope: '#/properties/provideAddress', schema: { const: true } },
        },
        elements: [{ type: 'Control', scope: '#/properties/address/properties/city' }],
      },
    ],
  },
});

/** Schema JSON input half replacing builder Fields in the v2 tests below. */
const importedSchemaJson = JSON.stringify({
  type: 'object',
  title: 'Imported form',
  properties: {
    email: { type: 'string', maxLength: 254 },
    plan: { type: 'string', enum: ['free', 'pro'] },
  },
  required: ['email'],
});

/** UI Schema JSON input half matching importedSchemaJson. */
const importedUiSchemaJson = JSON.stringify({
  type: 'VerticalLayout',
  elements: [
    { type: 'Control', scope: '#/properties/email', label: 'Email' },
    { type: 'Control', scope: '#/properties/plan', label: 'Plan' },
  ],
});

/** A builder configuration mirroring the classic sample form. */
const BUILT_FIELDS = {
  field: [
    { name: 'name', label: 'Full name', type: 'text', required: true, maxLength: 100 },
    { name: 'email', label: 'Email', type: 'text', required: true, maxLength: 254 },
    {
      name: 'role',
      label: 'Role',
      type: 'select',
      choices: ['Developer', 'Designer', 'Manager'],
    },
    { name: 'startDate', label: 'Start date', type: 'date' },
    { name: 'newsletter', label: 'Subscribe to the newsletter', type: 'boolean' },
  ],
};

const VALID_BODY = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  role: 'Developer',
  startDate: '2026-09-01',
  newsletter: true,
};

type FakeRes = {
  statusCode?: number;
  headers: Record<string, string>;
  body: string;
  writeHeadCalls: number;
  writeHead: (status: number, headers: Record<string, string>) => void;
  end: (body: string) => void;
};

function fakeRes(): FakeRes {
  const res: FakeRes = {
    headers: {},
    body: '',
    writeHeadCalls: 0,
    writeHead(status, headers) {
      res.writeHeadCalls += 1;
      res.statusCode = status;
      Object.assign(res.headers, headers);
    },
    end(body) {
      res.body = body;
    },
  };
  return res;
}

const TEMPLATE =
  '<html><title>Form</title><script type="application/json" id="jsonform-config">{}</script></html>';

describe('buildFormPageResponse', () => {
  it('responds with the page as HTML and the configuration blob injected', async () => {
    const { buildFormPageResponse } = await import('./formPage');
    const template =
      '<html><body><script type="application/json" id="jsonform-config">{}</script></body></html>';

    const response = buildFormPageResponse(
      { schema: { type: 'object' }, uiSchema: { type: 'VerticalLayout', elements: [] } },
      () => template,
    );

    expect(response.statusCode).toBe(200);
    expect(response.contentType).toBe('text/html; charset=utf-8');
    expect(response.body).toContain('id="jsonform-config"');
  });
});

describe('JsonForm node description', () => {
  const description = new JsonForm().description;

  function findProperty(name: string) {
    const property = description.properties.find((candidate) => candidate.name === name);
    if (!property) throw new Error(`${name} property must exist`);
    return property;
  }

  function entryValues(): Array<Record<string, unknown>> {
    const fields = findProperty('fields');
    const collection = (
      'options' in fields && Array.isArray(fields.options) ? fields.options : []
    )[0] as { values?: Array<Record<string, unknown>> };
    return collection.values ?? [];
  }

  function entryProperty(name: string): Record<string, unknown> {
    const property = entryValues().find((value) => value.name === name);
    if (!property) throw new Error(`Field entry property "${name}" must exist`);
    return property;
  }

  it("exposes n8n's standard Response Mode options with When Last Node Finishes as default", () => {
    const responseMode = findProperty('responseMode');

    expect(responseMode).toMatchObject({ type: 'options', default: 'lastNode' });
    const options = (
      'options' in responseMode && Array.isArray(responseMode.options)
        ? responseMode.options
        : []
    ) as Array<{ value: string; name: string }>;
    expect(options.map((option) => option.value)).toEqual([
      'onReceived',
      'lastNode',
      'responseNode',
    ]);
    expect(options.map((option) => option.name)).toEqual([
      'On Received',
      'When Last Node Finishes',
      'Respond to Webhook',
    ]);
  });

  it("exposes n8n's standard Authentication options with None as default", () => {
    const authentication = findProperty('authentication');

    expect(authentication).toMatchObject({ type: 'options', default: 'none' });
    const options = (
      'options' in authentication && Array.isArray(authentication.options)
        ? authentication.options
        : []
    ) as Array<{ value: string; name: string }>;
    expect(options.map((option) => option.value)).toEqual(['basicAuth', 'headerAuth', 'none']);
    expect(options.map((option) => option.name)).toEqual(['Basic Auth', 'Header Auth', 'None']);
  });

  it('wires the matching n8n credential type for each non-none authentication option', () => {
    expect(description.credentials).toEqual([
      {
        name: 'httpBasicAuth',
        required: true,
        displayOptions: { show: { authentication: ['basicAuth'] } },
      },
      {
        name: 'httpHeaderAuth',
        required: true,
        displayOptions: { show: { authentication: ['headerAuth'] } },
      },
    ]);
  });

  it('exposes Import inputs split per node version', () => {
    // v1 nodes keep the combined document; v2 nodes speak Schema JSON / UI Schema JSON.
    expect(findProperty('importConfig')).toMatchObject({
      displayOptions: { show: { '@version': [1] } },
    });

    expect(findProperty('schemaJson')).toMatchObject({
      displayName: 'Schema JSON',
      displayOptions: { show: { '@version': [2] } },
    });
    expect(findProperty('uiSchemaJson')).toMatchObject({
      displayName: 'UI Schema JSON',
      displayOptions: { show: { '@version': [2] } },
    });
  });

  it('supports versions [1, 2] with 2 as the default for new nodes', () => {
    expect(description.version).toEqual([1, 2]);
    expect(description.defaultVersion).toBe(2);
  });

  it('resolves the POST webhook response mode from the node parameter at request time', () => {
    const postWebhook = description.webhooks?.find((webhook) => webhook.httpMethod === 'POST');

    // Standard trigger mechanics: n8n core evaluates this registration
    // expression per request, so test and production URLs behave alike.
    expect(postWebhook?.responseMode).toBe('={{ $parameter["responseMode"] }}');
  });

  it('keeps GET registered as onReceived because the page is answered directly', () => {
    const getWebhook = description.webhooks?.find((webhook) => webhook.httpMethod === 'GET');

    expect(getWebhook?.responseMode).toBe('onReceived');
  });

  it('registers every webhook with isFullPath so n8n serves the exact configured Path', () => {
    // Without isFullPath, n8n prepends the node instance's internal webhookId
    // to the registered production path (e.g. /webhook/<uuid>/json-form).
    for (const webhook of description.webhooks ?? []) {
      expect(webhook.isFullPath).toBe(true);
      expect(webhook.path).toBe('={{ $parameter["path"] }}');
    }
  });

  it('offers Fields as an editable, reorderable collection of field entries', () => {
    const fields = findProperty('fields');

    expect(fields).toMatchObject({ type: 'fixedCollection', placeholder: 'Add Field' });
    const typeOptions = fields.typeOptions as Record<string, unknown> | undefined;
    expect(typeOptions?.multipleValues).toBe(true); // add / edit / remove entries
    expect(typeOptions?.sortButtonEnabled).toBe(true); // reorder entries
    expect(fields.default).toEqual({ field: [] });
  });

  it('exposes name, label, type, and required on every field entry', () => {
    expect(entryProperty('name')).toMatchObject({ type: 'string', required: true });
    expect(entryProperty('label')).toMatchObject({ type: 'string', required: true });
    expect(entryProperty('required')).toMatchObject({ type: 'boolean', default: false });
    expect(String(entryProperty('name').hint)).toMatch(/submittedAt/);
  });

  it('offers exactly the v1 field-type vocabulary', () => {
    const type = entryProperty('type');

    expect(type.type).toBe('options');
    const options = (type.options ?? []) as Array<{ name: string; value: string }>;
    expect(options.map((option) => option.value)).toEqual([
      'text',
      'textarea',
      'number',
      'date',
      'boolean',
      'select',
      'multiselect',
    ]);
  });

  it('shows constraints conditionally by field type', () => {
    const showFor = (property: Record<string, unknown>): string[] => {
      const displayOptions = property.displayOptions as
        | { show?: { type?: string[] } }
        | undefined;
      return displayOptions?.show?.type ?? [];
    };

    expect(showFor(entryProperty('maxLength'))).toEqual(['text', 'textarea']);
    expect(showFor(entryProperty('minLength'))).toEqual(['text', 'textarea']);
    expect(showFor(entryProperty('min'))).toEqual(['number']);
    expect(showFor(entryProperty('max'))).toEqual(['number']);
    expect(showFor(entryProperty('minDate'))).toEqual(['date']);
    expect(showFor(entryProperty('maxDate'))).toEqual(['date']);
    expect(showFor(entryProperty('choices'))).toEqual(['select', 'multiselect']);
  });

  it('exposes the visibility condition inputs on every field entry', () => {
    const fieldInput = entryProperty('visibleWhenField');
    expect(fieldInput).toMatchObject({ type: 'string' });
    expect(String(fieldInput.description)).toMatch(/another field/i);

    // The comparison value accepts raw text and coerces true/false/numbers.
    const valueInput = entryProperty('visibleWhenValue');
    expect(valueInput).toMatchObject({ type: 'string' });
    expect(String(valueInput.description)).toMatch(/true/i);
  });

  it('documents the design-time name rules on the Name input', () => {
    const hint = String(entryProperty('name').hint);

    expect(hint).toMatch(/\^?\[A-Za-z_\]/); // identifier pattern
    expect(hint).toMatch(/unique/i);
    expect(hint).toMatch(/submittedAt/);
  });
});

describe('JsonForm webhook', () => {
  const realLoadPageTemplate = JsonForm.loadPageTemplate;
  beforeEach(() => {
    (JsonForm as unknown as { loadPageTemplate: () => string }).loadPageTemplate = () => TEMPLATE;
  });
  afterAll(() => {
    JsonForm.loadPageTemplate = realLoadPageTemplate;
  });

  interface SetupOptions {
    method: string;
    body?: unknown;
    parameters?: Record<string, unknown>;
    query?: Record<string, string>;
    headers?: Record<string, string>;
    credentials?: Record<string, unknown> | Error;
    typeVersion?: number;
  }

  async function setup({
    method,
    body = {},
    parameters = {},
    query,
    headers = {},
    credentials = {},
    typeVersion = 1,
  }: SetupOptions) {
    const node = new JsonForm();
    const res = fakeRes();
    // Tests that do not care about configuration still get a valid built
    // Form; explicit entries below always win over this default.
    const effectiveParameters: Record<string, unknown> = { fields: BUILT_FIELDS, ...parameters };
    const context = {
      getRequestObject: vi.fn(() => ({ method, query })),
      getResponseObject: vi.fn(() => res),
      getBodyData: vi.fn(() => body),
      getHeaderData: vi.fn(() => headers),
      getCredentials: vi.fn(async (type: string) => {
        if (credentials instanceof Error) throw credentials;
        if (!(type in credentials)) {
          throw new Error(`No credential of type "${type}" is selected on the node.`);
        }
        return credentials[type];
      }),
      getNodeParameter: vi.fn((name: string, fallback?: unknown) =>
        name in effectiveParameters ? effectiveParameters[name] : fallback,
      ),
      getNode: vi.fn(() => ({
        name: 'JSON Form',
        typeVersion,
        type: 'n8n-nodes-jsonform.jsonForm',
      })),
    };

    const result = await node.webhook.call(context as never);
    return { result, res };
  }

  /** Extract and parse the configuration blob out of a served page. */
  function parseServedConfig(html: string): Record<string, unknown> {
    const match = html.match(
      /<script type="application\/json" id="jsonform-config">([\s\S]*?)<\/script>/,
    );
    if (!match?.[1]) throw new Error('No configuration blob found in served page');
    return JSON.parse(match[1]) as Record<string, unknown>;
  }

  it('GET serves a form generated from the built Fields instead of any fixture', async () => {
    const { res } = await setup({
      method: 'GET',
      parameters: {
        formTitle: 'Feedback',
        completionMessage: 'Custom thanks!',
        fields: {
          field: [
            { name: 'favorite_color', label: 'Favorite color', type: 'text', required: true },
            { name: '_private_note', label: 'Private note', type: 'textarea', maxLength: 30 },
          ],
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('text/html; charset=utf-8');
    expect(res.body).not.toMatch(/sample/i);

    const config = parseServedConfig(res.body);
    const schema = config.schema as Record<string, unknown>;
    expect(schema.required).toEqual(['favorite_color']);

    const uiSchema = config.uiSchema as { elements: Array<{ scope: string }> };
    expect(uiSchema.elements.map((element) => element.scope)).toEqual([
      '#/properties/favorite_color',
      '#/properties/_private_note',
    ]);
    expect(config.completionMessage).toBe('Custom thanks!');
  });

  it('round-trips a built Form: render -> fill -> submit -> correct item shape', async () => {
    const rendered = await setup({ method: 'GET' });
    const served = parseServedConfig(rendered.res.body);
    const schema = served.schema as { required?: string[] };
    expect(schema.required).toEqual(['name', 'email']);

    const posted = await setup({
      method: 'POST',
      body: { ...VALID_BODY, utm: 'ignored' },
    });
    const items = posted.result?.workflowData?.[0];
    expect(items).toHaveLength(1);

    const json = items?.[0]?.json as Record<string, unknown>;
    expect(new Date(json.submittedAt as string).getTime()).not.toBeNaN();
    expect(Object.keys(json)).toEqual(['submittedAt', 'name', 'email', 'role', 'startDate', 'newsletter']);
    expect(json.name).toBe('Ada Lovelace');
    expect(json.role).toBe('Developer');
    expect(json.newsletter).toBe(true);
  });

  it('GET flows a configured Accent Color into the config blob', async () => {
    const { res } = await setup({
      method: 'GET',
      parameters: { accentColor: '#7c3aed' },
    });

    expect(res.body).toContain('"accentColor":"#7c3aed"');
  });

  it('GET omits Accent Color from the config blob when unset so the stock theme is served', async () => {
    const { res } = await setup({ method: 'GET' });

    expect(res.body).not.toContain('"accentColor"');
  });

  describe('design-time validation of built Fields', () => {
    const invalidCases: Array<[string, Record<string, unknown>, RegExp]> = [
      [
        'invalid identifier pattern',
        {
          fields: {
            field: [{ name: 'first-name', label: 'First name', type: 'text' }],
          },
        },
        /first-name.*invalid name/i,
      ],
      [
        'duplicate names',
        {
          fields: {
            field: [
              { name: 'email', label: 'Primary email', type: 'text' },
              { name: 'email', label: 'Backup email', type: 'text' },
            ],
          },
        },
        /duplicates the name "email"/i,
      ],
      [
        'reserved submittedAt',
        {
          fields: {
            field: [{ name: 'submittedAt', label: 'When', type: 'text' }],
          },
        },
        /reserved name "submittedAt"/i,
      ],
    ];

    for (const [label, parameters, errorMatch] of invalidCases) {
      it(`fails fast on ${label} when serving the page (GET)`, async () => {
        await expect(setup({ method: 'GET', parameters })).rejects.toThrow(NodeOperationError);
        await expect(setup({ method: 'GET', parameters })).rejects.toThrow(errorMatch);
      });

      it(`fails fast on ${label} when receiving submissions (POST)`, async () => {
        await expect(setup({ method: 'POST', parameters })).rejects.toThrow(NodeOperationError);
        await expect(setup({ method: 'POST', parameters })).rejects.toThrow(errorMatch);
      });
    }

    it('fails fast when no Fields are configured', async () => {
      await expect(
        setup({ method: 'GET', parameters: { fields: { field: [] } } }),
      ).rejects.toThrow(/at least one field/i);
      await expect(
        setup({ method: 'POST', parameters: { fields: { field: [] } } }),
      ).rejects.toThrow(/at least one field/i);
    });
  });

  describe('import config', () => {
    it('GET serves the imported document verbatim instead of compiling builder Fields', async () => {
      const { res } = await setup({ method: 'GET', parameters: { importConfig: nestedDoc } });

      expect(res.statusCode).toBe(200);
      const config = parseServedConfig(res.body);
      // Nested objects, UI rules, and Categorization options survive untouched.
      const schema = config.schema as Record<string, unknown>;
      expect(schema).toEqual(JSON.parse(nestedDoc).schema);
      expect(config.uiSchema).toEqual(JSON.parse(nestedDoc).uiSchema);
      // Built Fields are replaced, never merged.
      expect(res.body).not.toContain('#/properties/name');
    });

    it('GET explains the rejection instead of serving a broken or empty form', async () => {
      const { result, res } = await setup({ method: 'GET', parameters: { importConfig: reservedDoc } });

      expect(result?.noWebhookResponse).toBe(true);
      expect(res.statusCode).toBe(500);
      expect(res.headers['Content-Type']).toBe('text/html; charset=utf-8');
      expect(res.body).toContain('$.schema.properties.submittedAt');
      expect(res.body).not.toContain('id="jsonform-config"');
    });

    it('GET rejects unparseable documents with a clear error', async () => {
      const { res } = await setup({
        method: 'GET',
        parameters: { importConfig: '{definitely not json' },
      });

      expect(res.statusCode).toBe(500);
      expect(res.body).toContain('not valid JSON');
    });

    it('POST shapes submissions against the imported Form', async () => {
      const { result } = await setup({
        method: 'POST',
        body: { email: 'ada@example.com', plan: 'pro' },
        parameters: { importConfig: importedDoc },
      });

      const json = result?.workflowData?.[0]?.[0]?.json as Record<string, unknown>;
      expect(json.email).toBe('ada@example.com');
      expect(json.plan).toBe('pro');
      // The pasted schema is the contract: keys it permits pass through even
      // when they match nothing in the builder Fields.
      const withBuilderOnly = await setup({
        method: 'POST',
        body: { email: 'ada@example.com', plan: 'pro', name: 'Ada' },
        parameters: { importConfig: importedDoc },
      });
      const shaped = withBuilderOnly.result?.workflowData?.[0]?.[0]?.json as Record<string, unknown>;
      expect(shaped.name).toBe('Ada');
    });

    it('POST validates against the imported Form constraints', async () => {
      const { result, res } = await setup({
        method: 'POST',
        body: { plan: 'pro' },
        parameters: { importConfig: importedDoc },
      });

      expect(result?.workflowData).toBeUndefined();
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toMatch(/email/i);
    });

    it('POST refuses to run against an invalid imported document', async () => {
      const { result, res } = await setup({
        method: 'POST',
        body: {},
        parameters: { importConfig: reservedDoc },
      });

      expect(result?.workflowData).toBeUndefined();
      expect(result?.noWebhookResponse).toBe(true);
      expect(res.statusCode).toBe(500);
      expect(JSON.parse(res.body).error).toContain('$.schema.properties.submittedAt');
    });
  });

  describe('split import inputs (v2)', () => {
    it('GET serves a form compiled from both split inputs instead of the built Fields', async () => {
      const { res } = await setup({
        method: 'GET',
        typeVersion: 2,
        parameters: { schemaJson: importedSchemaJson, uiSchemaJson: importedUiSchemaJson },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('"Imported form"');
      expect(res.body).toContain('"required":["email"]');
      // Built Fields are replaced, never merged.
      expect(res.body).not.toContain('#/properties/name');
    });

    it('GET falls back to built Fields when both inputs are untouched', async () => {
      const { res } = await setup({ method: 'GET', typeVersion: 2 });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('#/properties/name');
    });

    it('GET rejects a lone Schema JSON by naming the missing UI half', async () => {
      const { res } = await setup({
        method: 'GET',
        typeVersion: 2,
        parameters: { schemaJson: importedSchemaJson },
      });

      expect(res.statusCode).toBe(500);
      expect(res.body).toContain('UI Schema JSON');
      expect(res.body).toContain('all-or-nothing');
    });

    it('GET rejects a lone UI Schema JSON by naming the missing Schema half', async () => {
      const { res } = await setup({
        method: 'GET',
        typeVersion: 2,
        parameters: { uiSchemaJson: importedUiSchemaJson },
      });

      expect(res.statusCode).toBe(500);
      expect(res.body).toContain('Schema JSON');
    });

    it('GET explains a Combined Document pasted into Schema JSON', async () => {
      const { res } = await setup({
        method: 'GET',
        typeVersion: 2,
        parameters: { schemaJson: importedDoc, uiSchemaJson: importedUiSchemaJson },
      });

      expect(res.statusCode).toBe(500);
      expect(res.body).toContain('combined');
      expect(res.body).toMatch(/inner &quot;schema&quot; object/);
    });

    it('GET prefixes rejection paths with their input', async () => {
      const reservedSchemaJson = JSON.stringify({
        type: 'object',
        properties: { submittedAt: { type: 'string' } },
      });
      const { res } = await setup({
        method: 'GET',
        typeVersion: 2,
        parameters: { schemaJson: reservedSchemaJson, uiSchemaJson: importedUiSchemaJson },
      });

      expect(res.statusCode).toBe(500);
      expect(res.body).toContain('Schema JSON: $.properties.submittedAt');
    });

    it('POST shapes submissions against the imported Form from split inputs', async () => {
      const { result } = await setup({
        method: 'POST',
        typeVersion: 2,
        body: { email: 'ada@example.com', plan: 'pro' },
        parameters: { schemaJson: importedSchemaJson, uiSchemaJson: importedUiSchemaJson },
      });

      const json = result?.workflowData?.[0]?.[0]?.json as Record<string, unknown>;
      expect(json.email).toBe('ada@example.com');
      expect(json.plan).toBe('pro');
    });

    it('POST refuses to run against an invalid imported document', async () => {
      const reservedSchemaJson = JSON.stringify({
        type: 'object',
        properties: { submittedAt: { type: 'string' } },
      });
      const { res } = await setup({
        method: 'POST',
        typeVersion: 2,
        body: {},
        parameters: { schemaJson: reservedSchemaJson, uiSchemaJson: importedUiSchemaJson },
      });

      expect(res.statusCode).toBe(500);
      expect(JSON.parse(res.body).error).toContain('Schema JSON: $.properties.submittedAt');
    });

    it('v1 nodes ignore v2 params and keep reading the legacy combined document', async () => {
      const { res } = await setup({
        method: 'GET',
        typeVersion: 1,
        parameters: { importConfig: importedDoc, schemaJson: '{bad json' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('"Imported form"');
    });

    it('serves the regression fixtures verbatim, Categorization stepper included', async () => {
      const schemaJson = readFileSync(path.join(process.cwd(), 'test', 'fixtures', 'schema.json'), 'utf8');
      const uiSchemaJson = readFileSync(path.join(process.cwd(), 'test', 'fixtures', 'ui-schema.json'), 'utf8');

      const { res } = await setup({
        method: 'GET',
        typeVersion: 2,
        parameters: { schemaJson, uiSchemaJson },
      });

      expect(res.statusCode).toBe(200);
      const config = parseServedConfig(res.body);
      expect(config.schema).toEqual(JSON.parse(schemaJson));
      expect(config.uiSchema).toEqual(JSON.parse(uiSchemaJson));

      const posted = await setup({
        method: 'POST',
        typeVersion: 2,
        body: {
          firstName: 'Ada',
          secondName: 'Lovelace',
          vegetarian: true,
          birthDate: '1990-12-10',
          nationality: 'DE',
          provideAddress: true,
          address: { street: 'Main Street', streetNumber: '1', city: 'Springfield', postalCode: '12345' },
          vegetarianOptions: { vegan: false, favoriteVegetable: 'Other', otherFavoriteVegetable: 'Okra' },
        },
        parameters: { schemaJson, uiSchemaJson },
      });
      const json = posted.result?.workflowData?.[0]?.[0]?.json as Record<string, unknown>;
      expect(json.submittedAt).toEqual(expect.any(String));
      expect(json.address).toEqual({
        street: 'Main Street',
        streetNumber: '1',
        city: 'Springfield',
        postalCode: '12345',
      });

      // The pasted schema's own constraints are enforced server-side.
      const invalid = await setup({
        method: 'POST',
        typeVersion: 2,
        body: {
          firstName: 'ab',
          secondName: 'Lovelace',
          vegetarian: true,
          birthDate: '1990-12-10',
          nationality: 'DE',
          provideAddress: true,
          address: { street: 'Main Street', streetNumber: '1', city: 'Springfield', postalCode: '12345' },
          vegetarianOptions: { vegan: false, favoriteVegetable: 'Other', otherFavoriteVegetable: 'Okra' },
        },
        parameters: { schemaJson, uiSchemaJson },
      });
      expect(invalid.res.statusCode).toBe(400);
      const parsed = JSON.parse(invalid.res.body) as { error: string; issues: Array<{ field: string }> };
      expect(parsed.error).toMatch(/firstName/i);
      expect(parsed.issues.some((issue) => issue.field === 'firstName')).toBe(true);
    });

    it('v2 nodes ignore the legacy importConfig param', async () => {
      const { res } = await setup({
        method: 'GET',
        typeVersion: 2,
        parameters: { importConfig: importedDoc },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('#/properties/name');
    });
  });

  describe('valid POST', () => {
    it('emits exactly one workflow item with flat field values plus submittedAt', async () => {
      const { result } = await setup({ method: 'POST', body: VALID_BODY });

      const items = result?.workflowData?.[0];
      expect(items).toHaveLength(1);

      const json = items?.[0]?.json as Record<string, unknown>;
      expect(json.submittedAt).toEqual(expect.any(String));
      expect(new Date(json.submittedAt as string).getTime()).not.toBeNaN();
      expect(json.name).toBe('Ada Lovelace');
      expect(json.email).toBe('ada@example.com');
      expect(json.role).toBe('Developer');
      expect(json.startDate).toBe('2026-09-01');
      expect(json.newsletter).toBe(true);
    });

    it('drops query parameters from the emitted item', async () => {
      const { result } = await setup({
        method: 'POST',
        body: VALID_BODY,
        query: { utm: 'campaign' },
      });
      const json = result?.workflowData?.[0]?.[0]?.json as Record<string, unknown>;

      expect(json.utm).toBeUndefined();
      expect(Object.keys(json)).toEqual([
        'submittedAt',
        'name',
        'email',
        'role',
        'startDate',
        'newsletter',
      ]);
    });

    it('drops unknown payload keys not defined by the built Form', async () => {
      const { result } = await setup({
        method: 'POST',
        body: { ...VALID_BODY, evilKey: '</script>', submittedAt: 'forged' },
      });
      const json = result?.workflowData?.[0]?.[0]?.json as Record<string, unknown>;

      expect(json.evilKey).toBeUndefined();
      expect(json.submittedAt).not.toBe('forged');
    });

    it('does not answer POST itself outside Respond-to-Webhook mode so n8n applies the response mode', async () => {
      for (const responseMode of ['onReceived', 'lastNode'] as const) {
        const { result, res } = await setup({
          method: 'POST',
          body: VALID_BODY,
          parameters: { responseMode },
        });

        expect(result?.noWebhookResponse).toBeFalsy();
        expect(result?.workflowData?.[0]).toHaveLength(1);
        expect(res.writeHeadCalls).toBe(0);
      }
    });

    it('leaves the response to the Respond to Webhook node in responseNode mode', async () => {
      const { result } = await setup({
        method: 'POST',
        body: VALID_BODY,
        parameters: { responseMode: 'responseNode' },
      });

      expect(result?.noWebhookResponse).toBe(true);
      expect(result?.workflowData?.[0]).toHaveLength(1);
    });
  });

  describe('invalid POST', () => {
    it.each([
      ['missing required fields', { name: 'Ada' }, /required/i],
      ['wrong-typed values', { name: 'Ada', email: 'x@example.com', newsletter: 'yes' }, /newsletter/i],
      ['unknown root shape', [], /JSON object/i],
      [
        'value outside choices',
        { name: 'Ada', email: 'x@example.com', role: 'Hacker' },
        /role/i,
      ],
    ])('%s gets a 400 JSON error and emits nothing', async (_label, body, errorMatch) => {
      const { result, res } = await setup({ method: 'POST', body });

      expect(result?.workflowData).toBeUndefined();
      expect(result?.noWebhookResponse).toBe(true);
      expect(res.statusCode).toBe(400);
      expect(res.headers['Content-Type']).toContain('application/json');

      const parsed = JSON.parse(res.body) as { error: string };
      expect(parsed.error).toMatch(errorMatch);
    });
  });

  it('rejects unexpected HTTP methods with a clear client error', async () => {
    const { result, res } = await setup({ method: 'DELETE' });

    expect(result?.noWebhookResponse).toBe(true);
    expect(res.statusCode).toBe(405);
  });
});
