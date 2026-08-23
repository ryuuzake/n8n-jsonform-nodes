# ADR 0002: Passthrough imports instead of transpiling into Fields

Date: 2026-08-23
Status: Accepted

## Context

Imports originally transpiled pasted JSONForms documents into the same flat
`Field[]` the node's builder produces, then recompiled them for serving.
Anything outside that Field subset — nested objects, `minLength`, UI rules,
Categorization layouts — was rejected with exact-path Import Issues. Real-world
documents (see `test/fixtures/schema.json` / `ui-schema.json`) tripped a dozen
rejections at once.

Supporting those constructs inside the transpiler meant re-implementing an
ever-growing slice of JSONForms semantics: flattening with derived field
names, a rule subset, category metadata, and per-keyword acceptance lists —
with the long tail still rejected. Meanwhile three seams depended on flat
Fields: storage, server-side POST validation (`shapeSubmission`), and the
flat submission item shape.

## Decision

Imported documents are **passed through verbatim** (ADR title: passthrough).
They are not stored as Fields and never rewritten:

1. `src/form-import/validate-documents.ts` performs only **structural checks**
   (JSON objects on both sides, object root schema with ≥ 1 property,
   `required` references defined properties, no `submittedAt` property,
   uiSchema has a `type`). Everything else is served as authored.
2. GET injects the pasted `{schema, uiSchema}` pair directly into the page
   config blob; no `compileForm` runs for imported nodes. The web renderer
   already ships Categorization/stepper layouts and evaluates UI rules, so
   every JSONForms construct works client-side.
3. POST validates the payload with **Ajv against the pasted schema**
   (`shapeDocumentSubmission`), mirroring what the page does in the browser.
   Accepted payloads are emitted as one workflow item with nesting intact:
   `{submittedAt, ...data}`. The system timestamp always wins over any payload
   key of the same name.

Builder Fields keep their own pipeline unchanged (compile on GET,
`shapeSubmission` on POST) and gain `minLength` plus single-equality
visibility (`visibleWhen` → compiled to a SHOW rule).

## Consequences

- Import fidelity is total: no construct is ever rejected for being "outside
  the subset", so the Import Issue contract shrinks to structural failures.
- Server-side validation for imports depends on Ajv (`ajv` is now a runtime
  dependency), configured leniently (`strict: false`, all errors) like
  JSONForms' own instance.
- Submission items from imported forms may contain nested objects and keys
  beyond Builder Field names; the pasted schema remains the single source of
  truth for what is accepted.
- Keys the schema permits pass through even when they match nothing in the
  builder Fields — authors who want strictness set `additionalProperties: false`.
