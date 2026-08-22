import type { Field, FieldType, Form } from '../../src/form-definition';

/**
 * Seam between the n8n Fields collection parameter and the Form Definition
 * module.
 *
 * The node UI stores fields as an editable fixedCollection:
 *
 *   { field: [ { name, label, type, required?, ...constraints }, ... ] }
 *
 * `buildFormFromParameters` normalizes that raw parameter into a `Form`.
 * It only handles parameter-shape concerns (coercion, empty values,
 * type-specific constraints); domain rules (name pattern, uniqueness,
 * reserved names, constraint sanity) are enforced by the Form Definition
 * module when the built Form is resolved.
 */

/** The exact v1 field-type vocabulary offered in the node UI. */
export const FIELD_TYPE_OPTIONS: Array<{
  name: string;
  value: FieldType;
  description: string;
}> = [
  { name: 'Text', value: 'text', description: 'Single-line text input' },
  { name: 'Long Text', value: 'textarea', description: 'Multi-line text input' },
  { name: 'Number', value: 'number', description: 'Numeric input with optional min/max' },
  { name: 'Date', value: 'date', description: 'Date picker with optional range' },
  { name: 'Switch', value: 'boolean', description: 'Boolean checkbox' },
  {
    name: 'Dropdown',
    value: 'select',
    description: 'Pick one of several choices',
  },
  {
    name: 'Multi-Select Dropdown',
    value: 'multiselect',
    description: 'Pick several of a list of choices',
  },
];

type RawEntry = Record<string, unknown>;

export interface FormBuilderParameters {
  formTitle?: unknown;
  formDescription?: unknown;
  fields?: unknown;
}

function isRecord(value: unknown): value is RawEntry {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Extract the entry list from the fixedCollection value (or a bare array). */
function rawEntries(fieldsParameter: unknown): RawEntry[] {
  const entries = isRecord(fieldsParameter) ? fieldsParameter.field : fieldsParameter;

  if (!Array.isArray(entries)) {
    throw new Error(
      'The Fields parameter must be an editable collection of field entries; reload the node and configure it in the UI.',
    );
  }
  return entries.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(
        `Field entry ${index} is not a valid object. Re-add it in the Fields collection.`,
      );
    }
    return entry;
  });
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const asString = String(value);
  return asString.length > 0 ? asString : undefined;
}

function optionalNumber(entry: RawEntry, key: string, display: string): number | undefined {
  const value = entry[key];
  if (value === undefined || value === null || value === '') return undefined;
  const asNumber = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(asNumber)) {
    throw new Error(
      `Field "${display}" has an invalid ${key} value (${JSON.stringify(value)}): a number is required.`,
    );
  }
  return asNumber;
}

function requiredFlag(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === false || value === '') return undefined;
  if (value === true || value === 'true') return true;
  throw new Error(`The Required option must be a boolean, got ${JSON.stringify(value)}.`);
}

function choicesList(entry: RawEntry, display: string): string[] | undefined {
  const value = entry.choices;
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(
      `Field "${display}" has invalid choices (${JSON.stringify(value)}): add choices one by one in the Choices collection.`,
    );
  }
  return value.map((choice) => String(choice));
}

/** Strip keys set to undefined so an untouched parameter stays absent. */
function compact<T extends object>(object: T): T {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined),
  ) as T;
}

function normalizeEntry(entry: RawEntry, index: number): Field {
  const name = optionalString(entry.name);
  const label = optionalString(entry.label);
  // Errors identify the field by its name first, since that is what authors
  // must fix; fall back to label and position while the name is missing.
  const display = name ?? label ?? '';
  if (!name) {
    throw new Error(`Field ${index} ("${display}") is missing a Name.`);
  }
  const type = optionalString(entry.type);
  if (!type) {
    throw new Error(`Field ${index} ("${display}") is missing a Type.`);
  }

  const field: Field = { name, label: label ?? '', type: type as FieldType };
  const required = requiredFlag(entry.required);
  if (required !== undefined) field.required = required;

  // Constraints are read per type so leftovers from a previous type selection
  // (invisible in the UI after switching) never leak into the built Form.
  switch (type as FieldType) {
    case 'text':
    case 'textarea':
      field.maxLength = optionalNumber(entry, 'maxLength', display);
      break;
    case 'number':
      field.min = optionalNumber(entry, 'min', display);
      field.max = optionalNumber(entry, 'max', display);
      break;
    case 'date':
      field.minDate = optionalString(entry.minDate);
      field.maxDate = optionalString(entry.maxDate);
      break;
    case 'select':
    case 'multiselect':
      field.choices = choicesList(entry, display);
      break;
    default:
      break;
  }

  return compact(field);
}

/** Build the configured Form from the node's parameters. */
export function buildFormFromParameters(parameters: FormBuilderParameters): Form {
  const title = optionalString(parameters.formTitle);
  const description = optionalString(parameters.formDescription);

  return compact({
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    fields: rawEntries(parameters.fields).map(normalizeEntry),
  });
}
