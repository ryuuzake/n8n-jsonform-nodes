export class FormDefinitionError extends Error {
  override name = "FormDefinitionError";
}

export class FieldNamePatternError extends FormDefinitionError {
  override name = "FieldNamePatternError";

  constructor(
    readonly index: number,
    readonly fieldName: string,
  ) {
    super(
      `Field ${index} ("${fieldName}") has an invalid name: field names must match /^[A-Za-z_][A-Za-z0-9_]*$/.`,
    );
  }
}

export class ReservedFieldNameError extends FormDefinitionError {
  override name = "ReservedFieldNameError";

  constructor(
    readonly index: number,
    readonly fieldName: string,
  ) {
    super(`Field ${index} uses the reserved name "${fieldName}", which is set by the system.`);
  }
}

export class DuplicateFieldNameError extends FormDefinitionError {
  override name = "DuplicateFieldNameError";

  constructor(
    readonly index: number,
    readonly fieldName: string,
    readonly firstIndex: number,
  ) {
    super(
      `Field ${index} duplicates the name "${fieldName}" already used by field ${firstIndex}; names must be unique within a Form.`,
    );
  }
}

export class UnknownFieldTypeError extends FormDefinitionError {
  override name = "UnknownFieldTypeError";

  constructor(
    readonly index: number,
    readonly type: string,
  ) {
    super(`Field ${index} has unknown type "${type}".`);
  }
}

export class MissingChoicesError extends FormDefinitionError {
  override name = "MissingChoicesError";

  constructor(
    readonly index: number,
    readonly fieldName: string,
    readonly type: string,
  ) {
    super(`Field ${index} ("${fieldName}") of type "${type}" requires a non-empty choices list.`);
  }
}

export class InvalidConstraintError extends FormDefinitionError {
  override name = "InvalidConstraintError";

  constructor(
    readonly index: number,
    readonly fieldName: string,
    detail: string,
  ) {
    super(`Field ${index} ("${fieldName}") has an invalid constraint: ${detail}`);
  }
}

