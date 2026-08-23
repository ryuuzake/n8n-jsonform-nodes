import { describe, expect, it } from "vitest";

import {
  ConfigImportError,
  importCombinedDocument,
  importSplitDocuments,
  parseImportDocument,
} from "../../src/form-import";
import type { ConfigImportIssue } from "../../src/form-import";

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
    importCombinedDocument(doc);
  } catch (error) {
    if (!(error instanceof ConfigImportError)) throw error;
    return error.issues.map((issue) => ({ path: issue.path, reason: issue.reason }));
  }
  throw new Error("expected ConfigImportError");
};

const pathsOf = (doc: unknown): string[] => issuesOf(doc).map((issue) => issue.path);

/** The issues a split structural validation rejects with, or an empty array on success. */
const issuesOfSplit = (schema: unknown, uiSchema: unknown): ConfigImportIssue[] => {
  try {
    importSplitDocuments(schema, uiSchema);
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

describe("importCombinedDocument — passthrough", () => {
  it("serves a rich JSONForms document verbatim instead of transpiling it", () => {
    // Every construct the old Field subset rejected must survive untouched.
    const document = docWith(
      {
        firstName: { type: "string", minLength: 3 },
        address: {
          type: "object",
          properties: { street: { type: "string" }, postalCode: { type: "string", maxLength: 5 } },
        },
        vegetarianOptions: {
          type: "object",
          properties: {
            favoriteVegetable: { type: "string", enum: ["Tomato", "Other"] },
            otherFavoriteVegetable: { type: "string" },
          },
        },
      },
      {
        elements: [
          {
            type: "Categorization",
            options: { variant: "stepper", showNavButtons: true },
            elements: [
              {
                type: "Category",
                label: "Main",
                elements: [
                  {
                    type: "HorizontalLayout",
                    elements: [{ type: "Control", scope: "#/properties/firstName" }],
                  },
                ],
              },
              {
                type: "Category",
                label: "Extra",
                rule: {
                  effect: "SHOW",
                  condition: {
                    scope: "#/properties/vegetarian",
                    schema: { const: true },
                  },
                },
                elements: [
                  {
                    type: "Control",
                    scope:
                      "#/properties/vegetarianOptions/properties/favoriteVegetable",
                  },
                ],
              },
            ],
          },
        ],
      },
    );

    const documents = importCombinedDocument(document);

    // Passthrough means byte-for-byte fidelity: no rewriting, no dropping.
    expect(documents.schema).toEqual((document as { schema: unknown }).schema);
    expect(documents.uiSchema).toEqual((document as { uiSchema: unknown }).uiSchema);
  });
});

describe("importCombinedDocument — structural rejections", () => {
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

  it("requires the root schema to be an object schema with at least one property", () => {
    expect(pathsOf(docWith({}))).toContain("$.schema.properties");

    const wrongType = docWith({ a: { type: "string" } }) as {
      schema: Record<string, unknown>;
    };
    wrongType.schema.type = "array";
    expect(pathsOf(wrongType)).toContain("$.schema.type");
  });

  it("rejects a uiSchema without a type so a broken page can never be served", () => {
    const document = docWith({ name: { type: "string" } }) as {
      uiSchema: Record<string, unknown>;
    };
    delete document.uiSchema.type;
    expect(issuesOf(document)[0]).toMatchObject({ path: "$.uiSchema.type" });
  });

  it("rejects required entries that reference unknown properties", () => {
    expect(pathsOf(docWith({ name: { type: "string" } }, { required: ["name", "ghost"] }))).toEqual([
      "$.schema.required[1]",
    ]);
  });

  it("rejects a property named submittedAt, which the system sets on every submission", () => {
    expect(pathsOf(docWith({ submittedAt: { type: "string" } }))).toEqual([
      "$.schema.properties.submittedAt",
    ]);
    expect(issuesOf(docWith({ submittedAt: { type: "string" } }))[0]?.reason).toMatch(
      /submittedAt/,
    );
  });

  it("aggregates every structural problem into one report instead of failing fast", () => {
    const issues = issuesOf({
      schema: {
        type: "array",
        properties: { submittedAt: { type: "string" }, name: { type: "string" } },
        required: ["ghost"],
      },
      uiSchema: {},
    });

    expect(issues.map((issue) => issue.path)).toEqual([
      "$.schema.type",
      "$.schema.required[0]",
      "$.schema.properties.submittedAt",
      "$.uiSchema.type",
    ]);
  });
});

describe("importSplitDocuments — passthrough", () => {
  /** The Schema JSON half for the split-input tests below. */
  const schemaWith = (
    properties: Record<string, unknown>,
    overrides: { required?: string[]; title?: string } = {},
  ): unknown => ({
    type: "object",
    ...(overrides.title !== undefined ? { title: overrides.title } : {}),
    properties,
    ...(overrides.required ? { required: overrides.required } : {}),
  });

  it("returns both pasted documents untouched", () => {
    const schema = schemaWith(
      { email: { type: "string", maxLength: 254 } },
      { required: ["email"] },
    );
    const uiSchema = {
      type: "VerticalLayout",
      elements: [{ type: "Control", scope: "#/properties/email", label: "Email" }],
    };

    const documents = importSplitDocuments(schema, uiSchema);

    expect(documents.schema).toBe(schema);
    expect(documents.uiSchema).toBe(uiSchema);
  });
});

describe("importSplitDocuments — structural rejections carry their input prefix", () => {
  const schemaWith = (properties: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
    type: "object",
    properties,
    ...extra,
  });

  const uiSchemaWith = (extra: Record<string, unknown> = {}) => ({
    type: "VerticalLayout",
    elements: [],
    ...extra,
  });

  it.each([
    ["a string", "nope"],
    ["null", null],
    ["an array", []],
    ["a number", 42],
  ])("rejects a Schema JSON that is %s at its own root", (_label, document) => {
    const [issue] = issuesOfSplit(document, uiSchemaWith());

    expect(issue?.path).toBe("Schema JSON: $");
  });

  it.each([
    ["a string", "nope"],
    ["null", null],
    ["an array", []],
    ["a number", 42],
  ])("rejects a UI Schema JSON that is %s at its own root", (_label, document) => {
    const [issue] = issuesOfSplit(schemaWith({ name: { type: "string" } }), document);

    expect(issue?.path).toBe("UI Schema JSON: $");
  });

  it("roots schema-side problems under the Schema JSON prefix", () => {
    expect(
      pathsOfSplit(
        schemaWith({ name: { type: "string" } }, { required: ["ghost"] }),
        uiSchemaWith(),
      ),
    ).toEqual(["Schema JSON: $.required[0]"]);
  });

  it("roots uiSchema-side problems under the UI Schema JSON prefix", () => {
    expect(pathsOfSplit(schemaWith({ name: { type: 'string' } }), {})).toEqual([
      "UI Schema JSON: $.type",
    ]);
  });

  it("reports both rejected inputs together when both are structurally broken", () => {
    expect(pathsOfSplit({ properties: {} }, { elements: [] })).toEqual([
      "Schema JSON: $.type",
      "Schema JSON: $.properties",
      "UI Schema JSON: $.type",
    ]);
  });
});

describe("importSplitDocuments — Combined Document rejection", () => {
  const fullDoc = docWith({ name: { type: "string" } });

  it("rejects a full {schema, uiSchema} blob pasted as Schema JSON", () => {
    const [issue] = issuesOfSplit(fullDoc, uiSchemaOf(fullDoc));

    expect(issue?.path).toBe("Schema JSON: $");
    expect(issue?.reason).toMatch(/combined/i);
    expect(issue?.reason).toMatch(/"schema"/);
  });

  it("rejects a full {schema, uiSchema} blob pasted as UI Schema JSON", () => {
    const [issue] = issuesOfSplit(schemaSide(fullDoc), fullDoc);

    expect(issue?.path).toBe("UI Schema JSON: $");
    expect(issue?.reason).toMatch(/combined/i);
    expect(issue?.reason).toMatch(/"uiSchema"/);
  });

  it("reports both rejected inputs together when both hold Combined Documents", () => {
    expect(pathsOfSplit(fullDoc, fullDoc)).toEqual(["Schema JSON: $", "UI Schema JSON: $"]);
  });

  it("does not mistake a schema with a property named schema for a Combined Document", () => {
    const documents = importSplitDocuments(
      { type: "object", properties: { schema: { type: "string" } } },
      { type: "VerticalLayout", elements: [] },
    );

    expect(documents.schema).toBeDefined();
  });
});

function uiSchemaOf(document: unknown): unknown {
  return (document as { uiSchema: unknown }).uiSchema;
}

function schemaSide(document: unknown): unknown {
  return (document as { schema: unknown }).schema;
}
