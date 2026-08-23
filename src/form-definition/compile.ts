import { resolveForm } from "./resolve";
import type { CompiledForm, FieldVisibility, Form, JsonSchema, ResolvedField } from "./types";

function propertySchema(field: ResolvedField): JsonSchema {
  switch (field.type) {
    case "text":
    case "textarea":
      return {
        type: "string",
        ...(field.minLength !== undefined ? { minLength: field.minLength } : {}),
        ...(field.maxLength !== undefined ? { maxLength: field.maxLength } : {}),
      };
    case "number":
      return {
        type: "number",
        ...(field.min !== undefined ? { minimum: field.min } : {}),
        ...(field.max !== undefined ? { maximum: field.max } : {}),
      };
    case "date":
      return {
        type: "string",
        format: "date",
        ...(field.minDate !== undefined ? { formatMinimum: field.minDate } : {}),
        ...(field.maxDate !== undefined ? { formatMaximum: field.maxDate } : {}),
      };
    case "boolean":
      return { type: "boolean" };
    case "select":
      return { type: "string", enum: [...(field.choices ?? [])] };
    case "multiselect":
      return {
        type: "array",
        items: { type: "string", enum: [...(field.choices ?? [])] },
        uniqueItems: true,
      };
  }
}

/** The JSONForms rule a compiled visibility condition becomes. */
function visibilityRule(visibility: FieldVisibility): Record<string, unknown> {
  return {
    effect: "SHOW",
    condition: {
      scope: `#/properties/${visibility.field}`,
      schema: { const: visibility.equals },
    },
  };
}

export function compileForm(form: Readonly<Form>): CompiledForm {
  const resolved = resolveForm(form);

  const properties: Record<string, JsonSchema> = {};
  for (const field of resolved.fields) {
    properties[field.name] = propertySchema(field);
  }

  const required = resolved.fields.filter((f) => f.required).map((f) => f.name);

  const schema: JsonSchema = { type: "object", properties };
  if (required.length > 0) schema.required = required;
  if (resolved.title !== undefined) schema.title = resolved.title;
  if (resolved.description !== undefined) schema.description = resolved.description;

  return {
    schema,
    uiSchema: {
      type: "VerticalLayout",
      elements: resolved.fields.map((field) => ({
        type: "Control",
        scope: `#/properties/${field.name}`,
        label: field.label,
        ...(field.visibleWhen !== undefined ? { rule: visibilityRule(field.visibleWhen) } : {}),
        ...(field.type === "textarea" ? { options: { multi: true } } : {}),
      })),
    },
  };
}
