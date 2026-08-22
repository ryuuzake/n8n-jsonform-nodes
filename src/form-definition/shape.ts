import { FormDefinitionError } from "./errors";
import { isIsoDate } from "./iso-date";
import { resolveForm } from "./resolve";
import type { Form, ResolvedField, Submission } from "./types";

export interface SubmissionIssue {
  code: "missing-required" | "invalid-type" | "invalid-constraint";
  field: string;
  message: string;
}

export class SubmissionShapeError extends FormDefinitionError {
  override name = "SubmissionShapeError";

  constructor(readonly issues: readonly SubmissionIssue[]) {
    super(
      issues.length === 1
        ? (issues[0]?.message ?? "Submission rejected.")
        : `Submission rejected with ${issues.length} problems:\n${issues
            .map((issue) => `- ${issue.message}`)
            .join("\n")}`,
    );
  }
}

function isEmptyValue(value: unknown): boolean {
  return value === "" || (Array.isArray(value) && value.length === 0);
}

function validateValue(field: ResolvedField, value: unknown): SubmissionIssue | undefined {
  const fail = (
    code: SubmissionIssue["code"],
    message: string,
  ): SubmissionIssue => ({ code, field: field.name, message });

  switch (field.type) {
    case "text":
    case "textarea": {
      if (typeof value !== "string") {
        return fail("invalid-type", `"${field.name}" must be a string.`);
      }
      if (field.maxLength !== undefined && value.length > field.maxLength) {
        return fail(
          "invalid-constraint",
          `"${field.name}" must be at most ${field.maxLength} characters.`,
        );
      }
      return undefined;
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return fail("invalid-type", `"${field.name}" must be a finite number.`);
      }
      if (field.min !== undefined && value < field.min) {
        return fail("invalid-constraint", `"${field.name}" must be at least ${field.min}.`);
      }
      if (field.max !== undefined && value > field.max) {
        return fail("invalid-constraint", `"${field.name}" must be at most ${field.max}.`);
      }
      return undefined;
    }
    case "date": {
      if (typeof value !== "string" || !isIsoDate(value)) {
        return fail(
          "invalid-type",
          `"${field.name}" must be an ISO date string (YYYY-MM-DD).`,
        );
      }
      if (field.minDate !== undefined && value < field.minDate) {
        return fail(
          "invalid-constraint",
          `"${field.name}" must not be before ${field.minDate}.`,
        );
      }
      if (field.maxDate !== undefined && value > field.maxDate) {
        return fail(
          "invalid-constraint",
          `"${field.name}" must not be after ${field.maxDate}.`,
        );
      }
      return undefined;
    }
    case "boolean": {
      if (typeof value !== "boolean") {
        return fail("invalid-type", `"${field.name}" must be a boolean.`);
      }
      return undefined;
    }
    case "select": {
      if (typeof value !== "string" || !(field.choices ?? []).includes(value)) {
        return fail(
          "invalid-type",
          `"${field.name}" must be one of: ${(field.choices ?? []).map((choice) => JSON.stringify(choice)).join(", ")}.`,
        );
      }
      return undefined;
    }
    case "multiselect": {
      const choices = field.choices ?? [];
      if (!Array.isArray(value)) {
        return fail("invalid-type", `"${field.name}" must be an array of choices.`);
      }
      const seen = new Set<string>();
      for (const item of value) {
        if (typeof item !== "string" || !choices.includes(item)) {
          return fail(
            "invalid-type",
            `"${field.name}" contains a value outside of: ${choices.map((choice) => JSON.stringify(choice)).join(", ")}.`,
          );
        }
        if (seen.has(item)) {
          return fail(
            "invalid-constraint",
            `"${field.name}" must not contain duplicate selections.`,
          );
        }
        seen.add(item);
      }
      return undefined;
    }
  }
}

export function shapeSubmission(
  form: Readonly<Form>,
  payload: unknown,
  now: () => Date = () => new Date(),
): Submission {
  const fields = resolveForm(form).fields;
  const issues: SubmissionIssue[] = [];

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

  const submission: Submission = { submittedAt: "" };
  for (const field of fields) {
    const value = data[field.name];
    if (value === undefined || value === null || (field.required && isEmptyValue(value))) {
      if (field.required) {
        issues.push({
          code: "missing-required",
          field: field.name,
          message: `"${field.name}" is required.`,
        });
      }
      continue;
    }
    const issue = validateValue(field, value);
    if (issue) {
      issues.push(issue);
      continue;
    }
    submission[field.name] = value;
  }

  if (issues.length > 0) {
    throw new SubmissionShapeError(issues);
  }

  submission.submittedAt = now().toISOString();
  return submission;
}
