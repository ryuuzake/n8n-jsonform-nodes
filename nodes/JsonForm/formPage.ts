/**
 * Page-serving seam between the n8n node and the bundled single-file web app.
 *
 * The built page (web/dist/index.html -> nodes/JsonForm/form.html) contains a
 * placeholder configuration blob:
 *
 *   <script type="application/json" id="jsonform-config">...</script>
 *
 * The node injects the real Form configuration into that blob before serving
 * the page on a webhook GET.
 */

import fs from 'fs';
import path from 'path';

const CONFIG_BLOB_PATTERN =
  /<script type="application\/json" id="jsonform-config">[\s\S]*?<\/script>/g;

/** The single-file HTML artifact produced by the web build (`npm run build`). */
const TEMPLATE_FILE = 'form.html';

/**
 * Load the built page from disk. The build places `form.html` next to the
 * compiled node (both in the source tree and in dist/).
 */
export function loadFormTemplate(): string {
  const templatePath = path.join(__dirname, TEMPLATE_FILE);
  try {
    return fs.readFileSync(templatePath, 'utf8');
  } catch {
    throw new Error(
      `Form page template not found at ${templatePath}. Run "npm run build" to produce the single-file web bundle.`,
    );
  }
}

export interface FormPageResponse {
  statusCode: number;
  contentType: string;
  body: string;
}

/**
 * Build the HTTP payload served on webhook GET: the self-contained page with
 * the Form configuration blob injected.
 */
export function buildFormPageResponse(
  config: unknown,
  loadTemplate: () => string = loadFormTemplate,
): FormPageResponse {
  return {
    statusCode: 200,
    contentType: 'text/html; charset=utf-8',
    body: injectPageConfig(loadTemplate(), config),
  };
}


/**
 * Serialize config as JSON that is safe to embed inside a <script> element:
 * `<` is escaped so `</script>` in user-controlled values cannot terminate the
 * blob early.
 */
export function serializeConfig(config: unknown): string {
  return JSON.stringify(config).replace(/</g, '\\u003c');
}

export function injectPageConfig(html: string, config: unknown): string {
  const matches = html.match(CONFIG_BLOB_PATTERN);
  if (!matches) {
    throw new Error(
      'Form page template does not contain a JSON Forms configuration blob ' +
        '(<script type="application/json" id="jsonform-config">). Rebuild the web bundle.',
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Form page template must contain exactly one config blob, found ${matches.length}.`,
    );
  }

  const replacement = `<script type="application/json" id="jsonform-config">${serializeConfig(
    config,
  )}</script>`;
  return html.replace(CONFIG_BLOB_PATTERN, () => replacement);
}
