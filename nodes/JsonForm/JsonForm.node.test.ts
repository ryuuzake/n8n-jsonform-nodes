import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { NodeOperationError } from 'n8n-workflow';

import { JsonForm } from './JsonForm.node';

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

  it('exposes n8n\'s standard Response Mode options with When Last Node Finishes as default', () => {
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
    expect(showFor(entryProperty('min'))).toEqual(['number']);
    expect(showFor(entryProperty('max'))).toEqual(['number']);
    expect(showFor(entryProperty('minDate'))).toEqual(['date']);
    expect(showFor(entryProperty('maxDate'))).toEqual(['date']);
    expect(showFor(entryProperty('choices'))).toEqual(['select', 'multiselect']);
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
  }

  async function setup({ method, body = {}, parameters = {}, query }: SetupOptions) {
    const node = new JsonForm();
    const res = fakeRes();
    const context = {
      getRequestObject: vi.fn(() => ({ method, query })),
      getResponseObject: vi.fn(() => res),
      getBodyData: vi.fn(() => body),
      getNodeParameter: vi.fn((name: string, fallback?: unknown) =>
        name in parameters ? parameters[name] : fallback,
      ),
      getNode: vi.fn(() => ({ name: 'JSON Form', typeVersion: 1, type: 'n8n-nodes-jsonform.jsonForm' })),
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
    const parameters = { fields: BUILT_FIELDS };

    const rendered = await setup({ method: 'GET', parameters });
    const served = parseServedConfig(rendered.res.body);
    const schema = served.schema as { required?: string[] };
    expect(schema.required).toEqual(['name', 'email']);

    const posted = await setup({
      method: 'POST',
      body: { ...VALID_BODY, utm: 'ignored' },
      parameters,
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
      await expect(setup({ method: 'GET', parameters: {} })).rejects.toThrow(/at least one field/i);
      await expect(setup({ method: 'POST', parameters: { fields: { field: [] } } })).rejects.toThrow(
        /at least one field/i,
      );
    });

    it('emits nothing when the built Form is invalid', async () => {
      const { result } = await setup({
        method: 'POST',
        parameters: {
          fields: { field: [{ name: 'bad name', label: 'Bad', type: 'text' }] },
        },
      }).catch((error: unknown) => {
        expect(error).toBeInstanceOf(NodeOperationError);
        return { result: undefined, res: fakeRes() };
      });

      expect(result).toBeUndefined();
    });
  });

  describe('valid POST', () => {
    it('emits exactly one workflow item with flat field values plus submittedAt', async () => {
      const { result } = await setup({
        method: 'POST',
        body: VALID_BODY,
        parameters: { fields: BUILT_FIELDS },
      });

      const json = result?.workflowData?.[0]?.[0]?.json as Record<string, unknown>;
      expect(json.submittedAt).toEqual(expect.any(String));
      expect(json.name).toBe('Ada Lovelace');
      expect(json.email).toBe('ada@example.com');
      expect(json.startDate).toBe('2026-09-01');
    });

    it('drops query parameters from the emitted item', async () => {
      const { result } = await setup({
        method: 'POST',
        body: VALID_BODY,
        query: { utm: 'campaign' },
        parameters: { fields: BUILT_FIELDS },
      });
      const json = result?.workflowData?.[0]?.[0]?.json as Record<string, unknown>;

      expect(json.utm).toBeUndefined();
    });

    it('drops unknown payload keys not defined by the built Form', async () => {
      const { result } = await setup({
        method: 'POST',
        body: { ...VALID_BODY, evilKey: '</script>', submittedAt: 'forged' },
        parameters: { fields: BUILT_FIELDS },
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
          parameters: { responseMode, fields: BUILT_FIELDS },
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
        parameters: { responseMode: 'responseNode', fields: BUILT_FIELDS },
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
      const { result, res } = await setup({
        method: 'POST',
        body,
        parameters: { fields: BUILT_FIELDS },
      });

      expect(result?.workflowData).toBeUndefined();
      expect(result?.noWebhookResponse).toBe(true);
      expect(res.statusCode).toBe(400);
      expect(res.headers['Content-Type']).toContain('application/json');

      const parsed = JSON.parse(res.body) as { error: string };
      expect(parsed.error).toMatch(errorMatch);
    });
  });

  it('rejects unexpected HTTP methods with a clear client error', async () => {
    const { result, res } = await setup({ method: 'DELETE', parameters: { fields: BUILT_FIELDS } });

    expect(result?.noWebhookResponse).toBe(true);
    expect(res.statusCode).toBe(405);
  });
});
