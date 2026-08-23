import { describe, expect, it } from "vitest";

import { SubmissionShapeError, shapeDocumentSubmission } from "../../src/form-definition";
import type { JsonSchema } from "../../src/form-definition";

const schemaWith = (properties: Record<string, unknown>, required: string[] = []): JsonSchema => ({
  type: "object",
  properties,
  ...(required.length > 0 ? { required } : {}),
});

describe("shapeDocumentSubmission", () => {
  it("stamps submittedAt onto an accepted payload", () => {
    const schema = schemaWith({ email: { type: "string", maxLength: 254 } }, ["email"]);

    const submission = shapeDocumentSubmission(schema, { email: "ada@example.com" }, () => new Date(0));

    expect(submission.submittedAt).toBe("1970-01-01T00:00:00.000Z");
    expect(submission.email).toBe("ada@example.com");
  });

  it("keeps nested objects intact instead of flattening them", () => {
    const schema = schemaWith({
      address: {
        type: "object",
        properties: { street: { type: "string" }, postalCode: { type: "string", maxLength: 5 } },
      },
    });
    const address = { street: "Main Street", postalCode: "12345" };

    const submission = shapeDocumentSubmission(schema, { address }, () => new Date(0));

    expect(submission.address).toEqual(address);
  });

  it("enforces constraints from the pasted schema such as minLength", () => {
    const schema = schemaWith({ firstName: { type: "string", minLength: 3 } });

    try {
      shapeDocumentSubmission(schema, { firstName: "ab" }, () => new Date(0));
      expect.unreachable("expected SubmissionShapeError");
    } catch (error) {
      expect(error).toBeInstanceOf(SubmissionShapeError);
      const issues = (error as SubmissionShapeError).issues;
      expect(issues).toHaveLength(1);
      expect(issues[0]?.field).toBe("firstName");
      expect(issues[0]?.message).toMatch(/firstName/);
      expect(issues[0]?.code).toBe("invalid-constraint");
    }
  });

  it("reports missing required properties", () => {
    const schema = schemaWith({ email: { type: "string" } }, ["email"]);

    try {
      shapeDocumentSubmission(schema, {}, () => new Date(0));
      expect.unreachable("expected SubmissionShapeError");
    } catch (error) {
      expect(error).toBeInstanceOf(SubmissionShapeError);
      const issues = (error as SubmissionShapeError).issues;
      expect(issues[0]?.code).toBe("missing-required");
      expect(issues[0]?.field).toBe("email");
    }
  });

  it("validates date-formatted strings against ISO dates", () => {
    const schema = schemaWith({ birthDate: { type: "string", format: "date" } });

    expect(
      shapeDocumentSubmission(schema, { birthDate: "2026-08-23" }, () => new Date(0)).birthDate,
    ).toBe("2026-08-23");

    try {
      shapeDocumentSubmission(schema, { birthDate: "23/08/2026" }, () => new Date(0));
      expect.unreachable("expected SubmissionShapeError");
    } catch (error) {
      expect(error).toBeInstanceOf(SubmissionShapeError);
      expect((error as SubmissionShapeError).issues[0]?.field).toBe("birthDate");
    }
  });

  it("never lets a forged submittedAt survive into the emitted item", () => {
    const schema = schemaWith({ email: { type: "string" } });

    const submission = shapeDocumentSubmission(
      schema,
      { email: "ada@example.com", submittedAt: "forged" },
      () => new Date(0),
    );

    expect(submission.submittedAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it("aggregates every violated constraint into one report", () => {
    const schema = schemaWith(
      {
        firstName: { type: "string", minLength: 3 },
        age: { type: "number", minimum: 18 },
      },
      ["email"],
    );
    (schema.properties as Record<string, unknown>).email = { type: "string" };

    try {
      shapeDocumentSubmission(schema, { firstName: "a", age: 5 }, () => new Date(0));
      expect.unreachable("expected SubmissionShapeError");
    } catch (error) {
      const issues = (error as SubmissionShapeError).issues;
      expect(issues).toHaveLength(3);
      expect(new Set(issues.map((issue) => issue.field))).toEqual(
        new Set(["firstName", "age", "email"]),
      );
    }
  });

  it("rejects payloads that are not JSON objects", () => {
    const schema = schemaWith({ email: { type: "string" } });

    expect(() =>
      shapeDocumentSubmission(schema, [], () => new Date(0)),
    ).toThrow(SubmissionShapeError);
    expect(() =>
      shapeDocumentSubmission(schema, "nope", () => new Date(0)),
    ).toThrow(SubmissionShapeError);
  });
});
