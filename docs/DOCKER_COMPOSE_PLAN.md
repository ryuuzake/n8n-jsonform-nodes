# Plan: Run n8n + n8n-jsonform-nodes in Docker (bound to 0.0.0.0)

## Goal

A `docker compose up` that starts official n8n on all interfaces (port 5678)
with this repo's JsonForm node loaded as a community/custom node plugin.

## Findings (verified against `n8nio/n8n:latest`)

- Installing the package inside `/usr/local/lib/node_modules/n8n` fails with
  `EUNSUPPORTEDPROTOCOL "catalog:"` — the image now ships pnpm catalogs, so the
  old `cd ... && npm install <pkg>` pattern is dead.
- n8n loads custom nodes via `N8N_CUSTOM_EXTENSIONS` (`;`-separated dir list).
  `CustomDirectoryLoader` globs `**/*.node.js` directly inside each listed
  directory and requires it — no npm involved at runtime.
- `require('n8n-workflow')` resolves by walking up parent directories, so the
  package must sit under `<dir>/node_modules/` with an `n8n-workflow` symlink
  next to it.
- Plain `npm ci` in the build stage dies building `isolated-vm` (transitive dep
  of `n8n-workflow`) on Alpine — no Python/musl toolchain. Not needed for
  compiling; skip lifecycle scripts.

## Files

### 1. `Dockerfile` (done)

Multi-stage build:

1. **Build stage** (`node:22-alpine`):
   - `npm ci --ignore-scripts` (skips isolated-vm native build).
   - Install web deps + full source, run `npm run build`
     (vite web bundle -> `nodes/JsonForm/form.html`, then `tsc` -> `dist/`).
2. **Final stage** (`n8nio/n8n:latest`, as root):
   - Copy `dist/` + `package.json` to
     `/opt/custom/node_modules/n8n-nodes-jsonform/`.
   - Symlink `/opt/custom/node_modules/n8n-workflow` to n8n's own copy
     (`readlink -f /usr/local/lib/node_modules/n8n/node_modules/n8n-workflow`)
     instead of bundling a duplicate.
   - Set `ENV N8N_CUSTOM_EXTENSIONS=/opt/custom`, drop back to `USER node`.

### 2. `docker-compose.yml` (done)

- Service builds from the local `Dockerfile`.
- Ports: `"0.0.0.0:5678:5678"` (binds on every host interface) plus
  `N8N_LISTEN_ADDRESS=0.0.0.0` inside the container.
- Env:
  - `WEBHOOK_URL=http://<lan-ip>:5678/` — set this so form trigger URLs work
    from other machines.
  - `N8N_SECURE_COOKIE=false` — allows login over plain HTTP from LAN IPs.
  - `GENERIC_TIMEZONE`, diagnostics disabled by default.
- Named volume `n8n_data` mounted at `/home/node/.n8n` for persistence.

### 3. `.dockerignore` (done)

Excludes `.git`, `node_modules` (root + web), `dist`, generated
`nodes/JsonForm/form.html`, tarballs.

## Remaining steps

1. `docker compose up --build -d`
2. Wait for migrations; check logs:
   `docker logs n8n-jsonform 2>&1 | grep -iE "jsonform|error|Editor"`
   — expect no load errors for the custom node.
3. Verify HTTP reachable on all interfaces:
   `curl -I http://127.0.0.1:5678/` and `curl -I http://<lan-ip>:5678/`
4. Open editor at `http://<host>:5678`, confirm the **JsonForm** node appears
   in the node palette under community nodes.

## Notes / gotchas

- Rebuild (`docker compose build`) after code changes; `/opt/custom` is baked
  into the image while workflow state lives in the `n8n_data` volume.
- If more packages are added later, drop them into
  `/opt/custom/node_modules/<pkg>/` and extend the symlink list as needed.
