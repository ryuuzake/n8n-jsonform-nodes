/**
 * Import seam: structural validation of pasted JSONForms documents.
 *
 * Imported documents are passed through verbatim — never transpiled into
 * builder Fields. JSONForms owns rendering and client-side validation, so any
 * construct it understands (nested objects, UI rules, Categorization layouts,
 * arbitrary keywords) works exactly as authored. The importer therefore only
 * guards the invariants this node itself depends on:
 *
 * - both halves parse and are JSON objects;
 * - the schema is an object schema asking at least one question;
 * - "required" only references defined properties;
 * - no property collides with the system-set `submittedAt` timestamp;
 * - the uiSchema carries a type, so a renderable page exists.
 *
 * Every violation is collected into a single ConfigImportError with exact
 * paths — imports fail wholesale, never partially.
 *
 * Two entries share one checking core:
 * - `importCombinedDocument` (v1): a pasted `{schema, uiSchema}` document.
 *   Paths hang off the wrapper (`$.schema.x`, `$.uiSchema.x`).
 * - `importSplitDocuments` (v2): split Schema JSON / UI Schema JSON inputs.
 *   Each input roots at `$`; because both do, every issue path carries its
 *   source prefix (`Schema JSON: $.x`, `UI Schema JSON: $.x`). A Combined
 *   Document pasted into either input is rejected with a pointer to the
 *   inner half.
 */

import { ConfigImportError, type ConfigImportIssue } from "./errors";

/** Which pasted input an import issue roots at. */
export type ImportSource = "Schema JSON" | "UI Schema JSON";

export const SCHEMA_SOURCE: ImportSource = "Schema JSON";
export const UI_SCHEMA_SOURCE: ImportSource = "UI Schema JSON";

/** The system-set submission timestamp; imported schemas must not collide with it. */
const RESERVED_PROPERTY = "submittedAt";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A legacy `{schema, uiSchema}` wrapper pasted into one of the split inputs. */
function isCombinedDocument(value: Record<string, unknown>): boolean {
  return "schema" in value && "uiSchema" in value;
}

/** Parse the raw pasted parameter value; invalid JSON is itself an import error. */
export function parseImportDocument(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new ConfigImportError([
      {
        path: "$",
        reason: `document is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      },
    ]);
  }
}

/** Parse one split input, tagging any parse failure with the input it came from. */
export function parseInputDocument(raw: string, source: ImportSource): unknown {
  try {
    return parseImportDocument(raw);
  } catch (error) {
    if (error instanceof ConfigImportError) {
      throw new ConfigImportError(
        error.issues.map((issue) => ({ ...issue, path: `${source}: ${issue.path}` })),
      );
    }
    throw error;
  }
}

/** The two documents an import serves, guaranteed structurally sound. */
export interface ImportedDocuments {
  schema: Record<string, unknown>;
  uiSchema: Record<string, unknown>;
}

/** v1 entry: validate a legacy `{schema, uiSchema}` wrapper with un-prefixed paths. */
export function importCombinedDocument(document: unknown): ImportedDocuments {
  if (!isPlainObject(document)) {
    throw new ConfigImportError([
      { path: "$", reason: "document must be a {schema, uiSchema} JSON object." },
    ]);
  }

  const schema = document.schema;
  const uiSchema = document.uiSchema;
  const issues: ConfigImportIssue[] = [];
  if (!isPlainObject(schema)) {
    issues.push({ path: "$.schema", reason: 'a "schema" object is required.' });
  }
  if (!isPlainObject(uiSchema)) {
    issues.push({ path: "$.uiSchema", reason: 'a "uiSchema" object is required.' });
  }
  if (issues.length > 0) throw new ConfigImportError(issues);

  // Both halves passed isPlainObject above; the aggregate throw keeps the
  // guards' narrowing out of TS reach, so assert what was just verified.
  return checkDocuments(
    schema as Record<string, unknown>,
    uiSchema as Record<string, unknown>,
    false,
  );
}

/**
 * v2 entry: validate split Schema JSON / UI Schema JSON documents with
 * source-prefixed `$`-rooted paths.
 */
export function importSplitDocuments(
  schemaDocument: unknown,
  uiSchemaDocument: unknown,
): ImportedDocuments {
  const shellIssues: ConfigImportIssue[] = [
    ...splitInputShellIssues(schemaDocument, SCHEMA_SOURCE, "schema", "must be a JSON Schema object."),
    ...splitInputShellIssues(
      uiSchemaDocument,
      UI_SCHEMA_SOURCE,
      "uiSchema",
      "must be a JSONForms UI Schema object.",
    ),
  ];
  if (shellIssues.length > 0) throw new ConfigImportError(shellIssues);

  return checkDocuments(
    schemaDocument as Record<string, unknown>,
    uiSchemaDocument as Record<string, unknown>,
    true,
  );
}

/**
 * Shell-level problems of one split input: not an object, or a Combined
 * Document pasted where only the inner half belongs.
 */
function splitInputShellIssues(
  document: unknown,
  source: ImportSource,
  innerName: string,
  typeProblem: string,
): ConfigImportIssue[] {
  if (!isPlainObject(document)) {
    return [{ path: `${source}: $`, reason: typeProblem }];
  }
  if (isCombinedDocument(document)) {
    return [
      {
        path: `${source}: $`,
        reason: `looks like a combined {schema, uiSchema} document; paste only its inner "${innerName}" object here.`,
      },
    ];
  }
  return [];
}

/** Run every structural check across both documents, or throw them all together. */
function checkDocuments(
  schema: Record<string, unknown>,
  uiSchema: Record<string, unknown>,
  split: boolean,
): ImportedDocuments {
  // Split inputs each root at `$` (tagged by source); legacy wrapper paths
  // hang off the `{schema, uiSchema}` envelope.
  const schemaPath = (keywordPath: string): string =>
    split ? `${SCHEMA_SOURCE}: ${keywordPath}` : `$.schema.${keywordPath.slice(2)}`;
  const uiSchemaPath = (keywordPath: string): string =>
    split ? `${UI_SCHEMA_SOURCE}: ${keywordPath}` : `$.uiSchema.${keywordPath.slice(2)}`;

  const issues: ConfigImportIssue[] = [];

  // The served page renders whatever JSONForms understands, but submissions
  // are always one JSON object — the root must say so.
  if (schema.type !== "object") {
    issues.push({
      path: schemaPath("$.type"),
      reason: 'the root schema must have "type": "object".',
    });
  }

  const properties = schema.properties;
  if (!isPlainObject(properties) || Object.keys(properties).length === 0) {
    issues.push({
      path: schemaPath("$.properties"),
      reason: 'at least one property is required under "properties".',
    });
  }

  const required = schema.required;
  if (required !== undefined) {
    if (!Array.isArray(required) || required.some((entry) => typeof entry !== "string")) {
      issues.push({
        path: schemaPath("$.required"),
        reason: '"required" must be an array of property names.',
      });
    } else if (isPlainObject(properties)) {
      for (const [index, entry] of required.entries()) {
        if (!(entry as string in properties)) {
          issues.push({
            path: schemaPath(`$.required[${index}]`),
            reason: `"required" references "${String(entry)}", which is not a defined property.`,
          });
        }
      }
    }
  }

  if (isPlainObject(properties) && RESERVED_PROPERTY in properties) {
    issues.push({
      path: schemaPath(`$.properties.${RESERVED_PROPERTY}`),
      reason: `"${RESERVED_PROPERTY}" is reserved for the system-set submission timestamp.`,
    });
  }

  if (typeof uiSchema.type !== "string") {
    issues.push({
      path: uiSchemaPath("$.type"),
      reason: 'a "uiSchema" requires a "type" so the page has something to render.',
    });
  }

  if (issues.length > 0) throw new ConfigImportError(issues);
  return { schema, uiSchema };
}
