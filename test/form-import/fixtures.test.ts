import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { Form } from "../../src/form-definition";
import {
  SubmissionShapeError,
  shapeDocumentSubmission,
} from "../../src/form-definition";
import { ConfigImportError } from "../../src/form-import";
import { resolveEffectiveForm } from "../../nodes/JsonForm/effectiveForm";

/**
 * The regression fixtures behind the original rejection report: nested
 * objects, minLength constraints, UI rules, and a Categorization layout with
 * a stepper variant. Imports must pass these documents through verbatim.
 */
const schemaJson = readFileSync(
  path.join(process.cwd(), "test", "fixtures", "schema.json"),
  "utf8",
);
const uiSchemaJson = readFileSync(
  path.join(process.cwd(), "test", "fixtures", "ui-schema.json"),
  "utf8",
);

const EMPTY_BUILDER_FORM: Form = { fields: [] };

/** A complete, valid submission against the fixture schema. */
const VALID_FIXTURE_SUBMISSION = {
  firstName: "Ada",
  secondName: "Lovelace",
  vegetarian: true,
  birthDate: "1990-12-10",
  nationality: "DE",
  provideAddress: true,
  address: {
    street: "Main Street",
    streetNumber: "1",
    city: "Springfield",
    postalCode: "12345",
  },
  vegetarianOptions: {
    vegan: false,
    favoriteVegetable: "Other",
    otherFavoriteVegetable: "Jerusalem artichoke",
  },
};

describe("fixture imports", () => {
  it("accepts the fixture Schema JSON / UI Schema JSON pair verbatim", () => {
    const resolved = resolveEffectiveForm(
      EMPTY_BUILDER_FORM,
      schemaJson,
      uiSchemaJson,
    );

    expect(resolved).toEqual({
      kind: "imported",
      documents: {
        schema: JSON.parse(schemaJson),
        uiSchema: JSON.parse(uiSchemaJson),
      },
    });
  });

  it("keeps every construct that the old Field subset used to reject", () => {
    const resolved = resolveEffectiveForm(EMPTY_BUILDER_FORM, schemaJson, uiSchemaJson);
    if (resolved.kind !== "imported") throw new Error("expected an imported document");

    const properties = resolved.documents.schema.properties as Record<string, unknown>;

    // minLength constraints survive…
    expect(properties.firstName).toMatchObject({ minLength: 3 });
    // …nested objects stay nested…
    expect(properties.address).toMatchObject({ type: "object" });
    expect(properties.vegetarianOptions).toMatchObject({ type: "object" });
    // …and the Categorization stepper layout with its SHOW rules is intact.
    const uiSchema = resolved.documents.uiSchema as {
      type: string;
      options?: Record<string, unknown>;
      elements: Array<{
        type: string;
        rule?: unknown;
        elements: Array<{ rule?: unknown; elements?: Array<{ rule?: unknown }> }>;
      }>;
    };
    expect(uiSchema.type).toBe("Categorization");
    expect(uiSchema.options).toEqual({ variant: "stepper", showNavButtons: true });
    expect(uiSchema.elements.every((category) => category.type === "Category")).toBe(true);
    expect(uiSchema.elements[1]?.rule).toBeDefined();
    const additional = uiSchema.elements[2];
    expect(additional?.rule).toBeDefined();
    expect(additional?.elements[2]?.rule).toBeDefined();
  });

  it("shapes a complete submission with nesting intact", () => {
    const resolved = resolveEffectiveForm(EMPTY_BUILDER_FORM, schemaJson, uiSchemaJson);
    if (resolved.kind !== "imported") throw new Error("expected an imported document");

    const submission = shapeDocumentSubmission(
      resolved.documents.schema,
      VALID_FIXTURE_SUBMISSION,
      () => new Date(0),
    );

    expect(submission.submittedAt).toBe("1970-01-01T00:00:00.000Z");
    expect(submission.address).toEqual(VALID_FIXTURE_SUBMISSION.address);
    expect(submission.vegetarianOptions).toEqual(VALID_FIXTURE_SUBMISSION.vegetarianOptions);
  });

  it("enforces minLength from the pasted schema on POST bodies", () => {
    const resolved = resolveEffectiveForm(EMPTY_BUILDER_FORM, schemaJson, uiSchemaJson);
    if (resolved.kind !== "imported") throw new Error("expected an imported document");

    try {
      shapeDocumentSubmission(
        resolved.documents.schema,
        { ...VALID_FIXTURE_SUBMISSION, firstName: "ab" },
        () => new Date(0),
      );
      expect.unreachable("expected SubmissionShapeError");
    } catch (error) {
      expect(error).toBeInstanceOf(SubmissionShapeError);
      const issues = (error as SubmissionShapeError).issues;
      expect(issues.some((issue) => issue.field === "firstName")).toBe(true);
    }
  });

  it("still rejects structurally unsound halves instead of serving them", () => {
    const brokenUiSchema = JSON.stringify({ elements: [] });

    expect(() =>
      resolveEffectiveForm(EMPTY_BUILDER_FORM, schemaJson, brokenUiSchema),
    ).toThrow(ConfigImportError);
  });
});
