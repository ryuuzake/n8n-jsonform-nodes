import { shadcnCells, shadcnRenderers } from '@fragno-dev/jsonforms-shadcn-renderers';
import type { JsonSchema, UISchemaElement } from '@jsonforms/core';
import { createAjv } from '@jsonforms/core';
import { JsonForms } from '@jsonforms/react';
import { Check } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { submitSubmission } from '@/submitSubmission';

export interface FormPageProps {
  schema: JsonSchema;
  uiSchema: UISchemaElement;
  /** Shown on the success card after a submission was received. */
  completionMessage?: string;
}

const DEFAULT_COMPLETION_MESSAGE = 'Thank you! Your submission has been received.';

type SubmitStatus = 'idle' | 'submitting' | 'success' | 'error';

async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (typeof body.error === 'string' && body.error.length > 0) return body.error;
  } catch {
    // Fall through to the generic message below.
  }
  return `Submission failed (${response.status}). Please try again.`;
}

export function FormPage({ schema, uiSchema, completionMessage }: FormPageProps) {
  const [data, setData] = useState<Record<string, unknown>>({});
  const [status, setStatus] = useState<SubmitStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  // Gate submission on full-document validity (same Ajv setup JSONForms uses
  // internally), so the button is correct from first render — before any
  // change event has fired and without any network call.
  const ajv = useMemo(() => createAjv(), []);
  const validateData = useMemo(() => ajv.compile(schema), [ajv, schema]);
  const isValid = validateData(data);

  async function handleSubmit() {
    setStatus('submitting');
    setErrorMessage('');
    try {
      const response = await submitSubmission(data);
      if (!response.ok) {
        setErrorMessage(await extractErrorMessage(response));
        setStatus('error');
        return;
      }
      setStatus('success');
    } catch {
      setErrorMessage('Submission failed. Please check your connection and try again.');
      setStatus('error');
    }
  }

  if (status === 'success') {
    return (
      <Card className="w-full max-w-lg">
        <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
          <Check className="size-8 text-primary" aria-hidden="true" />
          <p className="text-lg font-medium">{completionMessage ?? DEFAULT_COMPLETION_MESSAGE}</p>
        </CardContent>
      </Card>
    );
  }

  const submitting = status === 'submitting';

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>Form</CardTitle>
        <CardDescription>Fill in the fields below.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {status === 'error' && (
          <Alert variant="destructive">
            <AlertTitle>Submission failed</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}
        {/* Entered values stay bound to `data`, so a failed submit preserves
            everything the user typed for retry. */}
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
        <Button
          type="button"
          disabled={!isValid || submitting}
          onClick={() => void handleSubmit()}
        >
          {submitting ? 'Submitting…' : 'Submit'}
        </Button>
      </CardFooter>
    </Card>
  );
}
