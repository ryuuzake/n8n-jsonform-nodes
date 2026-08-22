import { describe, expect, it } from "vitest";

import { ConfigImportError } from "../../src/form-import";
import { sampleForm } from "./sampleForm";
import { resolveEffectiveForm } from "./effectiveForm";

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
  it("falls back to the fixture Form while no import config is set", () => {
    for (const empty of [undefined, "", "   "]) {
      expect(resolveEffectiveForm(empty)).toBe(sampleForm);
    }
  });

  it("transpiles a pasted document into the effective Form", () => {
    const form = resolveEffectiveForm(validDoc);

    expect(form.fields).toEqual([
      { name: "email", label: "Email", type: "text", required: true, maxLength: 254 },
    ]);
  });

  it("rejects unparseable documents loudly", () => {
    expect(() => resolveEffectiveForm("{not json")).toThrow(ConfigImportError);
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
      resolveEffectiveForm(nested);
      expect.unreachable("expected ConfigImportError");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigImportError);
      expect((error as ConfigImportError).message).toContain("$.address.city");
    }
  });
});
