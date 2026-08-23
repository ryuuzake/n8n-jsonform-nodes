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
The Form produced by transpiling Schema JSON + UI Schema JSON. When both inputs are non-empty it replaces Builder Fields wholesale — never merged.

**All-or-nothing import**:
Import happens only when both inputs are non-empty; exactly one filled is an error naming the missing half. Both empty falls back to Builder Fields.

**Combined Document**:
A legacy `{schema, uiSchema}` wrapper object. Rejected by either split input with a message directing the user to paste only the inner half.

### Error contract

**Import Issue**:
One rejected location in an imported document: a JSONPath rooted at `$` of the offending input plus a reason. All issues are reported together, never silently dropped.

**Path rooting**:
Every issue path is prefixed with its source (`Schema JSON:` / `UI Schema JSON:`) because both documents root at `$`. Properties are abbreviated to `$.<name>`; UI elements use `$.elements[<index>]`.
