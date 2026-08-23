import {
  parseImportDocument,
  parseInputDocument,
  transpileConfig,
  transpileForm,
  ConfigImportError,
  SCHEMA_SOURCE,
  UI_SCHEMA_SOURCE,
} from '../../src/form-import';
import type { ConfigImportIssue, ImportSource } from '../../src/form-import';
import type { Form } from '../../src/form-definition';

/**
 * Resolve the Form a request must serve or validate against (v2 nodes).
 *
 * Import is all-or-nothing: when both Schema JSON and UI Schema JSON are
 * filled they are transpiled into Fields and replace the builder-authored
 * Fields wholesale — JSON Schema is an interchange format, never a second
 * storage model. Exactly one filled input is an error naming the missing
 * half; both empty falls back to the Form built in the node's Fields
 * collection. Import problems surface as ConfigImportError with exact paths;
 * callers decide how to present them.
 */
export function resolveEffectiveForm(
  builderForm: Readonly<Form>,
  rawSchemaJson?: unknown,
  rawUiSchemaJson?: unknown,
): Form {
  const schemaFilled = inputFilled(rawSchemaJson);
  const uiSchemaFilled = inputFilled(rawUiSchemaJson);
  if (!schemaFilled && !uiSchemaFilled) return structuredCopyForm(builderForm);

  const missingHalfIssues: ConfigImportIssue[] = [];
  if (!schemaFilled) {
    missingHalfIssues.push({
      path: `${SCHEMA_SOURCE}: $`,
      reason:
        '"Schema JSON" must be filled in whenever "UI Schema JSON" is — import is all-or-nothing.',
    });
  }
  if (!uiSchemaFilled) {
    missingHalfIssues.push({
      path: `${UI_SCHEMA_SOURCE}: $`,
      reason:
        '"UI Schema JSON" must be filled in whenever "Schema JSON" is — import is all-or-nothing.',
    });
  }
  if (missingHalfIssues.length > 0) throw new ConfigImportError(missingHalfIssues);

  // Both halves are present: collect every problem across both inputs into
  // one report instead of failing on the first parse error.
  const parseIssues: ConfigImportIssue[] = [];
  let schemaDocument: unknown;
  let uiSchemaDocument: unknown;
  try {
    schemaDocument = parseInputDocument(inputText(rawSchemaJson), SCHEMA_SOURCE);
  } catch (error) {
    if (!(error instanceof ConfigImportError)) throw error;
    parseIssues.push(...error.issues);
  }
  try {
    uiSchemaDocument = parseInputDocument(inputText(rawUiSchemaJson), UI_SCHEMA_SOURCE);
  } catch (error) {
    if (!(error instanceof ConfigImportError)) throw error;
    parseIssues.push(...error.issues);
  }
  if (parseIssues.length > 0) throw new ConfigImportError(parseIssues);

  return transpileForm(schemaDocument, uiSchemaDocument);
}

/**
 * v1 nodes: resolve a pasted combined `{schema, uiSchema}` document with its
 * original un-prefixed path contract. Callers only invoke this when non-empty.
 */
export function resolveLegacyImportedForm(importConfig: unknown): Form {
  const raw = typeof importConfig === 'string' ? importConfig.trim() : '';
  return transpileConfig(parseImportDocument(raw));
}

/**
 * Whether a node parameter counts as filled: non-empty text, or any
 * structured value (n8n may deliver `json` parameters as parsed objects).
 * A filled input must never silently fall back to builder Fields.
 */
function inputFilled(raw: unknown): boolean {
  if (typeof raw === 'string') return raw.trim() !== '';
  return raw !== undefined && raw !== null;
}

/** The pasted input as JSON text; structured values are serialized for parsing. */
function inputText(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim();
  if (raw === undefined || raw === null) return '';
  return JSON.stringify(raw);
}

/** Copy so callers can never mutate a previously built Form through a request. */
function structuredCopyForm(form: Readonly<Form>): Form {
  return {
    ...(form.title !== undefined ? { title: form.title } : {}),
    ...(form.description !== undefined ? { description: form.description } : {}),
    fields: form.fields.map((field) => ({ ...field })),
  };
}

export { ConfigImportError };
export type { ImportSource };
