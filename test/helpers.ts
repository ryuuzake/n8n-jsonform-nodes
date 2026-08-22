import type { Field, Form } from "../src/form-definition/types";

export const formWith = (...fields: Field[]): Form => ({ fields });
