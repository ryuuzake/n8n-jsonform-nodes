import type {
  IDataObject,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  IWebhookFunctions,
  IWebhookResponseData,
} from 'n8n-workflow';

import { compileForm, shapeSubmission, SubmissionShapeError } from '../../src/form-definition';
import type { Submission } from '../../src/form-definition';

import { buildFormPageResponse, buildErrorResponse, loadFormTemplate } from './formPage';
import { ConfigImportError, resolveEffectiveForm } from './effectiveForm';

export const DEFAULT_COMPLETION_MESSAGE = 'Thank you! Your submission has been received.';

/**
 * Serve the JSON Form page on webhook GET and receive its submissions on POST.
 *
 * A non-empty Import Config parameter is transpiled into Fields and replaces
 * the builder-defined Fields at resolution time. POST is validated
 * server-side with the same Form Definition seam that compiled the served
 * page (defense in depth), shaped into one flat trigger item, and emitted for
 * n8n core to answer per the selected Response Mode.
 */
export async function handleJsonFormWebhook(
  context: IWebhookFunctions,
  loadTemplate: () => string = loadFormTemplate,
): Promise<IWebhookResponseData> {
  const req = context.getRequestObject();
  const res = context.getResponseObject();
  const method = req.method ?? 'GET';

  if (method === 'GET') {
    const completionMessage = context.getNodeParameter(
      'completionMessage',
      DEFAULT_COMPLETION_MESSAGE,
    ) as string;
    try {
      // Transpile → effective Field list → compiled page config. An imported
      // document replaces builder Fields wholesale; it is never merged.
      const form = resolveEffectiveForm(context.getNodeParameter('importConfig', ''));
      const page = buildFormPageResponse(
        { ...compileForm(form), completionMessage },
        loadTemplate,
      );
      res.writeHead(page.statusCode, { 'Content-Type': page.contentType });
      res.end(page.body);
    } catch (error) {
      if (!(error instanceof ConfigImportError)) throw error;
      const errorPage = buildErrorResponse(
        'Invalid form configuration',
        `The imported form document was rejected:\n\n${error.message}`,
      );
      res.writeHead(errorPage.statusCode, { 'Content-Type': errorPage.contentType });
      res.end(errorPage.body);
    }
    return { noWebhookResponse: true };
  }

  if (method === 'POST') {
    let submission: Submission;
    try {
      const form = resolveEffectiveForm(context.getNodeParameter('importConfig', ''));
      submission = shapeSubmission(form, context.getBodyData());
    } catch (error) {
      if (error instanceof ConfigImportError) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
        return { noWebhookResponse: true };
      }
      if (!(error instanceof SubmissionShapeError)) throw error;
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message, issues: error.issues }));
      return { noWebhookResponse: true };
    }

    const items: INodeExecutionData[] = [
      { json: submission as unknown as IDataObject },
    ];

    // "Respond to Webhook" owns the HTTP response; in every other mode n8n
    // core answers per the webhook registration's resolved response mode
    // (immediately for On Received, at execution end for When Last Node
    // Finishes). Query parameters are never part of the emitted item.
    if (context.getNodeParameter('responseMode', 'lastNode') === 'responseNode') {
      return { workflowData: [items], noWebhookResponse: true };
    }
    return { workflowData: [items] };
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
        // Resolved at request time from the node's Response Mode parameter so
        // n8n core applies standard trigger mechanics (test and production
        // URLs alike).
        responseMode: '={{ $parameter["responseMode"] }}',
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
      {
        displayName: 'Response Mode',
        name: 'responseMode',
        type: 'options',
        options: [
          {
            name: 'On Received',
            value: 'onReceived',
            description: 'Responds as soon as this node runs',
          },
          {
            name: 'When Last Node Finishes',
            value: 'lastNode',
            description: 'Returns data when the execution of the workflow finishes',
          },
          {
            name: 'Respond to Webhook',
            value: 'responseNode',
            description: 'Response is handled by a Respond to Webhook node',
          },
        ],
        default: 'lastNode',
        description: 'When to respond to the form submission.',
      },
      {
        displayName: 'Import Config',
        name: 'importConfig',
        type: 'json',
        default: '',
        description:
          'Optional pasted { schema, uiSchema } document. When set, it is transpiled into Fields and replaces the fields defined in the builder. Constructs outside the supported subset are rejected with exact paths.',
      },
      {
        displayName: 'Completion Message',
        name: 'completionMessage',
        type: 'string',
        default: DEFAULT_COMPLETION_MESSAGE,
        description: 'Shown on the page after a submission was received successfully.',
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
