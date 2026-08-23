import { describe, expect, it } from "vitest";
import { SubmissionShapeError, shapeSubmission } from "../../src/form-definition/shape";
import type { Field, Form } from "../../src/form-definition/types";
import { formWith } from "../helpers";

const FIXED_CLOCK = (): Date => new Date("2026-08-22T10:30:00.000Z");


describe("shapeSubmission", () => {
  it("returns flat field values plus submittedAt from the injected clock", () => {
    const form: Form = {
      fields: [
        { name: "full_name", label: "Full name", type: "text", required: true },
        { name: "age", label: "Age", type: "number" },
      ],
    };

    expect(
      shapeSubmission(form, { full_name: "Ada Lovelace", age: 36 }, FIXED_CLOCK),
    ).toEqual({
      full_name: "Ada Lovelace",
      age: 36,
      submittedAt: "2026-08-22T10:30:00.000Z",
    });
  });

  it("drops unknown keys, including a spoofed submittedAt", () => {
    const form = formWith({ name: "answer", label: "Answer", type: "text" });
    const result = shapeSubmission(
      form,
      { answer: "42", hacker: true, submittedAt: "1999-01-01T00:00:00.000Z" },
      FIXED_CLOCK,
    );
    expect(result).toEqual({ answer: "42", submittedAt: "2026-08-22T10:30:00.000Z" });
  });

  it("omits absent optional fields but rejects absent required ones", () => {
    const optionalOnly = formWith({ name: "nickname", label: "Nickname", type: "text" });
    expect(shapeSubmission(optionalOnly, {}, FIXED_CLOCK)).toEqual({
      submittedAt: "2026-08-22T10:30:00.000Z",
    });

    const withRequired = formWith({
      name: "email",
      label: "Email",
      type: "text",
      required: true,
    });
    try {
      shapeSubmission(withRequired, {}, FIXED_CLOCK);
      expect.unreachable("expected SubmissionShapeError");
    } catch (error) {
      expect(error).toBeInstanceOf(SubmissionShapeError);
      expect((error as SubmissionShapeError).issues).toEqual([
        { code: "missing-required", field: "email", message: '"email" is required.' },
      ]);
    }
  });

  it("treats null like an absent value", () => {
    const form = formWith({ name: "bio", label: "Bio", type: "text" });
    expect(shapeSubmission(form, { bio: null }, FIXED_CLOCK)).toEqual({
      submittedAt: "2026-08-22T10:30:00.000Z",
    });
  });

  it("treats an empty string or empty array on a required field as missing", () => {
    try {
      shapeSubmission(
        formWith({ name: "email", label: "Email", type: "text", required: true }),
        { email: "" },
        FIXED_CLOCK,
      );
      expect.unreachable("expected SubmissionShapeError");
    } catch (error) {
      expect((error as SubmissionShapeError).issues[0]?.code).toBe("missing-required");
    }

    try {
      shapeSubmission(
        formWith({ name: "tags", label: "Tags", type: "multiselect", required: true, choices: ["a"] }),
        { tags: [] },
        FIXED_CLOCK,
      );
      expect.unreachable("expected SubmissionShapeError");
    } catch (error) {
      expect((error as SubmissionShapeError).issues[0]?.code).toBe("missing-required");
    }
  });

  it("rejects duplicate selections so submissions match uniqueItems in the schema", () => {
    const form = formWith({
      name: "tags",
      label: "Tags",
      type: "multiselect",
      choices: ["a", "b"],
    });
    expect(() => shapeSubmission(form, { tags: ["a", "a"] }, FIXED_CLOCK)).toThrow(
      SubmissionShapeError,
    );
  });

  it("aggregates every problem into one error", () => {
    const form = formWith(
      { name: "email", label: "Email", type: "text", required: true },
      { name: "age", label: "Age", type: "number" },
    );
    try {
      shapeSubmission(form, { age: "old" }, FIXED_CLOCK);
      expect.unreachable("expected SubmissionShapeError");
    } catch (error) {
      const issues = (error as SubmissionShapeError).issues;
      expect(issues.map((issue) => issue.code)).toEqual(["missing-required", "invalid-type"]);
    }
  });

  it("rejects non-object payloads", () => {
    for (const bad of [null, "str", 42, [], true]) {
      expect(() =>
        shapeSubmission(formWith({ name: "a", label: "A", type: "text" }), bad, FIXED_CLOCK),
      ).toThrow(SubmissionShapeError);
    }
  });

  describe("per-type validation", () => {
    it("accepts well-typed values for all seven types", () => {
      const form = formWith(
        { name: "title", label: "Title", type: "text" },
        { name: "story", label: "Story", type: "textarea" },
        { name: "rating", label: "Rating", type: "number" },
        { name: "day", label: "Day", type: "date" },
        { name: "subscribe", label: "Subscribe", type: "boolean" },
        { name: "color", label: "Color", type: "select", choices: ["red"] },
        { name: "tags", label: "Tags", type: "multiselect", choices: ["x", "y"] },
      );
      const result = shapeSubmission(
        form,
        {
          title: "Hello",
          story: "Once upon a time",
          rating: 5,
          day: "2026-08-22",
          subscribe: true,
          color: "red",
          tags: ["x", "y"],
        },
        FIXED_CLOCK,
      );
      expect(result.tags).toEqual(["x", "y"]);
      expect(result.submittedAt).toBe("2026-08-22T10:30:00.000Z");
    });

    it("rejects wrong types with a useful message per type", () => {
      const cases: Array<[Field, unknown]> = [
        [{ name: "f", label: "F", type: "text" }, 7],
        [{ name: "f", label: "F", type: "textarea" }, {}],
        [{ name: "f", label: "F", type: "number" }, "12"],
        [{ name: "f", label: "F", type: "date" }, "not-a-date"],
        [{ name: "f", label: "F", type: "date" }, "2026-02-30"],
        [{ name: "f", label: "F", type: "boolean" }, "true"],
        [{ name: "f", label: "F", type: "select", choices: ["red"] }, "blue"],
        [{ name: "f", label: "F", type: "multiselect", choices: ["red"] }, ["red", "blue"]],
        [{ name: "f", label: "F", type: "multiselect", choices: ["red"] }, "red"],
      ];
      for (const [field, bad] of cases) {
        expect(
          () => shapeSubmission(formWith(field), { f: bad }, FIXED_CLOCK),
          `expected rejection of ${JSON.stringify(bad)} for ${field.type}`,
        ).toThrow(SubmissionShapeError);
      }
    });

    it("enforces declared constraints on values", () => {
      const cases: Array<[Field, unknown]> = [
        [{ name: "f", label: "F", type: "text", maxLength: 3 }, "toolong"],
        [{ name: "f", label: "F", type: "number", min: 1, max: 10 }, 11],
        [{ name: "f", label: "F", type: "date", minDate: "2026-01-01" }, "2025-12-31"],
        [{ name: "f", label: "F", type: "date", maxDate: "2026-01-01" }, "2026-06-15"],
        [{ name: "f", label: "F", type: "text", minLength: 3 }, "ab"],
        [{ name: "f", label: "F", type: "textarea", minLength: 4 }, "abc"],
      ];
      for (const [field, bad] of cases) {
        expect(
          () => shapeSubmission(formWith(field), { f: bad }, FIXED_CLOCK),
          `expected constraint violation for ${JSON.stringify(bad)}`,
        ).toThrow(/must/);
      }
    });

    it("treats an empty optional text value as untouched instead of a minLength violation", () => {
      const form = formWith({ name: "f", label: "F", type: "text", minLength: 3 });

      const submission = shapeSubmission(form, { f: "" }, FIXED_CLOCK);

      expect(submission.f).toBe("");
    });
  });

  it("is deterministic under a fixed clock", () => {
    const form = formWith({ name: "note", label: "Note", type: "text" });
    const first = shapeSubmission(form, { note: "hi" }, FIXED_CLOCK);
    const second = shapeSubmission(form, { note: "hi" }, FIXED_CLOCK);
    expect(first).toEqual(second);
  });
});
