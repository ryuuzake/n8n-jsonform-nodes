import { describe, expect, it } from 'vitest';

import { injectPageConfig } from './formPage';

const template = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Form</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="application/json" id="jsonform-config">{}</script>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

describe('injectPageConfig', () => {
  it('replaces the config blob with the serialized configuration', () => {
    const config = {
      schema: { type: 'object', properties: { name: { type: 'string' } } },
      uiSchema: { type: 'VerticalLayout', elements: [] },
    };

    const html = injectPageConfig(template, config);

    expect(html).toContain('"type":"VerticalLayout"');
    expect(html).not.toContain('>{}</script>');
  });

  it('keeps the rest of the page intact', () => {
    const html = injectPageConfig(template, { schema: {}, uiSchema: {} });

    expect(html).toContain('<title>Form</title>');
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('<!doctype html>');
  });

  it('escapes closing script tags inside values so the blob cannot break out', () => {
    const config = {
      schema: {
        type: 'object',
        properties: {
          evil: { type: 'string', title: '</script><script>alert(1)</script>' },
        },
      },
      uiSchema: {},
    };

    const html = injectPageConfig(template, config);

    const blobStart = html.indexOf('id="jsonform-config">') + 'id="jsonform-config">'.length;
    const blobEnd = html.indexOf('</script>', blobStart);
    const blob = html.slice(blobStart, blobEnd);

    expect(() => JSON.parse(blob)).not.toThrow();
    expect(JSON.parse(blob)).toEqual(config);
    expect(html.slice(0, blobEnd)).not.toContain('</script><script>alert(1)');
  });

  it('fails loudly when the template has no config blob', () => {
    const noBlob = '<html><body>no marker here</body></html>';

    expect(() => injectPageConfig(noBlob, { schema: {} })).toThrow(/jsonform-config/);
  });

  it('fails loudly when the template has more than one config blob', () => {
    const doubleBlob = `<html><body>
      <script type="application/json" id="jsonform-config">{}</script>
      <script type="application/json" id="jsonform-config">{}</script>
    </body></html>`;

    expect(() => injectPageConfig(doubleBlob, { schema: {} })).toThrow(/exactly one/i);
  });
});
