import { describe, expect, it } from "vitest";

import { ConfigImportError } from "../../src/form-import";
import type { Form } from "../../src/form-definition";
import { resolveEffectiveForm } from "./effectiveForm";

/** The Form built in the node's Fields collection for the tests below. */
const builtForm: Form = {
  title: "Built form",
  fields: [{ name: "name", label: "Name", type: "text", required: true }],
};

const validDoc = JSON.stringify({
  schema: {
    type: "object",
    properties: { email: { type: "string", maxLength: 254 } },
    required: ["email"],
  },
  uiSchema: {
    type: "VerticalLayout",
    elements: [{ type: "Control", scope: "#/properties/email", label: "Email" }],
  },
});

describe("resolveEffectiveForm", () => {
  it("falls back to the builder-authored Form while no import config is set", () => {
    for (const empty of [undefined, "", "   "]) {
      expect(resolveEffectiveForm(builtForm, empty)).toEqual(builtForm);
    }
  });

  it("never lets a request mutate the builder-authored Form it was handed", () => {
    const resolved = resolveEffectiveForm(builtForm, "");

    expect(resolved).not.toBe(builtForm);
    expect(resolved.fields[0]).not.toBe(builtForm.fields[0]);
  });

  it("transpiles a pasted document into the effective Form", () => {
    const form = resolveEffectiveForm(builtForm, validDoc);

    expect(form.fields).toEqual([
      { name: "email", label: "Email", type: "text", required: true, maxLength: 254 },
    ]);
  });

  it("rejects unparseable documents loudly", () => {
    expect(() => resolveEffectiveForm(builtForm, "{not json")).toThrow(ConfigImportError);
  });

  it("rejects documents outside the Field subset loudly", () => {
    const nested = JSON.stringify({
      schema: {
        type: "object",
        properties: {
          address: { type: "object", properties: { city: { type: "string" } } },
        },
      },
      uiSchema: { type: "VerticalLayout", elements: [] },
    });

    try {
      resolveEffectiveForm(builtForm, nested);
      expect.unreachable("expected ConfigImportError");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigImportError);
      expect((error as ConfigImportError).message).toContain("$.address.city");
    }
  });
});
