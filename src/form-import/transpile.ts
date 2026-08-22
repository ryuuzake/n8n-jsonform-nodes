/**
 * Import seam: transpile a pasted `{schema, uiSchema}` document into Fields.
 *
 * JSON Schema is an interchange format, never a second storage model — the
 * document is transformed into the same Field subset the builder produces and
 * then recompiled through the Form Definition module. Constructs outside the
 * Field subset are rejected loudly: every offending location is collected into
 * a single ConfigImportError with exact paths, never silently dropped.
 *
 * Path conventions (JSONPath-flavoured):
 * - `$` is the pasted document; shell problems point at `$.schema` / `$.uiSchema`.
 * - Properties are abbreviated to `$.<name>` (e.g. `$.address.city`) per the
 *   ticket examples; constraint problems hang off that path (`$.age.minimum`).
 * - UI Schema elements use `uiSchema.elements[<index>]`.
 */

import { isIsoDate } from "../form-definition/iso-date";
import type { Field, FieldType, Form } from "../form-definition/types";

import { ConfigImportError, type ConfigImportIssue } from "./errors";

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_NAMES = new Set(["submittedAt"]);

/** Keywords that define variants or conditional behaviour — outside the subset. */
const VARIANT_KEYWORDS = ["oneOf", "anyOf"] as const;
const CONDITIONAL_KEYWORDS = ["allOf", "not", "$ref", "if", "then", "else"] as const;

const SCOPE_PATTERN = /^#\/properties\/([A-Za-z_][A-Za-z0-9_]*)$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

interface FieldRecord {
  label?: string;
  type: FieldType;
  title?: string;
  multi?: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
  minDate?: string;
  maxDate?: string;
  choices?: string[];
}

class Transpiler {
  private readonly issues: ConfigImportIssue[] = [];
  private readonly fields = new Map<string, FieldRecord>();
  private readonly requiredNames = new Set<string>();
  private readonly labeledByControl = new Set<string>();
  private readonly propertyNames = new Set<string>();
  private formTitle: string | undefined;
  private formDescription: string | undefined;

  private add(path: string, reason: string): void {
    this.issues.push({ path, reason });
  }
  transpile(document: unknown): Form {
    if (!isPlainObject(document)) {
      throw new ConfigImportError([
        { path: "$", reason: "document must be a {schema, uiSchema} JSON object." },
      ]);
    }

    const schema = document.schema;
    const uiSchema = document.uiSchema;
    if (!isPlainObject(schema) || !isPlainObject(uiSchema)) {
      const shellIssues: ConfigImportIssue[] = [];
      if (!isPlainObject(schema)) {
        shellIssues.push({ path: "$.schema", reason: 'a "schema" object is required.' });
      }
      if (!isPlainObject(uiSchema)) {
        shellIssues.push({ path: "$.uiSchema", reason: 'a "uiSchema" object is required.' });
      }
      throw new ConfigImportError(shellIssues);
    }

    this.readRootSchema(schema);
    this.readUiSchema(uiSchema);

    if (this.issues.length > 0) throw new ConfigImportError(this.issues);
    return this.buildForm();
  }

  private readRootSchema(schema: Record<string, unknown>): void {
    if (schema.type !== "object") {
      this.add("$.schema.type", 'the root schema must have "type": "object".');
    }

    const title = schema.title;
    if (title !== undefined && typeof title !== "string") {
      this.add("$.schema.title", '"title" must be a string.');
    } else if (typeof title === "string") {
      this.formTitle = title;
    }

    const description = schema.description;
    if (description !== undefined && typeof description !== "string") {
      this.add("$.schema.description", '"description" must be a string.');
    } else if (typeof description === "string") {
      this.formDescription = description;
    }

    for (const keyword of [...VARIANT_KEYWORDS, ...CONDITIONAL_KEYWORDS]) {
      if (keyword in schema) {
        this.add(
          `$.schema.${keyword}`,
          `"${keyword}" at the root schema is not supported.`,
        );
      }
    }

    const properties = schema.properties;
    if (!isPlainObject(properties) || Object.keys(properties).length === 0) {
      this.add('$.schema.properties', 'at least one property is required under "properties".');
      return;
    }

    for (const [name, propertySchema] of Object.entries(properties)) {
      const path = `$.${name}`;
      this.propertyNames.add(name);
      if (!NAME_PATTERN.test(name)) {
        this.add(
          path,
          `property name "${name}" is invalid: field names must match ${NAME_PATTERN.source}.`,
        );
      } else if (RESERVED_NAMES.has(name)) {
        this.add(path, `"${name}" is reserved for the system-set submission timestamp.`);
      }
      this.readProperty(propertySchema, path, name);
    }

    const required = schema.required;
    if (required !== undefined) {
      if (!Array.isArray(required) || required.some((entry) => typeof entry !== "string")) {
        this.add("$.schema.required", '"required" must be an array of property names.');
      } else {
        for (const [index, entry] of required.entries()) {
          if (!(entry as string in properties)) {
            this.add(
              `$.schema.required[${index}]`,
              `"required" references "${String(entry)}", which is not a defined property.`,
            );
          }
        }
        for (const entry of required as string[]) this.requiredNames.add(entry);
      }
    }
  }

  private readProperty(schema: unknown, path: string, name: string, nested = false): void {
    if (!isPlainObject(schema)) {
      this.add(path, "must be a schema object.");
      return;
    }

    const type = schema.type;

    if (nested) {
      // Nothing under a rejected container becomes a Field. Nested objects
      // are still descended to report every lost leaf at its exact path;
      // every other construct is reported where it stands.
      if (type === "object") {
        this.descendIntoObject(schema, path);
      } else {
        this.add(path, "nested inside an object; flatten nested objects into top-level fields.");
      }
      return;
    }

    // Containers are never Fields themselves; descend to report every leaf
    // that would be lost.
    if (type === "object") {
      this.reportBlockedKeywords(schema, path);
      this.descendIntoObject(schema, path);
      return;
    }
    if (type === "array") {
      this.reportBlockedKeywords(schema, path);
      this.readArray(schema, path, name);
      return;
    }

    if (Array.isArray(type)) {
      this.add(path, "type unions are not supported.");
      return;
    }
    if (typeof type !== "string") {
      this.add(path, 'a "type" is required.');
      return;
    }
    if (this.reportBlockedKeywords(schema, path)) return;

    switch (type) {
      case "string":
        this.readString(schema, path, name);
        return;
      case "number":
        this.readNumber(schema, path, name);
        return;
      case "boolean":
        this.record(name, { type: "boolean", title: asTitle(schema.title) });
        return;
      case "integer":
        this.add(path, '"integer" is not supported; use "number".');
        return;
      default:
        this.add(path, `unsupported type "${type}".`);
    }
  }

  /** Report variant/conditional keywords at `path`; true when any was found. */
  private reportBlockedKeywords(schema: Record<string, unknown>, path: string): boolean {
    let blocked = false;
    for (const keyword of VARIANT_KEYWORDS) {
      if (keyword in schema) {
        this.add(path, `"${keyword}" variants are not supported.`);
        blocked = true;
      }
    }
    for (const keyword of CONDITIONAL_KEYWORDS) {
      if (keyword in schema) {
        this.add(`${path}.${keyword}`, `"${keyword}" conditionals are not supported.`);
        blocked = true;
      }
    }
    return blocked;
  }

  /** Report every leaf lost inside an object property at its exact path. */
  private descendIntoObject(schema: Record<string, unknown>, path: string): void {
    const properties = schema.properties;
    if (!isPlainObject(properties) || Object.keys(properties).length === 0) {
      this.add(path, "objects are not supported; flatten nested objects into top-level fields.");
      return;
    }
    for (const [childName, childSchema] of Object.entries(properties)) {
      this.readProperty(childSchema, `${path}.${childName}`, childName, true);
    }
  }

  private readArray(schema: Record<string, unknown>, path: string, name: string): void {
    const items = schema.items;
    if (!isPlainObject(items)) {
      this.add(`${path}.items`, 'arrays require an "items" schema.');
      return;
    }

    // Array-of-object: report the exact item paths that would be lost.
    if (items.type === "object") {
      this.descendIntoObject(items, `${path}.items`);
      return;
    }

    if (
      items.type === "string" &&
      Array.isArray(items.enum) &&
      items.enum.every((choice) => typeof choice === "string")
    ) {
      if (items.enum.length === 0) {
        this.add(`${path}.items.enum`, "multiselect choices must not be empty.");
        return;
      }
      this.record(name, {
        type: "multiselect",
        title: asTitle(schema.title),
        choices: [...(items.enum as string[])],
      });
      return;
    }

    this.add(`${path}.items`, 'only arrays of string enums (multiselect) are supported.');
  }

  private readString(schema: Record<string, unknown>, path: string, name: string): void {
    if ("enum" in schema) {
      const choices = schema.enum;
      if (!Array.isArray(choices) || !choices.every((choice) => typeof choice === "string")) {
        this.add(`${path}.enum`, "enum values must be strings.");
        return;
      }
      if (choices.length === 0) {
        this.add(`${path}.enum`, "choices must not be empty.");
        return;
      }
      if ("maxLength" in schema) {
        this.add(`${path}.maxLength`, '"maxLength" applies to text fields, not selects.');
        return;
      }
      this.record(name, {
        type: "select",
        title: asTitle(schema.title),
        choices: [...(choices as string[])],
      });
      return;
    }

    const format = schema.format;
    if (format !== undefined && format !== "date") {
      this.add(`${path}.format`, `format "${String(format)}" is not supported.`);
      return;
    }

    if (format === "date") {
      const record: FieldRecord = { type: "date", title: asTitle(schema.title) };
      for (const [keyword, target] of [
        ["formatMinimum", "minDate"],
        ["formatMaximum", "maxDate"],
      ] as const) {
        const value = schema[keyword];
        if (value === undefined) continue;
        if (typeof value !== "string" || !isIsoDate(value)) {
          this.add(
            `${path}.${keyword}`,
            `"${keyword}" must be a valid ISO date (YYYY-MM-DD).`,
          );
          continue;
        }
        record[target] = value;
      }
      this.record(name, record);
      return;
    }

    for (const keyword of ["minLength", "pattern"] as const) {
      if (keyword in schema) {
        this.add(`${path}.${keyword}`, `"${keyword}" is not supported.`);
        return;
      }
    }

    const record: FieldRecord = { type: "text", title: asTitle(schema.title) };
    const maxLength = schema.maxLength;
    if (maxLength !== undefined) {
      if (typeof maxLength !== "number" || !Number.isInteger(maxLength) || maxLength < 1) {
        this.add(`${path}.maxLength`, '"maxLength" must be an integer of at least 1.');
        return;
      }
      record.maxLength = maxLength;
    }
    this.record(name, record);
  }

  private readNumber(schema: Record<string, unknown>, path: string, name: string): void {
    for (const keyword of ["exclusiveMinimum", "exclusiveMaximum"] as const) {
      if (keyword in schema) {
        this.add(`${path}.${keyword}`, `"${keyword}" is not supported; use inclusive bounds.`);
        return;
      }
    }

    const record: FieldRecord = { type: "number", title: asTitle(schema.title) };
    for (const [keyword, target] of [
      ["minimum", "min"],
      ["maximum", "max"],
    ] as const) {
      const value = schema[keyword];
      if (value === undefined) continue;
      if (typeof value !== "number" || !Number.isFinite(value)) {
        this.add(`${path}.${keyword}`, `"${keyword}" must be a number.`);
        continue;
      }
      record[target] = value;
    }
    this.record(name, record);
  }

  private readUiSchema(uiSchema: Record<string, unknown>): void {
    const elements = uiSchema.elements;
    if (!Array.isArray(elements)) {
      this.add("$.uiSchema.elements", '"uiSchema.elements" must be an array.');
      return;
    }

    elements.forEach((element, index) => {
      const path = `uiSchema.elements[${index}]`;
      if (!isPlainObject(element)) {
        this.add(path, "must be an element object.");
        return;
      }
      if ("rule" in element) {
        this.add(path, "UI rules are not supported.");
        return;
      }
      if (element.type !== "Control") {
        this.add(
          path,
          `only "Control" elements bound to top-level properties are supported, got "${String(element.type)}".`,
        );
        return;
      }

      const scope = element.scope;
      const match = typeof scope === "string" ? SCOPE_PATTERN.exec(scope) : null;
      if (!match) {
        this.add(
          path,
          `scope must point at a top-level property like "#/properties/name", got "${String(scope)}".`,
        );
        return;
      }
      const target = match[1] as string;
      if (!this.propertyNames.has(target)) {
        this.add(path, `references "${target}", which is not a defined property.`);
        return;
      }
      // Properties already rejected on the schema side have no Field to bind;
      // their Controls must not add cascading noise to the report.
      if (!this.fields.has(target)) {
        return;
      }
      if (this.labeledByControl.has(target)) {
        this.add(path, `another Control already targets "${target}".`);
        return;
      }

      const label = element.label;
      if (label !== undefined && typeof label !== "string") {
        this.add(`${path}.label`, "label must be a string.");
        return;
      }
      this.labeledByControl.add(target);
      const record = this.fields.get(target);
      if (record) {
        if (label !== undefined) record.label = label;
        if (isPlainObject(element.options) && element.options.multi === true) record.multi = true;
      }
    });
  }

  private record(name: string, partial: FieldRecord): void {
    if (this.fields.has(name)) return;
    this.fields.set(name, { ...partial });
  }

  private buildForm(): Form {
    const fields: Field[] = [];
    for (const [name, record] of this.fields.entries()) {
      const field: Field = {
        name,
        label: record.label ?? record.title ?? name,
        type: record.type === "text" && record.multi ? "textarea" : record.type,
        required: this.requiredNames.has(name),
      };
      if (record.maxLength !== undefined) field.maxLength = record.maxLength;
      if (record.min !== undefined) field.min = record.min;
      if (record.max !== undefined) field.max = record.max;
      if (record.minDate !== undefined) field.minDate = record.minDate;
      if (record.maxDate !== undefined) field.maxDate = record.maxDate;
      if (record.choices !== undefined) field.choices = record.choices;
      fields.push(field);
    }

    const form: Form = { fields };
    if (this.formTitle !== undefined) form.title = this.formTitle;
    if (this.formDescription !== undefined) form.description = this.formDescription;
    return form;
  }
}

function asTitle(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Transpile a parsed `{schema, uiSchema}` document into a Form. */
export function transpileConfig(document: unknown): Form {
  const transpiler = new Transpiler();
  return transpiler.transpile(document);
}
