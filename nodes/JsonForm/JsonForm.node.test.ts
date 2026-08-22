import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { sampleForm, sampleFormConfig } from './sampleForm';
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

describe('buildFormPageResponse', () => {
  it('responds with the page as HTML and the configuration blob injected', async () => {
    const { buildFormPageResponse } = await import('./formPage');
    const template =
      '<html><body><script type="application/json" id="jsonform-config">{}</script></body></html>';

    const response = buildFormPageResponse(sampleFormConfig, () => template);

    expect(response.statusCode).toBe(200);
    expect(response.contentType).toBe('text/html; charset=utf-8');
    expect(response.body).toContain('id="jsonform-config"');
    expect(response.body).toContain('"required":["name","email"]');
  });
});

describe('JsonForm node description', () => {
  it('exposes n8n\'s standard Response Mode options with When Last Node Finishes as default', () => {
    const description = new JsonForm().description;
    const responseMode = description.properties.find((property) => property.name === 'responseMode');
    if (!responseMode) throw new Error('responseMode property must exist');

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
    const postWebhook = new JsonForm().description.webhooks?.find(
      (webhook) => webhook.httpMethod === 'POST',
    );

    // Standard trigger mechanics: n8n core evaluates this registration
    // expression per request, so test and production URLs behave alike.
    expect(postWebhook?.responseMode).toBe('={{ $parameter["responseMode"] }}');
  });

  it('keeps GET registered as onReceived because the page is answered directly', () => {
    const getWebhook = new JsonForm().description.webhooks?.find(
      (webhook) => webhook.httpMethod === 'GET',
    );

    expect(getWebhook?.responseMode).toBe('onReceived');
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
  }

  async function setup({ method, body = {}, parameters = {} }: SetupOptions) {
    const node = new JsonForm();
    const res = fakeRes();
    const context = {
      getRequestObject: vi.fn(() => ({ method })),
      getResponseObject: vi.fn(() => res),
      getBodyData: vi.fn(() => body),
      getNodeParameter: vi.fn((name: string, fallback?: unknown) =>
        name in parameters ? parameters[name] : fallback,
      ),
    };

    const result = await node.webhook.call(context as never);
    return { result, res };
  }

  it('GET serves the form page as text/html with the configuration and completion message injected', async () => {
    const { result, res } = await setup({
      method: 'GET',
      parameters: { completionMessage: 'Custom thanks!' },
    });

    expect(result?.noWebhookResponse).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('text/html; charset=utf-8');
    expect(res.body).toContain('<title>Form</title>');
    expect(res.body).toContain('"required":["name","email"]');
    expect(res.body).toContain('"completionMessage":"Custom thanks!"');
  });

  describe('valid POST', () => {
    const validBody = {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      role: 'Developer',
      startDate: '2026-09-01',
      newsletter: true,
    };

    it('emits exactly one workflow item with flat field values plus submittedAt', async () => {
      const { result } = await setup({ method: 'POST', body: validBody });

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
      const { result } = await setup({ method: 'POST', body: validBody });
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

    it('drops unknown payload keys not defined by the Form', async () => {
      const { result } = await setup({
        method: 'POST',
        body: { ...validBody, evilKey: '</script>', submittedAt: 'forged' },
      });
      const json = result?.workflowData?.[0]?.[0]?.json as Record<string, unknown>;

      expect(json.evilKey).toBeUndefined();
      expect(json.submittedAt).not.toBe('forged');
    });

    it('does not answer POST itself outside Respond-to-Webhook mode so n8n applies the response mode', async () => {
      for (const responseMode of ['onReceived', 'lastNode'] as const) {
        const { result, res } = await setup({
          method: 'POST',
          body: validBody,
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
        body: validBody,
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
