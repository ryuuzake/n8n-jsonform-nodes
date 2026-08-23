import { describe, expect, it } from "vitest";
import { compileForm } from "../../src/form-definition/compile";
import { ReservedFieldNameError } from "../../src/form-definition/errors";
import { formWith } from "../helpers";


describe("compileForm — schema per field type", () => {
  it("compiles a plain text field to a string property and a labeled control", () => {
    const { schema, uiSchema } = compileForm(
      formWith({ name: "full_name", label: "Full name", type: "text" }),
    );

    expect(schema).toEqual({
      type: "object",
      properties: { full_name: { type: "string" } },
    });
    expect(uiSchema).toEqual({
      type: "VerticalLayout",
      elements: [{ type: "Control", scope: "#/properties/full_name", label: "Full name" }],
    });
  });

  it("honors maxLength on text fields", () => {
    const { schema } = compileForm(
      formWith({ name: "bio", label: "Bio", type: "text", maxLength: 200 }),
    );
    expect(schema.properties).toEqual({ bio: { type: "string", maxLength: 200 } });
  });

  it("honors minLength alongside maxLength on text fields", () => {
    const { schema, uiSchema } = compileForm(
      formWith({
        name: "code",
        label: "Code",
        type: "text",
        minLength: 4,
        maxLength: 12,
      }),
    );
    expect(schema.properties).toEqual({ code: { type: "string", minLength: 4, maxLength: 12 } });
    expect(uiSchema.elements[0]).toMatchObject({ scope: "#/properties/code" });
  });

  it("emits a SHOW rule for a field with a visibility condition", () => {
    const { uiSchema } = compileForm(
      formWith(
        { name: "vegetarian", label: "Vegetarian", type: "boolean" },
        {
          name: "favorite_vegetable",
          label: "Favorite vegetable",
          type: "select",
          choices: ["Tomato", "Other"],
          visibleWhen: { field: "vegetarian", equals: true },
        },
      ),
    );

    expect(uiSchema.elements[1]).toEqual({
      type: "Control",
      scope: "#/properties/favorite_vegetable",
      label: "Favorite vegetable",
      rule: {
        effect: "SHOW",
        condition: { scope: "#/properties/vegetarian", schema: { const: true } },
      },
    });
  });

  it("renders textarea as a multi-line control with optional maxLength", () => {
    const { schema, uiSchema } = compileForm(
      formWith({ name: "message", label: "Message", type: "textarea", maxLength: 500 }),
    );
    expect(schema.properties).toEqual({ message: { type: "string", maxLength: 500 } });
    expect(uiSchema.elements[0]).toEqual({
      type: "Control",
      scope: "#/properties/message",
      label: "Message",
      options: { multi: true },
    });
  });

  it("compiles number fields with inclusive bounds", () => {
    const { schema } = compileForm(
      formWith({ name: "age", label: "Age", type: "number", required: true, min: 0, max: 130 }),
    );
    expect(schema).toEqual({
      type: "object",
      properties: { age: { type: "number", minimum: 0, maximum: 130 } },
      required: ["age"],
    });
  });

  it("compiles date fields with format and bounds", () => {
    const { schema } = compileForm(
      formWith({
        name: "start_date",
        label: "Start date",
        type: "date",
        minDate: "2026-01-01",
        maxDate: "2026-12-31",
      }),
    );
    expect(schema.properties).toEqual({
      start_date: { type: "string", format: "date", formatMinimum: "2026-01-01", formatMaximum: "2026-12-31" },
    });
  });

  it("compiles boolean fields", () => {
    const { schema } = compileForm(formWith({ name: "agree", label: "I agree", type: "boolean" }));
    expect(schema.properties).toEqual({ agree: { type: "boolean" } });
  });

  it("compiles select fields to a single-choice enum", () => {
    const { schema } = compileForm(
      formWith({ name: "color", label: "Color", type: "select", choices: ["red", "green", "blue"] }),
    );
    expect(schema.properties).toEqual({
      color: { type: "string", enum: ["red", "green", "blue"] },
    });
  });

  it("compiles multiselect fields to an array-of-enum", () => {
    const { schema } = compileForm(
      formWith({
        name: "tags",
        label: "Tags",
        type: "multiselect",
        required: true,
        choices: ["a", "b"],
      }),
    );
    expect(schema).toEqual({
      type: "object",
      properties: {
        tags: { type: "array", items: { type: "string", enum: ["a", "b"] }, uniqueItems: true },
      },
      required: ["tags"],
    });
  });

  it("omits the required key when no field is required", () => {
    const { schema } = compileForm(formWith({ name: "notes", label: "Notes", type: "text" }));
    expect(schema.required).toBeUndefined();
  });

  it("keeps field order in both schemas and carries title/description", () => {
    const { schema, uiSchema } = compileForm({
      title: "Feedback",
      description: "Tell us everything",
      fields: [
        { name: "rating", label: "Rating", type: "number" },
        { name: "comment", label: "Comment", type: "textarea" },
      ],
    });

    expect(schema.title).toBe("Feedback");
    expect(schema.description).toBe("Tell us everything");
    expect(Object.keys(schema.properties as object)).toEqual(["rating", "comment"]);
    expect(uiSchema.elements.map((element) => element.scope)).toEqual([
      "#/properties/rating",
      "#/properties/comment",
    ]);
  });

  it("enforces design-time field rules before compiling", () => {
    expect(() =>
      compileForm(formWith({ name: "submittedAt", label: "Cheaty", type: "text" })),
    ).toThrow(ReservedFieldNameError);
  });
});
