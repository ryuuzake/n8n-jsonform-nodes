import { parseImportDocument, transpileConfig, ConfigImportError } from '../../src/form-import';
import type { Form } from '../../src/form-definition';

/**
 * Resolve the Form a request must serve or validate against.
 *
 * A non-empty Import Config parameter is transpiled into Fields and replaces
 * the builder-authored Fields wholesale — JSON Schema is an interchange
 * format, never a second storage model. When no import config is set, the
 * Form built in the node's Fields collection is used. Import problems surface
 * as ConfigImportError with exact paths; callers decide how to present them.
 */
export function resolveEffectiveForm(builderForm: Readonly<Form>, importConfig: unknown): Form {
  const raw = typeof importConfig === 'string' ? importConfig.trim() : '';
  if (!raw) return structuredCopyForm(builderForm);
  return transpileConfig(parseImportDocument(raw));
}

/** Copy so callers can never mutate a previously built Form through a request. */
function structuredCopyForm(form: Readonly<Form>): Form {
  return {
    ...(form.title !== undefined ? { title: form.title } : {}),
    ...(form.description !== undefined ? { description: form.description } : {}),
    fields: form.fields.map((field) => ({ ...field })),
  };
}

export { ConfigImportError };
