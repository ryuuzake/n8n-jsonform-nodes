import { useEffect } from 'react';

import { FormPage } from '@/FormPage';
import { readPageConfig } from '@/pageConfig';
import { applyAccentTheme } from '@/theme';

export default function App() {
  const { schema, uiSchema, completionMessage, accentColor } = readPageConfig();

  useEffect(() => {
    applyAccentTheme(accentColor);
  }, [accentColor]);

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
