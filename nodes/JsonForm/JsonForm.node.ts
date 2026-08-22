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

import {
  compileForm,
  shapeSubmission,
  SubmissionShapeError,
} from '../../src/form-definition';
import type { CompiledForm, Form, Submission } from '../../src/form-definition';

import { buildFormFromParameters, FIELD_TYPE_OPTIONS } from './formBuilder';
import { buildFormPageResponse, loadFormTemplate } from './formPage';

export const DEFAULT_COMPLETION_MESSAGE = 'Thank you! Your submission has been received.';

/** Default value of the editable Fields collection: an empty form. */
export const DEFAULT_FIELDS_VALUE = { field: [] };

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
      options: FIELD_TYPE_OPTIONS.map(({ name, value, description }) => ({
        name,
        value,
        description,
      })),
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
 * The served form is generated from the Fields built in the node UI through
 * the Form Definition module (compile on GET). POST is validated server-side
 * against the same built Form (defense in depth), shaped into one flat
 * trigger item, and emitted for n8n core to answer per the selected Response
 * Mode. An invalid Field configuration fails fast with a node error naming
 * the offending field and rule.
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

    let config: CompiledForm;
    try {
      config = compileForm(builtForm(context));
    } catch (error) {
      throw toConfigError(context, error);
    }

    const page = buildFormPageResponse({ ...config, completionMessage }, loadTemplate);
    res.writeHead(page.statusCode, { 'Content-Type': page.contentType });
    res.end(page.body);
    return { noWebhookResponse: true };
  }

  if (method === 'POST') {
    let submission: Submission;
    try {
      submission = shapeSubmission(builtForm(context), context.getBodyData());
    } catch (error) {
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

/** Build the Form configured in the node UI's Fields collection. */
function builtForm(context: IWebhookFunctions): Form {
  return buildFormFromParameters({
    formTitle: context.getNodeParameter('formTitle', ''),
    formDescription: context.getNodeParameter('formDescription', ''),
    fields: context.getNodeParameter('fields', DEFAULT_FIELDS_VALUE),
  });
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
