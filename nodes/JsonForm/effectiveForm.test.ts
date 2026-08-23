import { describe, expect, it } from "vitest";

import { ConfigImportError } from "../../src/form-import";
import type { Form } from "../../src/form-definition";
import { resolveEffectiveForm, resolveLegacyImportedForm } from "./effectiveForm";

/** The Form built in the node's Fields collection for the tests below. */
const builtForm: Form = {
  title: "Built form",
  fields: [{ name: "name", label: "Name", type: "text", required: true }],
};

const schemaJson = JSON.stringify({
  type: "object",
  properties: { email: { type: "string", maxLength: 254 } },
  required: ["email"],
});

const uiSchemaJson = JSON.stringify({
  type: "VerticalLayout",
  elements: [{ type: "Control", scope: "#/properties/email", label: "Email" }],
});

describe("resolveEffectiveForm", () => {
  it("falls back to the builder-authored Form while both inputs are untouched", () => {
    for (const empty of [undefined, "", "   "]) {
      expect(resolveEffectiveForm(builtForm, empty, empty)).toEqual(builtForm);
    }
  });

  it("never lets a request mutate the builder-authored Form it was handed", () => {
    const resolved = resolveEffectiveForm(builtForm, "", "");

    expect(resolved).not.toBe(builtForm);
    expect(resolved.fields[0]).not.toBe(builtForm.fields[0]);
  });

  it("transpiles both pasted inputs into the effective Form", () => {
    const form = resolveEffectiveForm(builtForm, schemaJson, uiSchemaJson);

    expect(form.fields).toEqual([
      { name: "email", label: "Email", type: "text", required: true, maxLength: 254 },
    ]);
  });

  it("imports all-or-nothing: a lone Schema JSON names the missing UI half", () => {
    try {
      resolveEffectiveForm(builtForm, schemaJson, "");
      expect.unreachable("expected ConfigImportError");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigImportError);
      const issues = (error as ConfigImportError).issues;
      expect(issues[0]?.path).toBe("UI Schema JSON: $");
      expect(issues[0]?.reason).toMatch(/UI Schema JSON/i);
    }
  });

  it("imports all-or-nothing: a lone UI Schema JSON names the missing Schema half", () => {
    try {
      resolveEffectiveForm(builtForm, "", uiSchemaJson);
      expect.unreachable("expected ConfigImportError");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigImportError);
      const issues = (error as ConfigImportError).issues;
      expect(issues[0]?.path).toBe("Schema JSON: $");
      expect(issues[0]?.reason).toMatch(/Schema JSON/i);
    }
  });

  it("tags unparseable Schema JSON with its input", () => {
    try {
      resolveEffectiveForm(builtForm, "{not json", uiSchemaJson);
      expect.unreachable("expected ConfigImportError");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigImportError);
      const issues = (error as ConfigImportError).issues;
      expect(issues[0]?.path).toBe("Schema JSON: $");
      expect(issues[0]?.reason).toMatch(/not valid JSON/i);
    }
  });

  it("tags unparseable UI Schema JSON with its input", () => {
    try {
      resolveEffectiveForm(builtForm, schemaJson, "{not json");
      expect.unreachable("expected ConfigImportError");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigImportError);
      const issues = (error as ConfigImportError).issues;
      expect(issues[0]?.path).toBe("UI Schema JSON: $");
      expect(issues[0]?.reason).toMatch(/not valid JSON/i);
    }
  });

  it("reports both parse failures together when both inputs are unparseable", () => {
    try {
      resolveEffectiveForm(builtForm, "{not json", "{also not");
      expect.unreachable("expected ConfigImportError");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigImportError);
      const paths = (error as ConfigImportError).issues.map((issue) => issue.path);
      expect(paths).toEqual(["Schema JSON: $", "UI Schema JSON: $"]);
    }
  });

  it("treats a programmatic object-valued input as filled instead of falling back", () => {
    const schemaObject = JSON.parse(schemaJson);

    try {
      resolveEffectiveForm(builtForm, schemaObject, "");
      expect.unreachable("expected ConfigImportError");
    } catch (error) {
      // A filled import must never silently fall back to builder Fields.
      expect(error).toBeInstanceOf(ConfigImportError);
      expect((error as ConfigImportError).issues[0]?.path).toBe("UI Schema JSON: $");
    }

    const form = resolveEffectiveForm(builtForm, schemaObject, JSON.parse(uiSchemaJson));
    expect(form.fields).toEqual([
      { name: "email", label: "Email", type: "text", required: true, maxLength: 254 },
    ]);
  });

  it("rejects documents outside the Field subset loudly with prefixed paths", () => {
    const nested = JSON.stringify({
      type: "object",
      properties: {
        address: { type: "object", properties: { city: { type: "string" } } },
      },
    });
    const ui = JSON.stringify({ type: "VerticalLayout", elements: [] });

    try {
      resolveEffectiveForm(builtForm, nested, ui);
      expect.unreachable("expected ConfigImportError");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigImportError);
      expect((error as ConfigImportError).message).toContain("Schema JSON: $.address.city");
    }
  });
});

describe("resolveLegacyImportedForm", () => {
  it("transpiles the v1 combined document with its original un-prefixed paths", () => {
    const combined = JSON.stringify({
      schema: JSON.parse(schemaJson),
      uiSchema: JSON.parse(uiSchemaJson),
    });

    const form = resolveLegacyImportedForm(combined);

    expect(form.fields).toEqual([
      { name: "email", label: "Email", type: "text", required: true, maxLength: 254 },
    ]);

    try {
      resolveLegacyImportedForm(
        JSON.stringify({
          schema: {
            type: "object",
            properties: {
              address: { type: "object", properties: { city: { type: "string" } } },
            },
          },
          uiSchema: { type: "VerticalLayout", elements: [] },
        }),
      );
      expect.unreachable("expected ConfigImportError");
    } catch (error) {
      expect((error as ConfigImportError).message).toContain("$.address.city");
      expect((error as ConfigImportError).message).not.toContain("Schema JSON:");
    }
  });

  it("rejects unparseable documents loudly", () => {
    expect(() => resolveLegacyImportedForm("{not json")).toThrow(ConfigImportError);
  });
});
