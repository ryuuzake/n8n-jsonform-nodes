# Runtime-transpiled split inputs over authoring-time population

JSON import was considered for curl-import-style semantics: paste once, populate the node's editable Fields, discard the raw JSON. That requires a custom editor-UI dialog, and community packages have no mechanism to ship one — n8n's frontend module system registers modals via a static manifest inside the n8n monorepo (`editor-ui/src/app/modules.manifest.ts`) and is first-party only (PRs n8n-io/n8n#35642, #34080); the team's April 2025 forum post confirms community extensions remain exploratory. Stock parameter types offer no parse-on-paste hook either (`type: 'button'` + `executeMethod` cannot write back into node parameters).

We therefore keep serve-time transpilation but split the single combined `Import Config` into two inputs, **Schema JSON** and **UI Schema JSON**, with an all-or-nothing rule: import happens only when both are non-empty; exactly one filled is an error naming the missing half. Combined `{schema, uiSchema}` wrapper documents pasted into either input are detected and rejected with a pointer to paste the inner half. Import issue paths re-root at `$` of each input, prefixed `Schema JSON:` / `UI Schema JSON:`. The node bumps to version 2; v1 is retained so workflows storing the legacy combined document keep working unchanged.

## Considered Options

- **Authoring-time populate (rejected)** — exact curl parity; unreachable without unsupported editor-UI injection.
- **Experimental modal via editor extensions (rejected)** — no loadable mechanism exists for community packages today.
- **Web-app converter page (rejected)** — achieves populate semantics but forces a context switch out of n8n.

## Consequences

- Raw JSON persists in node parameters and re-transpiles on every request — accepted as the price of a supported API.
- Users upgrading from v1 must re-paste their schema halves to adopt v2; v1 workflows are unaffected.
