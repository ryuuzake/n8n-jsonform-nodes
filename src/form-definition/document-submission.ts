import Ajv from "ajv";
import addFormats from "ajv-formats";
import type { ErrorObject, ValidateFunction } from "ajv";

import { SubmissionShapeError, type SubmissionIssue } from "./shape";
import type { JsonSchema, Submission } from "./types";

/**
 * Submission shaping seam for imported documents.
 *
 * Imported schemas are served verbatim, so their submissions are validated
 * the same way the served page validates them — with Ajv against the pasted
 * schema — instead of field-by-field. Accepted payloads are emitted with
 * nesting intact; every violated constraint is collected into one
 * SubmissionShapeError so POST answers share the builder path's error shape.
 */

/**
 * An Ajv instance configured exactly like JSONForms' own `createAjv` (same
 * options, same format registrations), so the server accepts and rejects the
 * same payloads the served page does.
 */
function createValidator(schema: JsonSchema): ValidateFunction {
  const ajv = new Ajv({
    allErrors: true,
    verbose: true,
    strict: false,
    addUsedSchema: false,
  });
  addFormats(ajv);
  return ajv.compile(schema);
}

function issueOf(error: ErrorObject): SubmissionIssue {
  const fail = (
    code: SubmissionIssue["code"],
    field: string,
    message: string,
  ): SubmissionIssue => ({ code, field, message });

  if (error.keyword === "required") {
    const field = joinPath(error.instancePath, String(error.params.missingProperty));
    return fail("missing-required", field, `"${field}" is required.`);
  }

  const field = error.instancePath === "" ? "(root)" : error.instancePath.replace(/^\//, "");
  const code = error.keyword === "type" ? "invalid-type" : "invalid-constraint";
  return fail(code, field, `${field}: ${error.message ?? "is invalid"}.`);
}

function joinPath(parent: string, leaf: string): string {
  const trimmed = parent.replace(/^\//, "").replaceAll("/", ".");
  return trimmed === "" ? leaf : `${trimmed}.${leaf}`;
}

/**
 * Validate a raw submission payload against an imported (or compiled) schema
 * and stamp the system-set timestamp. The timestamp always wins over any
 * payload key of the same name.
 */
export function shapeDocumentSubmission(
  schema: JsonSchema,
  payload: unknown,
  now: () => Date = () => new Date(),
): Submission {
  let data: Record<string, unknown>;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new SubmissionShapeError([
      {
        code: "invalid-type",
        field: "(root)",
        message: "Submission payload must be a JSON object.",
      },
    ]);
  }
  data = payload as Record<string, unknown>;

  const validate = createValidator(schema);
  if (!validate(data)) {
    throw new SubmissionShapeError(
      (validate.errors ?? []).map((error) => issueOf(error)),
    );
  }

  return { ...data, submittedAt: now().toISOString() };
}
