# n8n-jsonform-nodes

n8n community node package (npm: `n8n-nodes-jsonform`) that serves **JSONForms-based forms rendered with shadcn/ui**, powered by [`@fragno-dev/jsonforms-shadcn-renderers`](https://fragno.dev/docs/forms/shadcn-renderer).

> Status: work in progress — see the [issue board](https://github.com/ryuuzake/n8n-jsonform-nodes/issues).

## What it does

- **JSON Form** trigger node: serves a self-contained form page on a webhook path.
- Forms are defined with standard **JSON Schema + UI Schema** (JSONForms).
- Rendering uses shadcn/ui components via the fragno JSONForms renderer set.
- Configuration is handled and stored by the n8n node itself:
  - **Import JSON config** — paste a `{ schema, uiSchema }` file (or fetch it from a URL at runtime), or
  - **Node UI builder** — add fields directly in the node parameters; the schema is generated for you.
- `GET <webhook-url>` renders the form; `POST` submits it into your workflow as the trigger item.

## Building a form in the node

Fields are configured directly in the node's editable **Fields** collection (add, edit, reorder, remove). Every field has:

- **Name** — the key this field gets in the workflow item. Must match `^[A-Za-z_][A-Za-z0-9_]*$`, be unique within the form, and cannot be the reserved name `submittedAt`. Violations surface as node errors naming the offending field.
- **Label** — text shown next to the input on the page.
- **Type** — one of `text`, `textarea`, `number`, `date`, `boolean` (switch), `select`, or `multiselect`.
- **Required** — whether the field must be filled in.

Type-appropriate constraints appear automatically: **Max Length** for text/long text, **Minimum/Maximum** for numbers, **Minimum Date/Maximum Date** for dates, and **Choices** for dropdowns and multi-selects.

The served schema is generated from these fields at request time through the Form Definition module; submissions are validated server-side against the same fields before they reach your workflow as one flat item plus `submittedAt`.

## Install

### Local development / testing

```bash
npm install
npm run build

mkdir -p ~/.n8n/nodes
npm pack
unzip -o n8n-nodes-jsonform-*.tgz -d ~/.n8n/nodes/n8n-nodes-jsonform
# restart n8n, then enable Settings → Community Nodes → custom extensions if needed
```

Or symlink for iterative dev:

```bash
npm link
mkdir -p ~/.n8n/nodes && cd ~/.n8n/nodes && npm link n8n-nodes-jsonform
```

### Community install (after npm publish)

In n8n: **Settings → Community Nodes → Install**, enter `n8n-nodes-jsonform`.

## Development

```bash
npm run build        # builds web bundle + node TS + copies assets
npm --prefix web dev # hot-reload the form frontend standalone
```

- `nodes/JsonForm/` — the trigger node implementation
- `web/` — Vite + React app (JSONForms + shadcn/ui) bundled into a single HTML file by `vite-plugin-singlefile`

## License

[MIT](LICENSE)
