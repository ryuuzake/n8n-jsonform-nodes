import type { JsonSchema, UISchemaElement } from '@jsonforms/core';

/**
 * The page configuration contract between the n8n node and this bundled app.
 * The node serializes it into the `<script type="application/json"
 * id="jsonform-config">` blob in index.html before serving the page.
 */
export interface PageConfig {
  schema: JsonSchema;
  uiSchema: UISchemaElement;
}

const CONFIG_ELEMENT_ID = 'jsonform-config';

/** Read and parse the configuration blob embedded in the served HTML. */
export function readPageConfig(): PageConfig {
  const element = document.getElementById(CONFIG_ELEMENT_ID);
  if (!element) {
    throw new Error(
      `Missing Form configuration blob (<script type="application/json" id="${CONFIG_ELEMENT_ID}">).`,
    );
  }
  return JSON.parse(element.textContent ?? '') as PageConfig;
}
