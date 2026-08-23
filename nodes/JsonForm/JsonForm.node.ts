import type {
  IDataObject,
  INodeExecutionData,
  INodeProperties,
  INodeType,
  INodeTypeDescription,
  IWebhookFunctions,
  IWebhookResponseData,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { compileForm, shapeDocumentSubmission, shapeSubmission, SubmissionShapeError } from '../../src/form-definition';
import type { Form, Submission } from '../../src/form-definition';

import {
  buildFormFromParameters,
  FIELD_TYPE_OPTIONS,
} from './formBuilder';
import { buildFormPageResponse, buildErrorResponse, loadFormTemplate } from './formPage';
import {
  ConfigImportError,
  resolveEffectiveForm,
  resolveLegacyImportedForm,
} from './effectiveForm';
import type { EffectiveForm } from './effectiveForm';
import { validateWebhookAuthentication, WebhookAuthorizationError } from './authentication';

export const DEFAULT_COMPLETION_MESSAGE = 'Thank you! Your submission has been received.';

/** Default value of the editable Fields collection: an empty form. */
export const DEFAULT_FIELDS_VALUE = { field: [] };

/** Stand-in handed to the effective-form seam when an import replaces builder Fields wholesale. */
const EMPTY_BUILDER_FORM: Form = { fields: [] };

/** First version speaking the split Schema JSON / UI Schema JSON contract. */
const SPLIT_IMPORT_VERSION = 2;

const NAME_RULES_HINT =
  'Identifier used as the workflow key for this field. Must match ^[A-Za-z_][A-Za-z0-9_]*$, be unique within the form, and cannot be the reserved name "submittedAt".';

/**
 * Entry values for the Fields collection. Constraints are shown
 * conditionally by field type; optional numeric constraints default to an
 * empty value so an untouched input never produces a hidden bound.
 */
function fieldEntryValues(): INodeProperties[] {
  return [
    {
      displayName: 'Name',
      name: 'name',
      type: 'string',
      required: true,
      default: '',
      placeholder: 'e.g. first_name',
      hint: NAME_RULES_HINT,
      description: 'Becomes the key of this field in the workflow item.',
    },
    {
      displayName: 'Label',
      name: 'label',
      type: 'string',
      required: true,
      default: '',
      description: 'Text shown next to the input on the served page.',
    },
    {
      displayName: 'Type',
      name: 'type',
      type: 'options',
      default: 'text',
      options: FIELD_TYPE_OPTIONS,
      description: 'Kind of input shown to the visitor.',
    },
    {
      displayName: 'Required',
      name: 'required',
      type: 'boolean',
      default: false,
      description: 'Whether the field must be filled in before submitting.',
    },
    {
      displayName: 'Max Length',
      name: 'maxLength',
      type: 'number',
      default: '',
      description:
        'Maximum number of characters accepted. Leave empty for no limit.',
      displayOptions: { show: { type: ['text', 'textarea'] } },
    },
    {
      displayName: 'Min Length',
      name: 'minLength',
      type: 'number',
      default: '',
      description:
        'Minimum number of characters required. Leave empty for no minimum.',
      displayOptions: { show: { type: ['text', 'textarea'] } },
    },
    {
      displayName: 'Visible When Field',
      name: 'visibleWhenField',
      type: 'string',
      default: '',
      description:
        'Name of another field in this form. When set, this field is shown only while that field equals the comparison value. Leave empty to always show this field.',
    },
    {
      displayName: 'Visible When Value',
      name: 'visibleWhenValue',
      type: 'string',
      default: '',
      placeholder: 'e.g. true, Other, 3',
      description:
        'Value the Visible When Field must equal for this field to be shown. "true" and "false" compare as booleans; numeric text compares as a number.',
    },
    {
      displayName: 'Minimum',
      name: 'min',
      type: 'number',
      default: '',
      description: 'Inclusive lower bound. Leave empty for no bound.',
      displayOptions: { show: { type: ['number'] } },
    },
    {
      displayName: 'Maximum',
      name: 'max',
      type: 'number',
      default: '',
      description: 'Inclusive upper bound. Leave empty for no bound.',
      displayOptions: { show: { type: ['number'] } },
    },
    {
      displayName: 'Minimum Date',
      name: 'minDate',
      type: 'string',
      default: '',
      placeholder: 'YYYY-MM-DD',
      description: 'Inclusive lower bound as an ISO date. Leave empty for no bound.',
      displayOptions: { show: { type: ['date'] } },
    },
    {
      displayName: 'Maximum Date',
      name: 'maxDate',
      type: 'string',
      default: '',
      placeholder: 'YYYY-MM-DD',
      description: 'Inclusive upper bound as an ISO date. Leave empty for no bound.',
      displayOptions: { show: { type: ['date'] } },
    },
    {
      displayName: 'Choices',
      name: 'choices',
      type: 'multiOptions',
      default: [],
      description: 'Values the visitor can choose from.',
      displayOptions: { show: { type: ['select', 'multiselect'] } },
    },
  ];
}

/**
 * The node-UI form builder: authors add, edit, reorder, and remove Fields
 * directly in this editable collection parameter.
 */
export const FIELDS_PROPERTY: INodeProperties = {
  displayName: 'Fields',
  name: 'fields',
  type: 'fixedCollection',
  default: DEFAULT_FIELDS_VALUE,
  placeholder: 'Add Field',
  typeOptions: {
    multipleValues: true,
    sortButtonEnabled: true,
    collectionName: 'field',
  },
  options: [
    {
      displayName: 'Field',
      name: 'field',
      values: fieldEntryValues(),
    },
  ],
};

/**
 * Serve the JSON Form page on webhook GET and receive its submissions on POST.
 *
 * Optional Basic Auth / Header Auth credentials gate every request (standard
 * n8n webhook authentication; `none` keeps the form anonymous). The served
 * Form comes from the Fields built in the node UI through the Form Definition
 * module (compile on GET); a filled import — the split Schema JSON / UI
 * Schema JSON inputs on v2 nodes, the legacy combined Import Config on v1
 * nodes — replaces those builder Fields wholesale. POST is validated
 * server-side against the same Form (defense in depth), shaped into one flat
 * trigger item, and emitted for n8n core to answer per the selected Response
 * Mode. An invalid Field configuration fails fast with a node error naming
 * the offending field and rule; an invalid imported document is explained
 * instead of served.
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
      // Builder Fields are compiled into schema + uiSchema; a filled import
      // is served verbatim instead (it is never merged).
      const resolvedRequest = resolveRequestForm(context);
      const documents =
        resolvedRequest.kind === 'imported'
          ? resolvedRequest.documents
          : compileForm(resolvedRequest.form);
      const pageConfig = {
        ...documents,
        completionMessage,
        // Only include Accent Color when set so the served blob stays
        // byte-identical to before for stock-themed forms.
        ...(accentColor ? { accentColor } : {}),
      };
      const page = buildFormPageResponse(pageConfig, loadTemplate);
      res.writeHead(page.statusCode, { 'Content-Type': page.contentType });
      res.end(page.body);
    } catch (error) {
      if (error instanceof ConfigImportError) {
        const errorPage = buildErrorResponse(
          'Invalid form configuration',
          `The imported form document was rejected:\n\n${error.message}`,
        );
        res.writeHead(errorPage.statusCode, { 'Content-Type': errorPage.contentType });
        res.end(errorPage.body);
        return { noWebhookResponse: true };
      }
      throw toConfigError(context, error);
    }
    return { noWebhookResponse: true };
  }

  if (method === 'POST') {
    let submission: Submission;
    try {
      // Builder Forms are shaped field-by-field; imported schemas are
      // validated with Ajv against the pasted document (defense in depth).
      const resolvedRequest = resolveRequestForm(context);
      submission =
        resolvedRequest.kind === 'builder'
          ? shapeSubmission(resolvedRequest.form, context.getBodyData())
          : shapeDocumentSubmission(resolvedRequest.documents.schema, context.getBodyData());
    } catch (error) {
      if (error instanceof ConfigImportError) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
        return { noWebhookResponse: true };
      }
      if (error instanceof SubmissionShapeError) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message, issues: error.issues }));
        return { noWebhookResponse: true };
      }
      throw toConfigError(context, error);
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

/**
 * The Form this request serves or validates against, resolved per node
 * version: v1 nodes read the legacy combined Import Config; v2 nodes speak
 * the split Schema JSON / UI Schema JSON inputs. A filled import replaces
 * builder Fields wholesale (never merged) and is answered even when the
 * builder is untouched; otherwise the Fields built in the node UI are
 * required.
 */
function resolveRequestForm(context: IWebhookFunctions): EffectiveForm {
  if (nodeTypeVersion(context) < SPLIT_IMPORT_VERSION) {
    const importConfig = context.getNodeParameter('importConfig', '');
    if (typeof importConfig === 'string' && importConfig.trim() !== '') {
      return resolveLegacyImportedForm(importConfig);
    }
    return { kind: 'builder', form: builtForm(context) };
  }

  const schemaJson = context.getNodeParameter('schemaJson', '');
  const uiSchemaJson = context.getNodeParameter('uiSchemaJson', '');
  const hasSchema = typeof schemaJson === 'string' && (schemaJson as string).trim() !== '';
  const hasUiSchema =
    typeof uiSchemaJson === 'string' && (uiSchemaJson as string).trim() !== '';
  if (!hasSchema && !hasUiSchema) return { kind: 'builder', form: builtForm(context) };
  // resolveEffectiveForm enforces the all-or-nothing rule for half-filled imports.
  return resolveEffectiveForm(EMPTY_BUILDER_FORM, schemaJson, uiSchemaJson);
}

/** The version this stored node instance was added to the workflow at. */
function nodeTypeVersion(context: IWebhookFunctions): number {
  const version = context.getNode()?.typeVersion;
  return typeof version === 'number' ? version : SPLIT_IMPORT_VERSION;
}

/** Build the Form configured in the node UI's Fields collection. */
function builtForm(context: IWebhookFunctions): Form {
  const form = buildFormFromParameters({
    formTitle: context.getNodeParameter('formTitle', ''),
    formDescription: context.getNodeParameter('formDescription', ''),
    fields: context.getNodeParameter('fields', DEFAULT_FIELDS_VALUE),
  });
  if (form.fields.length === 0) {
    throw new NodeOperationError(
      context.getNode(),
      'No Fields configured. Add at least one Field to the Fields collection so the form has something to ask.',
    );
  }
  return form;
}

/**
 * Surface invalid Field configurations (name rules, constraint sanity) as
 * node errors so they show up on the node while authoring — before any page
 * is served or submission accepted.
 */
function toConfigError(context: IWebhookFunctions, error: unknown): unknown {
  if (error instanceof NodeOperationError) return error;
  if (error instanceof Error) {
    return new NodeOperationError(context.getNode(), error.message);
  }
  return error;
}

export class JsonForm implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'JSON Form',
    name: 'jsonForm',
    icon: 'file:jsonform.svg',
    group: ['trigger'],
    version: [1, 2],
    defaultVersion: 2,
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
        // Serve at exactly the configured Path; without this n8n prepends the
        // node's internal webhookId to the registered production path.
        isFullPath: true,
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
        isFullPath: true,
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
      FIELDS_PROPERTY,
      {
        displayName: 'Title',
        name: 'formTitle',
        type: 'string',
        default: '',
        placeholder: 'e.g. Contact us',
        description: 'Optional heading shown at the top of the served page.',
      },
      {
        displayName: 'Description',
        name: 'formDescription',
        type: 'string',
        default: '',
        typeOptions: { rows: 2 },
        description: 'Optional text shown under the title on the served page.',
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
        displayOptions: { show: { '@version': [1] } },
        description:
          'Optional pasted { schema, uiSchema } document. When set, it is served verbatim and replaces the fields defined in the builder. Structurally unsound documents are rejected with exact paths.',
      },
      {
        displayName: 'Schema JSON',
        name: 'schemaJson',
        type: 'json',
        default: '',
        displayOptions: { show: { '@version': [2] } },
        description:
          'Paste a JSON Schema object describing the form properties — served as authored, so any construct JSONForms understands (nested objects, constraints, conditionals) works. Import happens only when UI Schema JSON is filled too — exactly one of the two is an error. A pasted combined { schema, uiSchema } document is rejected: paste only its inner "schema" object here.',
      },
      {
        displayName: 'UI Schema JSON',
        name: 'uiSchemaJson',
        type: 'json',
        default: '',
        displayOptions: { show: { '@version': [2] } },
        description:
          'Paste a JSONForms UI Schema describing the presentation for the Schema JSON properties — layouts, rules, and options are served as authored. Required alongside Schema JSON; when both are filled they replace the fields defined in the builder.',
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
