# n8n-jsonform-nodes

n8n community node package (`n8n-nodes-jsonform`) that serves **JSONForms-based forms rendered with shadcn/ui**, powered by [`@fragno-dev/jsonforms-shadcn-renderers`](https://fragno.dev/docs/forms/shadcn-renderer).

## What it does

The **JSON Form** trigger node turns a webhook path into a self-contained form page:

- `GET <webhook-url>` serves a single-file HTML page that renders your form with **JSONForms + shadcn/ui** (light/dark aware, mobile friendly).
- The visitor fills it in and hits **Submit**; the browser `POST`s to the same path.
- `POST <webhook-url>` validates the submission server-side against the configured fields and emits **one flat trigger item** into your workflow:

```json
{
  "full_name": "Ada Lovelace",
  "ticket_count": 3,
  "submittedAt": "2026-08-22T15:36:59.487Z"
}
```

Field values keep their types (numbers stay numbers, booleans stay booleans), query parameters are never included, and `submittedAt` is system-set.

There are two ways to define what the form asks — **build Fields in the node UI** or **Import a JSON config**. Both produce the same internal form definition; an import replaces the builder fields wholesale when set.

## Install

> Requires n8n with community packages enabled. On self-hosted n8n set `N8N_COMMUNITY_PACKAGES_ENABLED=true` (or enable **Settings → Community Nodes**). Because this package is not yet published to npm, also set `N8N_UNVERIFIED_PACKAGES_ENABLED=true` on recent versions so unverified packages load.

### From npm (after publish)

In n8n: **Settings → Community Nodes → Install**, enter `n8n-nodes-jsonform`, confirm. Restart n8n if prompted. The **JSON Form** node then appears under the triggers ("Add first step → Trigger").

### Manual install from a packed tarball

Verified flow for local testing without publishing:

```bash
git clone https://github.com/ryuuzake/n8n-jsonform-nodes
cd n8n-jsonform-nodes
npm install
npm run build          # web bundle + node TS; produces dist/
npm pack               # produces n8n-nodes-jsonform-<version>.tgz

mkdir -p ~/.n8n/nodes
npm install --prefix ~/.n8n/nodes ./n8n-nodes-jsonform-<version>.tgz
```

Restart n8n — community packages are picked up at startup. Only built artifacts ship in the tarball (`dist/`, plus package metadata); sources, tests, and tooling are excluded.

### Symlink (iterative development)

```bash
npm run build
npm link
mkdir -p ~/.n8n/nodes && cd ~/.n8n/nodes && npm link n8n-nodes-jsonform
```

Rebuild and restart n8n after each change.

## Building a form in the node

Fields are configured directly in the node's editable **Fields** collection (add, edit, reorder, remove entries). Every field has:

| Property | Meaning |
| --- | --- |
| **Name** | Key this field gets in the workflow item. Must match `^[A-Za-z_][A-Za-z0-9_]*$`, be unique within the form, and cannot be the reserved name `submittedAt`. Violations surface as node errors naming the offending field. |
| **Label** | Text shown next to the input on the page. |
| **Type** | One of **Text**, **Long Text**, **Number**, **Date**, **Switch** (boolean), **Dropdown** (select one), or **Multi-Select Dropdown** (select several). |
| **Required** | Whether the field must be filled in before submitting. |

Type-appropriate constraint inputs appear automatically:

- **Max Length** for Text / Long Text (maximum characters accepted)
- **Minimum / Maximum** for Number (inclusive bounds)
- **Minimum Date / Maximum Date** for Date (inclusive bounds as `YYYY-MM-DD`)
- **Choices** for Dropdown / Multi-Select Dropdown (the allowed values)

Two optional texts round out the page: **Title** (heading at the top of the served page) and **Description** (text under the title).

An invalid configuration fails fast with a node error naming the offending field and rule — before any page is served or submission accepted.

## Importing a JSON config

Paste a `{ schema, uiSchema }` document into **Import Config** to define the form as standard JSONForms JSON. When non-empty, the document is transpiled into fields and **replaces** whatever is built in the Fields collection (never merged). Example:

```json
{
  "schema": {
    "type": "object",
    "title": "Event registration",
    "description": "Reserve your seat",
    "properties": {
      "email": { "type": "string", "maxLength": 254 },
      "seats": { "type": "number", "minimum": 1, "maximum": 6 },
      "date": { "type": "string", "format": "date" },
      "meal": { "type": "string", "enum": ["standard", "vegan"] },
      "allergies": { "type": "array", "items": { "type": "string", "enum": ["nuts", "shellfish"] } }
    },
    "required": ["email"]
  },
  "uiSchema": {
    "type": "VerticalLayout",
    "elements": [
      { "type": "Control", "scope": "#/properties/email", "label": "Email address" },
      { "type": "Control", "scope": "#/properties/seats" },
      { "type": "Control", "scope": "#/properties/date" },
      { "type": "Control", "scope": "#/properties/meal" },
      { "type": "Control", "scope": "#/properties/allergies" }
    ]
  }
}
```

Supported subset (everything else is rejected loudly, with exact paths — nothing is silently dropped):

- **Root**: `type: "object"` with at least one property; root `title` / `description` become the page heading / subtext.
- **Properties** become fields by type:
  - `string` → Text (**Long Text** via `"options": {"multi": true}` on its Control), Dropdown when it has a string `enum`, Date when `"format": "date"`
  - `string` constraints: `maxLength`; date bounds: `formatMinimum` / `formatMaximum`
  - `number` → Number with inclusive `minimum` / `maximum` (use `number`, not `integer`)
  - `boolean` → Switch
  - `array` of string enums → Multi-Select Dropdown
- **Required**: the schema `required` array marks fields as mandatory.
- **UI Schema**: only `Control` elements bound to top-level properties (`#/properties/<name>`), each carrying an optional string `label`.
- Not supported: nested objects, `oneOf` / `anyOf`, conditionals (`if`/`then`/`else`, `allOf`, `not`, `$ref`), `pattern` / `minLength`, exclusive bounds, type unions, UI rules, layouts other than a flat element list.

If the document cannot be served (invalid JSON, unsupported constructs), GET answers with an explanatory page listing every offending path instead of a broken form; POST refuses submissions while the config is invalid.

## Node options reference

| Option | Default | Purpose |
| --- | --- | --- |
| **Path** | `json-form` | Webhook path serving the form and receiving submissions. Production URL: `<base-url>/webhook/<path>`. |
| **Authentication** | `None` | Gates GET and POST alike (see below). |
| **Title** | empty | Optional heading shown at the top of the served page. |
| **Description** | empty | Optional text under the title. |
| **Response Mode** | `When Last Node Finishes` | When the POST response is sent (see below). |
| **Import Config** | empty | Optional `{ schema, uiSchema }` document replacing the builder fields. |
| **Completion Message** | `Thank you! Your submission has been received.` | Shown on the page after a successful submission. |
| **Accent Color** | empty | Recolors the form's primary theme color (buttons, focus rings) in both light and dark mode. Leave empty for the stock shadcn theme. |

### Authentication

- **None** — anyone with the URL can open and submit anonymously (public intake forms).
- **Basic Auth** — callers must present the user/password of an attached **Basic Auth** credential. Browsers show their native login prompt automatically.
- **Header Auth** — callers must send the header name/value pair stored in an attached **Header Auth** credential (set the pair once in Credentials; the page request must include it).

Every authorization failure — including a misconfigured credential — answers a uniform `401`, for page requests and submissions alike.

### Response Mode

Controls who answers the submission POST:

- **On Received** — responds as soon as the trigger runs. Best for plain intake forms; the visitor sees the Completion Message immediately.
- **When Last Node Finishes** — the response waits for the whole execution (its output becomes the response body). Use when downstream nodes are fast enough that visitors aren't left hanging.
- **Respond to Webhook** — a **Respond to Webhook** node in the workflow owns the HTTP response. Use for custom responses (redirects, tailored payloads).

### Test vs production URLs

Like any n8n trigger, the node registers two URLs per path:

- **Production**: `http://<your-n8n>/webhook/<path>` — active once the workflow is **active/published**; serves everyone until deactivated. Use it for real traffic and end-to-end checks.
- **Test**: `http://<your-n8n>/webhook-test/<path>` — only listens while an editor session is waiting for a trigger event (click **Test workflow** / **Execute workflow**). Submissions arrive as live editor executions you can inspect immediately.

Both URLs behave identically otherwise: GET renders the form, POST validates and emits the item. When you open the Test URL outside a listening session, n8n answers 404 — activate the workflow or start a test listen.

## Manual smoke checklist

Executed against a local n8n (Docker image `docker.n8n.io/n8nio/n8n:latest`) with the packed tarball installed as above:

1. **Install the node** — build, pack, and install the tarball into `~/.n8n/nodes` (commands above); restart n8n.
2. **Create a workflow** — add the **JSON Form** trigger, set Path to e.g. `json-form-smoke`, add two Fields: `full_name` (Text, Required) and `ticket_count` (Number, Required, Minimum 1, Maximum 10). Keep Response Mode **On Received**.
3. **Activate the workflow** (or click **Test workflow**) so the webhook URL starts listening.
4. **GET renders the form** — open `http://localhost:5678/webhook/json-form-smoke` in a browser: the shadcn-styled page shows both labeled inputs and the Submit button.
5. **Submit** — fill in valid values (`Ada Lovelace`, `3`) and submit: the page swaps to *"Thank you! Your submission has been received."* (the Completion Message).
6. **Inspect the item** — check the workflow's execution list (or the editor's live run during a test): one item on the trigger output,
   ```json
   { "submittedAt": "<iso timestamp>", "full_name": "Ada Lovelace", "ticket_count": 3 }
   ```
7. **Server-side validation** — submit with `ticket_count` = `99` (or clear a required field): the page reports the problem (`"ticket_count" must be at most 10.`) and no execution is created.
8. **Optional checks** — set an **Accent Color** and reload the GET page (buttons/focus rings recolor); switch Authentication to Basic Auth and confirm unauthenticated GETs get a 401 challenge.

## Development

```bash
npm install
npm run build        # builds web bundle + node TS + copies assets into dist/
npm test             # vitest suite
npm run typecheck    # tsc --noEmit
npm --prefix web dev # hot-reload the form frontend standalone
npm pack --dry-run   # inspect exactly what would publish
```

- `nodes/JsonForm/` — the trigger node implementation (parameters, webhook handling, auth, import resolution)
- `src/form-definition/` — Field/Form model, compilation to JSON Schema + UI Schema, submission shaping
- `src/form-import/` — `{schema, uiSchema}` → Fields transpiler with loud, exact-path rejections
- `web/` — Vite + React app (JSONForms + shadcn/ui) bundled into a single HTML file by `vite-plugin-singlefile`

## License

[MIT](LICENSE)
