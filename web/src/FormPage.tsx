import { shadcnCells, shadcnRenderers } from '@fragno-dev/jsonforms-shadcn-renderers';
import type { JsonSchema, UISchemaElement } from '@jsonforms/core';
import { createAjv } from '@jsonforms/core';
import { JsonForms } from '@jsonforms/react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export interface FormPageProps {
  schema: JsonSchema;
  uiSchema: UISchemaElement;
  /** Submission is wired by the submission-loop slice; validation stays client-side until then. */
  onSubmit?: (data: Record<string, unknown>) => void;
}

export function FormPage({ schema, uiSchema, onSubmit }: FormPageProps) {
  const [data, setData] = useState<Record<string, unknown>>({});

  // Gate submission on full-document validity (same Ajv setup JSONForms uses
  // internally), so the button is correct from first render — before any
  // change event has fired and without any network call.
  const ajv = useMemo(() => createAjv(), []);
  const validateData = useMemo(() => ajv.compile(schema), [ajv, schema]);
  const isValid = validateData(data);

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>Form</CardTitle>
        <CardDescription>Fill in the fields below.</CardDescription>
      </CardHeader>
      <CardContent>
        <JsonForms
          schema={schema}
          uischema={uiSchema}
          data={data}
          renderers={shadcnRenderers}
          cells={shadcnCells}
          onChange={({ data: newData }) => {
            setData(newData ?? {});
          }}
        />
      </CardContent>
      <CardFooter>
        <Button type="button" disabled={!isValid} onClick={() => onSubmit?.(data)}>
          Submit
        </Button>
      </CardFooter>
    </Card>
  );
}
