import { isIsoDate } from "./iso-date";
import {
  DuplicateFieldNameError,
  FieldNamePatternError,
  InvalidConstraintError,
  MissingChoicesError,
  ReservedFieldNameError,
  UnknownFieldTypeError,
} from "./errors";
import { FIELD_TYPES, type Field, type FieldType, type Form, type ResolvedField, type ResolvedForm } from "./types";

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_NAMES = new Set(["submittedAt"]);

export function resolveFields(fields: readonly Field[]): ResolvedField[] {
  const seen = new Map<string, number>();

  fields.forEach((field, index) => {
    if (!NAME_PATTERN.test(field.name)) {
      throw new FieldNamePatternError(index, field.name);
    }
    if (RESERVED_NAMES.has(field.name)) {
      throw new ReservedFieldNameError(index, field.name);
    }
    const firstIndex = seen.get(field.name);
    if (firstIndex !== undefined) {
      throw new DuplicateFieldNameError(index, field.name, firstIndex);
    }
    seen.set(field.name, index);

    if (!FIELD_TYPES.includes(field.type as FieldType)) {
      throw new UnknownFieldTypeError(index, String(field.type));
    }

    switch (field.type) {
      case "text":
      case "textarea":
        if (field.maxLength !== undefined && field.maxLength < 1) {
          throw new InvalidConstraintError(index, field.name, "maxLength must be at least 1.");
        }
        break;
      case "number":
        if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
          throw new InvalidConstraintError(
            index,
            field.name,
            `min (${field.min}) must not exceed max (${field.max}).`,
          );
        }
        break;
      case "date": {
        for (const [key, value] of [
          ["minDate", field.minDate],
          ["maxDate", field.maxDate],
        ] as const) {
          if (value !== undefined && !isIsoDate(value)) {
            throw new InvalidConstraintError(
              index,
              field.name,
              `${key} must be a valid ISO date (YYYY-MM-DD), got "${value}".`,
            );
          }
        }
        if (
          field.minDate !== undefined &&
          field.maxDate !== undefined &&
          field.minDate > field.maxDate
        ) {
          throw new InvalidConstraintError(
            index,
            field.name,
            `minDate (${field.minDate}) must not be after maxDate (${field.maxDate}).`,
          );
        }
        break;
      }
      case "select":
      case "multiselect":
        if (!field.choices || field.choices.length === 0) {
          throw new MissingChoicesError(index, field.name, field.type);
        }
        break;
      case "boolean":
        break;
    }
  });

  return fields.map((field) => ({
    name: field.name,
    label: field.label,
    type: field.type,
    required: field.required ?? false,
    ...(field.maxLength !== undefined ? { maxLength: field.maxLength } : {}),
    ...(field.min !== undefined ? { min: field.min } : {}),
    ...(field.max !== undefined ? { max: field.max } : {}),
    ...(field.minDate !== undefined ? { minDate: field.minDate } : {}),
    ...(field.maxDate !== undefined ? { maxDate: field.maxDate } : {}),
    ...(field.choices !== undefined ? { choices: [...field.choices] } : {}),
  }));
}

export function resolveForm(form: Readonly<Form>): ResolvedForm {
  return {
    ...(form.title !== undefined ? { title: form.title } : {}),
    ...(form.description !== undefined ? { description: form.description } : {}),
    fields: resolveFields(form.fields),
  };
}
