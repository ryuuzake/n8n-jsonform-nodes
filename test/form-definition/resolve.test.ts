import { describe, expect, it } from "vitest";
import {
  DuplicateFieldNameError,
  FieldNamePatternError,
  InvalidConstraintError,
  MissingChoicesError,
  ReservedFieldNameError,
} from "../../src/form-definition/errors";
import { resolveFields, resolveForm } from "../../src/form-definition/resolve";
import type { Field } from "../../src/form-definition/types";

const text = (name: string): Field => ({ name, label: "Label", type: "text" });

describe("resolveFields", () => {
  it("normalizes a text field, defaulting required to false", () => {
    expect(resolveFields([{ name: "full_name", label: "Full name", type: "text" }])).toEqual([
      { name: "full_name", label: "Full name", type: "text", required: false },
    ]);
  });

  it("rejects names that are not identifiers", () => {
    for (const bad of ["1st_field", "first-name", "first name", "", "a.b"]) {
      expect(() => resolveFields([text(bad)]), `expected rejection of ${JSON.stringify(bad)}`).toThrow(
        FieldNamePatternError,
      );
    }
  });

  it("rejects the reserved name submittedAt", () => {
    expect(() => resolveFields([text("submittedAt")])).toThrow(ReservedFieldNameError);
  });

  it("treats the reservation as case-sensitive", () => {
    expect(() => resolveFields([text("SubmittedAt")])).not.toThrow();
  });

  it("rejects duplicate names", () => {
    expect(() => resolveFields([text("email"), text("email")])).toThrow(DuplicateFieldNameError);
  });

  it("reports which field violated the rule", () => {
    try {
      resolveFields([text("good"), text("bad-name")]);
      expect.unreachable("expected FieldNamePatternError");
    } catch (error) {
      expect(error).toBeInstanceOf(FieldNamePatternError);
      expect((error as FieldNamePatternError).index).toBe(1);
    }
  });

  it("rejects select fields without choices", () => {
    expect(() =>
      resolveFields([{ name: "color", label: "Color", type: "select" }]),
    ).toThrow(MissingChoicesError);
    expect(() =>
      resolveFields([{ name: "color", label: "Color", type: "select", choices: [] }]),
    ).toThrow(MissingChoicesError);
  });

  it("rejects multiselect fields without choices", () => {
    expect(() =>
      resolveFields([{ name: "tags", label: "Tags", type: "multiselect" }]),
    ).toThrow(MissingChoicesError);
  });

  it("rejects a non-positive maxLength on text fields", () => {
    for (const maxLength of [0, -5]) {
      expect(() => resolveFields([{ name: "bio", label: "Bio", type: "text", maxLength }])).toThrow(
        InvalidConstraintError,
      );
    }
  });

  it("rejects a non-positive or fractional minLength on text fields", () => {
    for (const minLength of [0, -1, 2.5]) {
      expect(() => resolveFields([{ name: "bio", label: "Bio", type: "text", minLength }])).toThrow(
        InvalidConstraintError,
      );
    }
    for (const type of ["text", "textarea"] as const) {
      expect(() =>
        resolveFields([{ name: "bio", label: "Bio", type, minLength: 3 }]),
      ).not.toThrow();
    }
  });

  it("rejects a minLength exceeding the maxLength on the same field", () => {
    expect(() =>
      resolveFields([
        { name: "code", label: "Code", type: "text", minLength: 6, maxLength: 4 },
      ]),
    ).toThrow(InvalidConstraintError);
  });

  it("rejects visibility conditions referencing unknown fields or themselves", () => {
    expect(() =>
      resolveFields([
        {
          name: "other",
          label: "Other",
          type: "text",
          visibleWhen: { field: "ghost", equals: true },
        },
      ]),
    ).toThrow(InvalidConstraintError);

    expect(() =>
      resolveFields([
        {
          name: "self",
          label: "Self",
          type: "text",
          visibleWhen: { field: "self", equals: "yes" },
        },
      ]),
    ).toThrow(InvalidConstraintError);
  });

  it("rejects visibility conditions whose comparison value is not a primitive", () => {
    expect(() =>
      resolveFields([
        {
          name: "conditional",
          label: "Conditional",
          type: "text",
          visibleWhen: { field: "trigger", equals: { deep: true } as unknown as string },
        },
      ]),
    ).toThrow(InvalidConstraintError);
  });

  it("carries minLength and visibleWhen onto resolved fields", () => {
    expect(
      resolveFields([
        { name: "vegetarian", label: "Vegetarian", type: "boolean" },
        {
          name: "other_vegetable",
          label: "Other vegetable",
          type: "text",
          minLength: 2,
          maxLength: 40,
          visibleWhen: { field: "vegetarian", equals: true },
        },
      ]),
    ).toEqual([
      { name: "vegetarian", label: "Vegetarian", type: "boolean", required: false },
      {
        name: "other_vegetable",
        label: "Other vegetable",
        type: "text",
        required: false,
        minLength: 2,
        maxLength: 40,
        visibleWhen: { field: "vegetarian", equals: true },
      },
    ]);
  });

  it("rejects inverted number bounds", () => {
    expect(() =>
      resolveFields([{ name: "age", label: "Age", type: "number", min: 10, max: 2 }]),
    ).toThrow(InvalidConstraintError);
  });

  it("rejects malformed or inverted date bounds", () => {
    expect(() =>
      resolveFields([
        { name: "when", label: "When", type: "date", minDate: "2026-13-01" },
      ]),
    ).toThrow(InvalidConstraintError);
    expect(() =>
      resolveFields([
        { name: "when", label: "When", type: "date", minDate: "2026-02-10", maxDate: "2026-02-01" },
      ]),
    ).toThrow(InvalidConstraintError);
  });
});

describe("resolveForm", () => {
  it("resolves the form's fields and keeps title and description", () => {
    expect(
      resolveForm({
        title: "Feedback",
        description: "Tell us everything",
        fields: [{ name: "rating", label: "Rating", type: "number", required: true, min: 1, max: 5 }],
      }),
    ).toEqual({
      title: "Feedback",
      description: "Tell us everything",
      fields: [
        { name: "rating", label: "Rating", type: "number", required: true, min: 1, max: 5 },
      ],
    });
  });

  it("enforces the same field rules", () => {
    expect(() => resolveForm({ fields: [text("submittedAt")] })).toThrow(ReservedFieldNameError);
  });
});
