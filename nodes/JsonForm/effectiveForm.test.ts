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
      expect(resolveEffectiveForm(builtForm, empty, empty)).toEqual({
        kind: "builder",
        form: builtForm,
      });
    }
  });

  it("never lets a request mutate the builder-authored Form it was handed", () => {
    const resolved = resolveEffectiveForm(builtForm, "", "");

    expect(resolved.kind).toBe("builder");
    if (resolved.kind !== "builder") return;
    expect(resolved.form).not.toBe(builtForm);
    expect(resolved.form.fields[0]).not.toBe(builtForm.fields[0]);
  });

  it("passes both pasted inputs through verbatim as the effective documents", () => {
    const resolved = resolveEffectiveForm(builtForm, schemaJson, uiSchemaJson);

    expect(resolved).toEqual({
      kind: "imported",
      documents: {
        schema: JSON.parse(schemaJson),
        uiSchema: JSON.parse(uiSchemaJson),
      },
    });
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

    const resolved = resolveEffectiveForm(builtForm, schemaObject, JSON.parse(uiSchemaJson));
    expect(resolved.kind).toBe("imported");
  });

  it("rejects structurally unsound documents loudly with prefixed paths", () => {
    const noType = JSON.stringify({
      properties: { email: { type: "string" } },
    });
    const ui = JSON.stringify({ type: "VerticalLayout", elements: [] });

    try {
      resolveEffectiveForm(builtForm, noType, ui);
      expect.unreachable("expected ConfigImportError");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigImportError);
      expect((error as ConfigImportError).message).toContain("Schema JSON: $.type");
    }
  });
});

describe("resolveLegacyImportedForm", () => {
  it("passes the v1 combined document's halves through with their original wrapper paths", () => {
    const combined = JSON.stringify({
      schema: JSON.parse(schemaJson),
      uiSchema: JSON.parse(uiSchemaJson),
    });

    const resolved = resolveLegacyImportedForm(combined);

    expect(resolved.kind).toBe("imported");
    if (resolved.kind !== "imported") return;
    expect(resolved.documents.schema).toEqual(JSON.parse(schemaJson));
    expect(resolved.documents.uiSchema).toEqual(JSON.parse(uiSchemaJson));

    try {
      resolveLegacyImportedForm(
        JSON.stringify({
          schema: { properties: { email: { type: "string" } } },
          uiSchema: { type: "VerticalLayout", elements: [] },
        }),
      );
      expect.unreachable("expected ConfigImportError");
    } catch (error) {
      expect((error as ConfigImportError).message).toContain("$.schema.type");
      expect((error as ConfigImportError).message).not.toContain("Schema JSON:");
    }
  });

  it("rejects unparseable documents loudly", () => {
    expect(() => resolveLegacyImportedForm("{not json")).toThrow(ConfigImportError);
  });
});
