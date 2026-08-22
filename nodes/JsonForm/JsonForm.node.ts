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
import { validateWebhookAuthentication, WebhookAuthorizationError } from './authentication';

export const DEFAULT_COMPLETION_MESSAGE = 'Thank you! Your submission has been received.';

/**
 * Serve the JSON Form page on webhook GET and receive its submissions on POST.
 *
 * Optional Basic Auth / Header Auth credentials gate every request (standard
 * n8n webhook authentication; `none` keeps the form anonymous). A non-empty
 * Import Config parameter is transpiled into Fields and replaces the
 * builder-defined Fields at resolution time. POST is validated server-side
 * with the same Form Definition seam that compiled the served page (defense
 * in depth), shaped into one flat trigger item, and emitted for n8n core to
 * answer per the selected Response Mode.
 */
export async function handleJsonFormWebhook(
  context: IWebhookFunctions,
  loadTemplate: () => string = loadFormTemplate,
): Promise<IWebhookResponseData> {
  const req = context.getRequestObject();
  const res = context.getResponseObject();
  const method = req.method ?? 'GET';

  // Standard n8n webhook authorization: the selected credentials gate every
  // request (page serving and submissions alike) before anything runs, so an
  // unauthorized caller gets a 401 challenge instead of a workflow execution.
  // Like n8n's own FormTrigger, every authorization failure — including a
  // misconfigured credential — answers a uniform 401 so callers cannot probe
  // how the node is set up. The Basic challenge header is only sent when
  // Basic Auth actually protects the form.
  try {
    await validateWebhookAuthentication(context);
  } catch (error) {
    if (!(error instanceof WebhookAuthorizationError)) throw error;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if ((context.getNodeParameter('authentication', 'none') as string) === 'basicAuth') {
      headers['WWW-Authenticate'] = 'Basic realm="Enter credentials"';
    }
    res.writeHead(401, headers);
    res.end(JSON.stringify({ error: error.message }));
    return { noWebhookResponse: true };
  }

  if (method === 'GET') {
    const completionMessage = context.getNodeParameter(
      'completionMessage',
      DEFAULT_COMPLETION_MESSAGE,
    ) as string;
    const accentParameter = context.getNodeParameter('accentColor', '');
    const accentColor = typeof accentParameter === 'string' ? accentParameter.trim() : '';

    try {
      // Transpile → effective Field list → compiled page config. An imported
      // document replaces builder Fields wholesale; it is never merged.
      const form = resolveEffectiveForm(context.getNodeParameter('importConfig', ''));
      const pageConfig = {
        ...compileForm(form),
        completionMessage,
        // Only include Accent Color when set so the served blob stays
        // byte-identical to before for stock-themed forms.
        ...(accentColor ? { accentColor } : {}),
      };
      const page = buildFormPageResponse(pageConfig, loadTemplate);
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
    credentials: [
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
    ],
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
        displayName: 'Authentication',
        name: 'authentication',
        type: 'options',
        options: [
          {
            name: 'Basic Auth',
            value: 'basicAuth',
            description: 'Callers must present the user/password of a Basic Auth credential.',
          },
          {
            name: 'Header Auth',
            value: 'headerAuth',
            description:
              'Callers must send the header name/value pair stored in a Header Auth credential.',
          },
          {
            name: 'None',
            value: 'none',
            description: 'Anyone with the URL can open the form and submit it anonymously.',
          },
        ],
        default: 'none',
        description: 'Whether opening the page and submitting the form require authentication.',
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
      {
        displayName: 'Accent Color',
        name: 'accentColor',
        type: 'color',
        default: '',
        description:
          'Recolors the form primary theme color (buttons, focus rings). Leave empty for the stock shadcn theme.',
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
