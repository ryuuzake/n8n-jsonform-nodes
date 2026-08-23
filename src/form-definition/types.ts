export const FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "date",
  "boolean",
  "select",
  "multiselect",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export interface Field {
  /** Identifier used as the schema property key. Rules enforced by `resolveForm`. */
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** `text` and `textarea` only: maximum character length. */
  maxLength?: number;
  /** `text` and `textarea` only: minimum character length. */
  minLength?: number;
  /** Show this field only while `field` equals `equals` (compiled to a SHOW rule). */
  visibleWhen?: FieldVisibility;
  /** `number` only: inclusive lower bound. */
  min?: number;
  /** `number` only: inclusive upper bound. */
  max?: number;
  /** `date` only: inclusive lower bound, ISO date (`YYYY-MM-DD`). */
  minDate?: string;
  /** `date` only: inclusive upper bound, ISO date (`YYYY-MM-DD`). */
  maxDate?: string;
  /** `select` and `multiselect` only: allowed values. */
  choices?: string[];
}

export interface Form {
  title?: string;
  description?: string;
  fields: Field[];
}

/**
 * A single-equality visibility condition: the named field must equal `equals`
 * (a JSON primitive) for the guarded field to be shown.
 */
export interface FieldVisibility {
  field: string;
  equals: string | number | boolean;
}

export interface ResolvedField {
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  maxLength?: number;
  minLength?: number;
  visibleWhen?: FieldVisibility;
  min?: number;
  max?: number;
  minDate?: string;
  maxDate?: string;
  choices?: readonly string[];
}

export interface ResolvedForm {
  title?: string;
  description?: string;
  fields: ResolvedField[];
}

export type JsonSchema = Record<string, unknown>;

export interface UiSchemaElement {
  type: string;
  scope?: string;
  label?: string;
  options?: Record<string, unknown>;
}

export interface UiSchema {
  type: string;
  elements: UiSchemaElement[];
}

export interface CompiledForm {
  schema: JsonSchema;
  uiSchema: UiSchema;
}

/** Flat field values plus the system-set `submittedAt` timestamp. */
export interface Submission {
  submittedAt: string;
  [field: string]: unknown;
}
