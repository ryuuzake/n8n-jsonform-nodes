export interface ConfigImportIssue {
  /** Path into the pasted document, e.g. `$.address.city` or `uiSchema.elements[2]`. */
  path: string;
  reason: string;
}

/**
 * Raised when an imported `{schema, uiSchema}` document cannot be mapped onto
 * the Field subset. Carries every offending path — imports fail wholesale,
 * never partially.
 */
export class ConfigImportError extends Error {
  override name = "ConfigImportError";

  constructor(readonly issues: readonly ConfigImportIssue[]) {
    super(
      issues.length === 1
        ? `${issues[0]?.path}: ${issues[0]?.reason}`
        : `Import config rejected with ${issues.length} problems:\n${issues
            .map((issue) => `- ${issue.path}: ${issue.reason}`)
            .join("\n")}`,
    );
  }
}
