import { FormPage } from '@/FormPage';
import { readPageConfig } from '@/pageConfig';

export default function App() {
  const { schema, uiSchema, completionMessage } = readPageConfig();

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <FormPage
        schema={schema}
        uiSchema={uiSchema}
        completionMessage={completionMessage}
      />
    </main>
  );
}
