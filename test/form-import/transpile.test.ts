import { describe, expect, it } from "vitest";

import { compileForm, shapeSubmission } from "../../src/form-definition";
import type { CompiledForm } from "../../src/form-definition";
import {
  ConfigImportError,
  parseImportDocument,
  transpileConfig,
  transpileForm,
} from "../../src/form-import";
import type { ConfigImportIssue } from "../../src/form-import";
import type { Form } from "../../src/form-definition/types";

const docWith = (
  properties: Record<string, unknown>,
  overrides: { required?: string[]; title?: string; description?: string; elements?: unknown[] } = {},
): unknown => ({
  schema: {
    type: "object",
    ...(overrides.title !== undefined ? { title: overrides.title } : {}),
    ...(overrides.description !== undefined ? { description: overrides.description } : {}),
    properties,
    ...(overrides.required ? { required: overrides.required } : {}),
  },
  uiSchema: {
    type: "VerticalLayout",
    elements:
      overrides.elements ??
      Object.keys(properties).map((name) => ({
        type: "Control",
        scope: `#/properties/${name}`,
      })),
  },
});

const issuesOf = (doc: unknown): Array<{ path: string; reason: string }> => {
  try {
    transpileConfig(doc);
  } catch (error) {
    if (!(error instanceof ConfigImportError)) throw error;
    return error.issues.map((issue) => ({ path: issue.path, reason: issue.reason }));
  }
  throw new Error("expected ConfigImportError");
};

const pathsOf = (doc: unknown): string[] => issuesOf(doc).map((issue) => issue.path);

/** The Schema JSON half for the split-input tests below. */
const schemaWith = (
  properties: Record<string, unknown>,
  overrides: { required?: string[]; title?: string; description?: string } = {},
): unknown => ({
  type: "object",
  ...(overrides.title !== undefined ? { title: overrides.title } : {}),
  ...(overrides.description !== undefined ? { description: overrides.description } : {}),
  properties,
  ...(overrides.required ? { required: overrides.required } : {}),
});

/** The UI Schema JSON half for the split-input tests below. */
const uiSchemaWith = (elements: unknown[]): unknown => ({
  type: "VerticalLayout",
  elements,
});

/** One Control per property, in property order. */
const defaultControls = (properties: Record<string, unknown>): unknown[] =>
  Object.keys(properties).map((name) => ({
    type: "Control",
    scope: `#/properties/${name}`,
  }));

/** The issues a split transpilation rejects with, or an empty array on success. */
const issuesOfSplit = (schema: unknown, uiSchema: unknown): ConfigImportIssue[] => {
  try {
    transpileForm(schema, uiSchema);
    return [];
  } catch (error) {
    if (!(error instanceof ConfigImportError)) throw error;
    return [...error.issues];
  }
};

const pathsOfSplit = (schema: unknown, uiSchema: unknown): string[] =>
  issuesOfSplit(schema, uiSchema).map((issue) => issue.path);

describe("parseImportDocument", () => {
  it("parses a JSON document", () => {
    expect(parseImportDocument('{"a":1}')).toEqual({ a: 1 });
  });

  it("rejects unparseable input with a single root issue", () => {
    expect(() => parseImportDocument("{not json")).toThrow(ConfigImportError);
    const issues = (() => {
      try {
        parseImportDocument("{not json");
      } catch (error) {
        return (error as ConfigImportError).issues;
      }
      return [];
    })();
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe("$");
    expect(issues[0]?.reason).toMatch(/not valid JSON/i);
  });
});

describe("transpileConfig — supported constructs", () => {
  it("maps a plain string property to a text field with label and max length", () => {
    const form = transpileConfig(
      docWith(
        { name: { type: "string", maxLength: 80 } },
        {
          elements: [{ type: "Control", scope: "#/properties/name", label: "Full name" }],
          required: ["name"],
        },
      ),
    );

    expect(form.fields).toEqual([
      { name: "name", label: "Full name", type: "text", required: true, maxLength: 80 },
    ]);
  });

  it("defaults the label to the property title, then to the property name", () => {
    const form = transpileConfig(
      docWith({
        titled: { type: "string", title: "Your age" },
        bare: { type: "boolean" },
      }),
    );

    expect(form.fields.map((field) => [field.name, field.label])).toEqual([
      ["titled", "Your age"],
      ["bare", "bare"],
    ]);
  });

  it("maps a multi-line Control to a textarea field", () => {
    const form = transpileConfig(
      docWith(
        { bio: { type: "string" } },
        {
          elements: [
            { type: "Control", scope: "#/properties/bio", label: "Bio", options: { multi: true } },
          ],
        },
      ),
    );

    expect(form.fields[0]).toMatchObject({ name: "bio", type: "textarea", label: "Bio" });
  });

  it("maps a number property honoring minimum and maximum", () => {
    const form = transpileConfig(docWith({ age: { type: "number", minimum: 18, maximum: 120 } }));

    expect(form.fields).toEqual([
      { name: "age", label: "age", type: "number", required: false, min: 18, max: 120 },
    ]);
  });

  it("maps a date-formatted string honoring formatMinimum and formatMaximum", () => {
    const form = transpileConfig(
      docWith(
        {
          startsOn: {
            type: "string",
            format: "date",
            formatMinimum: "2026-01-01",
            formatMaximum: "2026-12-31",
          },
        },
        { elements: [{ type: "Control", scope: "#/properties/startsOn", label: "Starts on" }] },
      ),
    );

    expect(form.fields).toEqual([
      {
        name: "startsOn",
        label: "Starts on",
        type: "date",
        required: false,
        minDate: "2026-01-01",
        maxDate: "2026-12-31",
      },
    ]);
  });

  it("maps a boolean property", () => {
    const form = transpileConfig(docWith({ subscribe: { type: "boolean" } }));

    expect(form.fields).toEqual([
      { name: "subscribe", label: "subscribe", type: "boolean", required: false },
    ]);
  });

  it("maps a string enum property to a select field with choices in order", () => {
    const form = transpileConfig(
      docWith({ plan: { type: "string", enum: ["free", "pro", "team"] } }),
    );

    expect(form.fields).toEqual([
      { name: "plan", label: "plan", type: "select", required: false, choices: ["free", "pro", "team"] },
    ]);
  });

  it("maps an array of string enums to a multiselect field", () => {
    const form = transpileConfig(
      docWith({
        tags: { type: "array", items: { type: "string", enum: ["red", "green", "blue"] } },
      }),
    );

    expect(form.fields).toEqual([
      {
        name: "tags",
        label: "tags",
        type: "multiselect",
        required: false,
        choices: ["red", "green", "blue"],
      },
    ]);
  });

  it("carries the root title and description into the Form", () => {
    const form = transpileConfig(
      docWith({ name: { type: "string" } }, { title: "Feedback", description: "Tell us more" }),
    );

    expect(form.title).toBe("Feedback");
    expect(form.description).toBe("Tell us more");
  });

  it("keeps fields in schema property order regardless of UI Schema element order", () => {
    const form = transpileConfig(
      docWith(
        { first: { type: "string" }, second: { type: "boolean" } },
        {
          elements: [
            { type: "Control", scope: "#/properties/second", label: "Second" },
            { type: "Control", scope: "#/properties/first", label: "First" },
          ],
        },
      ),
    );

    expect(form.fields.map((field) => field.name)).toEqual(["first", "second"]);
    expect(form.fields.map((field) => field.label)).toEqual(["First", "Second"]);
  });

  it("transpile-then-compile preserves schema semantics for the supported subset", () => {
    const document = docWith(
      {
        fullName: { type: "string", maxLength: 80 },
        age: { type: "number", minimum: 18, maximum: 120 },
        startsOn: { type: "string", format: "date" },
        subscribe: { type: "boolean" },
        plan: { type: "string", enum: ["free", "pro"] },
        tags: { type: "array", items: { type: "string", enum: ["red", "green"] } },
      },
      {
        title: "Feedback",
        description: "Tell us what you think",
        required: ["fullName", "plan"],
        elements: [
          { type: "Control", scope: "#/properties/fullName", label: "Full name" },
          { type: "Control", scope: "#/properties/tags", label: "Tags", options: { multi: true } },
          { type: "Control", scope: "#/properties/startsOn", label: "Starts on" },
        ],
      },
    );

    const expected: CompiledForm = compileForm({
      title: "Feedback",
      description: "Tell us what you think",
      fields: [
        { name: "fullName", label: "Full name", type: "text", required: true, maxLength: 80 },
        { name: "age", label: "age", type: "number", min: 18, max: 120 },
        { name: "startsOn", label: "Starts on", type: "date" },
        { name: "subscribe", label: "subscribe", type: "boolean" },
        { name: "plan", label: "plan", type: "select", required: true, choices: ["free", "pro"] },
        { name: "tags", label: "Tags", type: "multiselect", choices: ["red", "green"] },
      ],
    });

    const compiled = compileForm(transpileConfig(document));
    expect(compiled).toEqual(expected);
  });

  it("produces a Form whose submissions shape like builder-authored Forms", () => {
    const form = transpileConfig(
      docWith(
        { email: { type: "string", maxLength: 254 }, plan: { type: "string", enum: ["free", "pro"] } },
        { required: ["email", "plan"] },
      ),
    );

    const submission = shapeSubmission(form, { email: "ada@example.com", plan: "pro" }, () => new Date(0));
    expect(submission.submittedAt).toBe("1970-01-01T00:00:00.000Z");
    expect(submission.email).toBe("ada@example.com");
    expect(submission.plan).toBe("pro");
  });
});

describe("transpileConfig — unsupported constructs are rejected loudly", () => {
  it("rejects nested objects listing each nested leaf path", () => {
    const paths = pathsOf(
      docWith({
        address: {
          type: "object",
          properties: { city: { type: "string" }, zip: { type: "string" } },
        },
      }),
    );

    expect(paths).toEqual(expect.arrayContaining(["$.address.city", "$.address.zip"]));
  });

  it("reports a nested object without properties at its own path", () => {
    expect(pathsOf(docWith({ meta: { type: "object" } }))).toEqual(["$.meta"]);
  });

  it("rejects arrays nested inside objects instead of flattening them into fields", () => {
    const paths = pathsOf(
      docWith({
        address: {
          type: "object",
          properties: { tags: { type: "array", items: { type: "string", enum: ["red"] } } },
        },
      }),
    );

    expect(paths).toEqual(["$.address.tags"]);

    const form: Form | undefined = (() => {
      try {
        return transpileConfig(
          docWith({
            address: {
              type: "object",
              properties: { tags: { type: "array", items: { type: "string", enum: ["red"] } } },
            },
          }),
        );
      } catch {
        return undefined;
      }
    })();
    expect(form).toBeUndefined();
  });

  it("rejects array-of-object properties at the exact item paths", () => {
    const paths = pathsOf(
      docWith({
        children: {
          type: "array",
          items: { type: "object", properties: { name: { type: "string" } } },
        },
      }),
    );

    expect(paths).toEqual(["$.children.items.name"]);
  });

  it("rejects arrays whose items are objects without properties", () => {
    expect(pathsOf(docWith({ children: { type: "array", items: { type: "object" } } }))).toEqual([
      "$.children.items",
    ]);
  });

  it("rejects oneOf and anyOf variants at the property path", () => {
    expect(pathsOf(docWith({ flexible: { oneOf: [{ type: "string" }, { type: "number" }] } }))).toEqual([
      "$.flexible",
    ]);
    expect(pathsOf(docWith({ either: { anyOf: [{ type: "string" }, { type: "null" }] } }))).toEqual([
      "$.either",
    ]);
  });

  it("rejects conditional schema keywords at the root and inside properties", () => {
    const rootDoc = {
      schema: {
        type: "object",
        if: { properties: { plan: { const: "pro" } } },
        then: { required: ["card"] },
        properties: { plan: { type: "string" } },
      },
      uiSchema: { type: "VerticalLayout", elements: [] },
    };
    expect(pathsOf(rootDoc)).toEqual(["$.schema.if", "$.schema.then"]);

    const propertyDoc = docWith({
      card: { type: "string", allOf: [{ minLength: 3 }] },
    });
    expect(pathsOf(propertyDoc)).toEqual(["$.card.allOf"]);
  });

  it("rejects UI Schema rule elements and non-Control elements", () => {
    const ruled = docWith(
      { name: { type: "string" } },
      {
        elements: [
          {
            type: "Control",
            scope: "#/properties/name",
            rule: { effect: "SHOW", condition: {} },
          },
        ],
      },
    );
    expect(pathsOf(ruled)).toEqual(["uiSchema.elements[0]"]);

    const labeled = docWith(
      { name: { type: "string" } },
      { elements: [{ type: "Label", text: "Hello" }] },
    );
    expect(issuesOf(labeled)[0]?.path).toBe("uiSchema.elements[0]");
  });

  it("aggregates every unsupported construct into one error instead of failing fast", () => {
    const issues = issuesOf(
      docWith({
        address: { type: "object", properties: { city: { type: "string" } } },
        flexible: { oneOf: [{ type: "string" }] },
        children: { type: "array", items: { type: "object" } },
      }),
    );

    expect(issues.map((issue) => issue.path)).toEqual([
      "$.address.city",
      "$.flexible",
      "$.children.items",
    ]);
  });
});

describe("transpileConfig — invalid documents fail with useful errors", () => {
  it.each([
    ["a string", "nope"],
    ["null", null],
    ["an array", []],
    ["a number", 42],
  ])("rejects documents that are %s", (_label, document) => {
    expect(pathsOf(document)).toEqual(["$"]);
  });

  it("requires both schema and uiSchema", () => {
    expect(pathsOf({ schema: { type: "object", properties: {} } })).toEqual(["$.uiSchema"]);
    expect(pathsOf({ uiSchema: { type: "VerticalLayout", elements: [] } })).toEqual(["$.schema"]);
  });

  it("requires the root schema to be an object with at least one property", () => {
    const noType = {
      schema: { properties: { a: { type: "string" } } },
      uiSchema: { type: "VerticalLayout", elements: [] },
    };
    expect(pathsOf(noType)).toContain("$.schema.type");

    expect(pathsOf(docWith({}))).toContain("$.schema.properties");

    const wrongType = docWith({ a: { type: "string" } });
    (wrongType as { schema: Record<string, unknown> }).schema.type = "array";
    expect(pathsOf(wrongType)).toContain("$.schema.type");
  });

  it("enforces field name rules with exact paths", () => {
    expect(() =>
      transpileConfig(docWith({ "first-name": { type: "string" } })),
    ).toThrow(ConfigImportError);
    expect(issuesOf(docWith({ submittedAt: { type: "string" } }))[0]?.reason).toMatch(/reserved/i);
  });

  it("rejects required entries that reference unknown properties", () => {
    expect(pathsOf(docWith({ name: { type: "string" } }, { required: ["name", "ghost"] }))).toEqual([
      "$.schema.required[1]",
    ]);
  });

  it("rejects constraints outside the Field subset at their exact keyword paths", () => {
    expect(
      issuesOf(docWith({ contact: { type: "string", format: "email" } }))[0],
    ).toMatchObject({ path: "$.contact.format" });
    expect(issuesOf(docWith({ password: { type: "string", minLength: 8 } }))[0]).toMatchObject({
      path: "$.password.minLength",
    });
    expect(issuesOf(docWith({ rate: { type: "number", exclusiveMinimum: 0 } }))[0]).toMatchObject({
      path: "$.rate.exclusiveMinimum",
    });
    expect(issuesOf(docWith({ count: { type: "integer" } }))[0]).toMatchObject({
      path: "$.count",
    });
    expect(issuesOf(docWith({ level: { type: "string", enum: [1, 2] } }))[0]).toMatchObject({
      path: "$.level.enum",
    });
    expect(issuesOf(docWith({ weird: { type: ["string", "null"] } }))[0]).toMatchObject({
      path: "$.weird",
    });
    expect(issuesOf(docWith({ mystery: {} }))[0]).toMatchObject({ path: "$.mystery" });
  });

  it("rejects Controls that do not bind to a top-level schema property exactly once", () => {
    const duplicate = docWith(
      { name: { type: "string" } },
      {
        elements: [
          { type: "Control", scope: "#/properties/name", label: "A" },
          { type: "Control", scope: "#/properties/name", label: "B" },
        ],
      },
    );
    expect(pathsOf(duplicate)).toEqual(["uiSchema.elements[1]"]);

    const unknown = docWith(
      { name: { type: "string" } },
      { elements: [{ type: "Control", scope: "#/properties/ghost" }] },
    );
    expect(issuesOf(unknown)[0]).toMatchObject({ path: "uiSchema.elements[0]" });

    const nestedScope = docWith(
      { name: { type: "string" } },
      { elements: [{ type: "Control", scope: "#/properties/name/properties/deep" }] },
    );
    expect(issuesOf(nestedScope)[0]).toMatchObject({ path: "uiSchema.elements[0]" });
  });

  it("rejects malformed constraint values at their keyword paths", () => {
    expect(issuesOf(docWith({ name: { type: "string", maxLength: 0 } }))[0]).toMatchObject({
      path: "$.name.maxLength",
    });
    expect(issuesOf(docWith({ age: { type: "number", minimum: "low" } }))[0]).toMatchObject({
      path: "$.age.minimum",
    });
    expect(
      issuesOf(
        docWith(
          { d: { type: "string", format: "date", formatMinimum: "01/01/2026" } },
          { elements: [{ type: "Control", scope: "#/properties/d", label: "D" }] },
        ),
      )[0],
    ).toMatchObject({ path: "$.d.formatMinimum" });
  });

  it("never returns a partial Form when any issue exists", () => {
    const form: Form | undefined = (() => {
      try {
        return transpileConfig(
          docWith({
            ok: { type: "string" },
            broken: { type: "object", properties: { deep: { type: "string" } } },
          }),
        );
      } catch {
        return undefined;
      }
    })();

    expect(form).toBeUndefined();
  });
});

describe("transpileForm — split inputs", () => {
  it("maps split schema and uiSchema documents to the same Form the combined path produced", () => {
    const form = transpileForm(
      schemaWith(
        { email: { type: "string", maxLength: 254 }, seats: { type: "number", minimum: 1 } },
        { required: ["email"] },
      ),
      uiSchemaWith([
        { type: "Control", scope: "#/properties/email", label: "Email address" },
        { type: "Control", scope: "#/properties/seats" },
      ]),
    );

    expect(form.fields).toEqual([
      { name: "email", label: "Email address", type: "text", required: true, maxLength: 254 },
      { name: "seats", label: "seats", type: "number", required: false, min: 1 },
    ]);
  });
});

describe("transpileForm — path rooting", () => {
  it("roots schema-side issues at $ of the pasted Schema JSON with a Schema JSON prefix", () => {
    expect(
      pathsOfSplit(
        schemaWith({ age: { type: "number", minimum: "low" } }, { required: ["age", "ghost"] }),
        uiSchemaWith(defaultControls({ age: {} })),
      ),
    ).toEqual(["Schema JSON: $.age.minimum", "Schema JSON: $.required[1]"]);
  });

  it("re-roots root-schema keyword problems from $.schema.x to $.x", () => {
    expect(
      pathsOfSplit(
        { properties: { name: { type: "string" } } },
        uiSchemaWith(defaultControls({ name: {} })),
      ),
    ).toEqual(["Schema JSON: $.type"]);
  });

  it("roots UI-side issues at $.elements[i] of the pasted UI Schema JSON", () => {
    expect(
      pathsOfSplit(schemaWith({ name: { type: "string" } }), uiSchemaWith([
        { type: "Label", text: "Hello" },
      ]))[0],
    ).toBe("UI Schema JSON: $.elements[0]");
  });
});

describe("transpileForm — Combined Document rejection", () => {
  it("rejects a full {schema, uiSchema} blob pasted as Schema JSON", () => {
    const [issue] = issuesOfSplit(
      docWith({ name: { type: "string" } }),
      uiSchemaWith(defaultControls({ name: {} })),
    );

    expect(issue?.path).toBe("Schema JSON: $");
    expect(issue?.reason).toMatch(/combined/i);
    expect(issue?.reason).toMatch(/"schema"/);
  });

  it("rejects a full {schema, uiSchema} blob pasted as UI Schema JSON", () => {
    const [issue] = issuesOfSplit(schemaWith({ name: { type: "string" } }), docWith({ name: { type: "string" } }));

    expect(issue?.path).toBe("UI Schema JSON: $");
    expect(issue?.reason).toMatch(/combined/i);
    expect(issue?.reason).toMatch(/"uiSchema"/);
  });

  it("reports both rejected inputs together when both hold Combined Documents", () => {
    expect(pathsOfSplit(docWith({ name: { type: "string" } }), docWith({ name: { type: "string" } }))).toEqual([
      "Schema JSON: $",
      "UI Schema JSON: $",
    ]);
  });

  it("does not mistake a schema with a property named schema for a Combined Document", () => {
    const form = transpileForm(
      schemaWith({ schema: { type: "string" } }),
      uiSchemaWith(defaultControls({ schema: {} })),
    );

    expect(form.fields).toHaveLength(1);
  });
});

describe("transpileForm — invalid inputs fail with useful errors", () => {
  it.each([
    ["a string", "nope"],
    ["null", null],
    ["an array", []],
    ["a number", 42],
  ])("rejects a Schema JSON that is %s", (_label, document) => {
    const [issue] = issuesOfSplit(document, uiSchemaWith([]));

    expect(issue).toBeDefined();
    expect(issue?.path).toBe("Schema JSON: $");
  });

  it.each([
    ["a string", "nope"],
    ["null", null],
    ["an array", []],
    ["a number", 42],
  ])("rejects a UI Schema JSON that is %s", (_label, document) => {
    const [issue] = issuesOfSplit(schemaWith({ name: { type: "string" } }), document);

    expect(issue).toBeDefined();
    expect(issue?.path).toBe("UI Schema JSON: $");
  });
});
