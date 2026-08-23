# JSON Form Node

An n8n trigger node that serves a JSONForms-based form on a webhook path and emits submissions into the workflow. This context covers how a form gets defined and where its definition lives.

## Language

### Form authoring

**Form**:
The internal definition of what the served page asks: an ordered list of Fields plus optional Title and Description.
_Avoid_: config, document, schema (unqualified)

**Builder Fields**:
Fields authored directly in the node UI's editable collection. The default source of a Form when no import is active.
_Avoid_: manual fields, UI fields

**Schema JSON**:
The node input holding a pasted JSON Schema object describing the Form's properties and constraints. Never a combined wrapper document.
_Avoid_: Import Config, schema blob

**UI Schema JSON**:
The node input holding a pasted JSONForms UI Schema describing presentation (Controls and labels) for the properties in Schema JSON. Always required alongside Schema JSON.
_Avoid_: ui config, layout

### Import rules

**Imported Form**:
The Form defined by Schema JSON + UI Schema JSON. When both inputs are non-empty it replaces Builder Fields wholesale — never merged, never rewritten: the documents are served and validated as authored.

**Passthrough import**:
The architectural rule that imported documents are not transpiled into Builder Fields. The pasted schema/uiSchema pair is stored verbatim, served verbatim (GET), and enforced server-side with Ajv against the pasted schema (POST). Anything JSONForms understands — nested objects, UI rules, Categorization layouts, arbitrary keywords — therefore works as authored; submissions keep their nesting.

**Structural check**:
One of the few invariants an import must satisfy before it is accepted: both halves are JSON objects, the root schema is `type: "object"` with at least one property, `required` only references defined properties, no property collides with the system-set `submittedAt`, and the uiSchema carries a `type`. Constructs outside these checks are never judged.

**All-or-nothing import**:
Import happens only when both inputs are non-empty; exactly one filled is an error naming the missing half. Both empty falls back to Builder Fields.

**Combined Document**:
A legacy `{schema, uiSchema}` wrapper object. Rejected by either split input with a message directing the user to paste only the inner half.

### Error contract

**Import Issue**:
One rejected location in an imported document: a JSONPath rooted at `$` of the offending input plus a reason. All issues are reported together, never silently dropped.

**Path rooting**:
Every issue path is prefixed with its source (`Schema JSON:` / `UI Schema JSON:`) because both documents root at `$` (`Schema JSON: $.properties.email`). Legacy v1 wrapper paths hang off the envelope instead (`$.schema.properties.email`).
