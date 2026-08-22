import type {
  INodeType,
  INodeTypeDescription,
  IWebhookFunctions,
  IWebhookResponseData,
} from 'n8n-workflow';

import { buildFormPageResponse, loadFormTemplate } from './formPage';
import { sampleFormConfig } from './sampleForm';

/**
 * Serve the JSON Form page on webhook GET.
 *
 * POST submissions are intentionally rejected until the submission loop slice
 * (validate payload, emit trigger item, Completion Message) is implemented.
 */
export async function handleJsonFormWebhook(
  context: IWebhookFunctions,
  loadTemplate: () => string = loadFormTemplate,
): Promise<IWebhookResponseData> {
  const req = context.getRequestObject();
  const res = context.getResponseObject();
  const method = req.method ?? 'GET';

  if (method === 'GET') {
    const page = buildFormPageResponse(sampleFormConfig, loadTemplate);
    res.writeHead(page.statusCode, { 'Content-Type': page.contentType });
    res.end(page.body);
    return { noWebhookResponse: true };
  }

  if (method === 'POST') {
    res.writeHead(501, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Submissions are not implemented yet.' }));
    return { noWebhookResponse: true };
  }

  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: `Method ${method} is not allowed.` }));
  return { noWebhookResponse: true };
}

export class JsonForm implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'JSON Form',
    name: 'jsonForm',
    icon: 'file:jsonform.svg',
    group: ['trigger'],
    version: 1,
    description:
      'Serves a JSONForms-based form rendered with shadcn/ui on a webhook path and receives its submissions.',
    defaults: {
      name: 'JSON Form',
    },
    inputs: [],
    outputs: ['main'],
    webhooks: [
      {
        name: 'default',
        httpMethod: 'GET',
        responseMode: 'onReceived',
        path: '={{ $parameter["path"] }}',
        ndvHideMethod: true,
      },
      {
        name: 'default',
        httpMethod: 'POST',
        responseMode: 'onReceived',
        path: '={{ $parameter["path"] }}',
        ndvHideMethod: true,
      },
    ],
    properties: [
      {
        displayName: 'Path',
        name: 'path',
        type: 'string',
        required: true,
        default: 'json-form',
        description: 'The webhook path that serves the form and receives its submissions.',
      },
    ],
  };

  /** Seam overridable in tests to avoid reading the built artifact from disk. */
  static loadPageTemplate(): string {
    return loadFormTemplate();
  }

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    return handleJsonFormWebhook(this, JsonForm.loadPageTemplate);
  }
}
