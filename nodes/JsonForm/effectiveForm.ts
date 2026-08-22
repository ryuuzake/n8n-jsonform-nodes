import { parseImportDocument, transpileConfig, ConfigImportError } from '../../src/form-import';
import type { Form } from '../../src/form-definition';

import { sampleForm } from './sampleForm';

/**
 * Resolve the Form a request must serve or validate against.
 *
 * A non-empty Import Config parameter is transpiled into Fields and replaces
 * the builder-defined Fields wholesale — JSON Schema is an interchange
 * format, never a second storage model. Until the builder slice lands, the
 * fixture sample Form stands in for builder-authored Fields. Import problems
 * surface as ConfigImportError with exact paths; callers decide how to
 * present them.
 */
export function resolveEffectiveForm(importConfig: unknown): Form {
  const raw = typeof importConfig === 'string' ? importConfig.trim() : '';
  if (!raw) return sampleForm;
  return transpileConfig(parseImportDocument(raw));
}

export { ConfigImportError };
