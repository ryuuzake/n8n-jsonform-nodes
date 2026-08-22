import { afterAll, describe, expect, it, vi } from 'vitest';

import { sampleFormConfig } from './sampleForm';
import { JsonForm } from './JsonForm.node';

type FakeRes = {
  statusCode?: number;
  headers: Record<string, string>;
  body: string;
  writeHead: (status: number, headers: Record<string, string>) => void;
  end: (body: string) => void;
};

function fakeRes(): FakeRes {
  const res: FakeRes = {
    headers: {},
    body: '',
    writeHead(status, headers) {
      res.statusCode = status;
      Object.assign(res.headers, headers);
    },
    end(body) {
      res.body = body;
    },
  };
  return res;
}

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

describe('JsonForm webhook', () => {
  const realLoadPageTemplate = JsonForm.loadPageTemplate;
  afterAll(() => {
    JsonForm.loadPageTemplate = realLoadPageTemplate;
  });

  async function setup(method: string) {
    const node = new JsonForm();
    const template =
      '<html><title>Form</title><script type="application/json" id="jsonform-config">{}</script></html>';
    (node.constructor as unknown as { loadPageTemplate: () => string }).loadPageTemplate = () =>
      template;


    const res = fakeRes();
    const context = {
      getRequestObject: vi.fn(() => ({ method })),
      getResponseObject: vi.fn(() => res),
      getNodeParameter: vi.fn(),
    };

    const result = await node.webhook.call(context as never);
    return { result, res };
  }

  it('GET serves the form page as text/html and answers the request directly', async () => {
    const { result, res } = await setup('GET');

    expect(result?.noWebhookResponse).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('text/html; charset=utf-8');
    expect(res.body).toContain('<title>Form</title>');
    expect(res.body).toContain('"required":["name","email"]');
  });

  it('POST rejects submissions until the submission loop is implemented', async () => {
    const { result, res } = await setup('POST');

    expect(result?.noWebhookResponse).toBe(true);
    expect(res.statusCode).toBe(501);
    expect(JSON.parse(res.body)).toEqual(
      expect.objectContaining({ error: expect.stringMatching(/not implemented yet/i) }),
    );
  });

  it('rejects unexpected HTTP methods with a clear client error', async () => {
    const { result, res } = await setup('DELETE');

    expect(result?.noWebhookResponse).toBe(true);
    expect(res.statusCode).toBe(405);
  });
});
