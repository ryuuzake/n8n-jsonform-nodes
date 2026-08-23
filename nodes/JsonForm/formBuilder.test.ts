import { describe, expect, it } from 'vitest';

import { buildFormFromParameters } from './formBuilder';

/** Shape n8n stores for an editable fixedCollection parameter. */
const fieldsParam = (...entries: Array<Record<string, unknown>>) => ({ field: entries });

describe('buildFormFromParameters', () => {
  it('builds a Form with title and description from node parameters', () => {
    const form = buildFormFromParameters({
      formTitle: 'Feedback',
      formDescription: 'Tell us more',
      fields: fieldsParam({ name: 'rating', label: 'Rating', type: 'number' }),
    });

    expect(form).toEqual({
      title: 'Feedback',
      description: 'Tell us more',
      fields: [{ name: 'rating', label: 'Rating', type: 'number' }],
    });
  });

  it('omits empty or missing title and description', () => {
    const form = buildFormFromParameters({
      formTitle: '',
      fields: fieldsParam(),
    });

    expect(form).toEqual({ fields: [] });
  });

  it('normalizes every v1 field type with its applicable constraints', () => {
    const form = buildFormFromParameters({
      fields: fieldsParam(
        { name: 'name', label: 'Name', type: 'text', required: true, maxLength: '100' },
        { name: 'bio', label: 'Bio', type: 'textarea', maxLength: 500 },
        { name: 'age', label: 'Age', type: 'number', min: 0, max: '130' },
        { name: 'birthday', label: 'Birthday', type: 'date', minDate: '2020-01-01', maxDate: '2030-12-31' },
        { name: 'subscribe', label: 'Subscribe', type: 'boolean', required: true },
        { name: 'color', label: 'Color', type: 'select', choices: ['red', 'green'] },
        { name: 'tags', label: 'Tags', type: 'multiselect', choices: ['a', 'b'], required: true },
      ),
    });

    expect(form.fields).toEqual([
      { name: 'name', label: 'Name', type: 'text', required: true, maxLength: 100 },
      { name: 'bio', label: 'Bio', type: 'textarea', maxLength: 500 },
      { name: 'age', label: 'Age', type: 'number', min: 0, max: 130 },
      {
        name: 'birthday',
        label: 'Birthday',
        type: 'date',
        minDate: '2020-01-01',
        maxDate: '2030-12-31',
      },
      { name: 'subscribe', label: 'Subscribe', type: 'boolean', required: true },
      { name: 'color', label: 'Color', type: 'select', choices: ['red', 'green'] },
      { name: 'tags', label: 'Tags', type: 'multiselect', required: true, choices: ['a', 'b'] },
    ]);
  });

  it('omits absent optional flags instead of writing nulls or undefined', () => {
    const form = buildFormFromParameters({
      fields: fieldsParam({ name: 'notes', label: 'Notes', type: 'text' }),
    });

    expect(form.fields).toEqual([{ name: 'notes', label: 'Notes', type: 'text' }]);
    expect('required' in form.fields[0]!).toBe(false);
    expect('maxLength' in form.fields[0]!).toBe(false);
  });

  it('drops empty-string optional values left behind by cleared inputs', () => {
    const form = buildFormFromParameters({
      fields: fieldsParam({
        name: 'score',
        label: 'Score',
        type: 'number',
        min: '',
        max: '',
        required: false,
      }),
    });

    expect(form.fields).toEqual([{ name: 'score', label: 'Score', type: 'number' }]);
  });

  it('reads minLength for text and textarea entries', () => {
    const form = buildFormFromParameters({
      fields: fieldsParam(
        { name: 'code', label: 'Code', type: 'text', minLength: '4' },
        { name: 'bio', label: 'Bio', type: 'textarea', minLength: 10 },
        { name: 'age', label: 'Age', type: 'number', minLength: '2' },
      ),
    });

    expect(form.fields[0]).toMatchObject({ name: 'code', minLength: 4 });
    expect(form.fields[1]).toMatchObject({ name: 'bio', minLength: 10 });
    // Constraints that do not apply to the chosen type never leak.
    expect('minLength' in form.fields[2]!).toBe(false);
  });

  it('reads a visibility condition, coercing true/false literals to booleans', () => {
    const form = buildFormFromParameters({
      fields: fieldsParam(
        { name: 'subscribe', label: 'Subscribe', type: 'boolean' },
        {
          name: 'address',
          label: 'Address',
          type: 'text',
          visibleWhenField: 'subscribe',
          visibleWhenValue: 'true',
        },
        {
          name: 'other',
          label: 'Other',
          type: 'text',
          visibleWhenField: 'subscribe',
          visibleWhenValue: 'false',
        },
        {
          name: 'detail',
          label: 'Detail',
          type: 'textarea',
          visibleWhenField: 'subscribe',
          visibleWhenValue: 'yes',
        },
      ),
    });

    expect(form.fields[1]?.visibleWhen).toEqual({ field: 'subscribe', equals: true });
    expect(form.fields[2]?.visibleWhen).toEqual({ field: 'subscribe', equals: false });
    expect(form.fields[3]?.visibleWhen).toEqual({ field: 'subscribe', equals: 'yes' });
  });

  it('ignores a visibility condition with no referenced field', () => {
    const form = buildFormFromParameters({
      fields: fieldsParam({
        name: 'maybe',
        label: 'Maybe',
        type: 'text',
        visibleWhenValue: 'true',
      }),
    });

    expect('visibleWhen' in form.fields[0]!).toBe(false);
  });

  it('fails fast when a visibility condition names a field but no value', () => {
    expect(() =>
      buildFormFromParameters({
        fields: fieldsParam({
          name: 'maybe',
          label: 'Maybe',
          type: 'text',
          visibleWhenField: 'subscribe',
          visibleWhenValue: '',
        }),
      }),
    ).toThrow(/Visible When Field.*but no Visible When Value/i);
  });

  it('keeps order so authors can reorder fields in the collection editor', () => {
    const form = buildFormFromParameters({
      fields: fieldsParam(
        { name: 'first', label: 'First', type: 'text' },
        { name: 'second', label: 'Second', type: 'text' },
      ),
    });

    expect(form.fields.map((field) => field.name)).toEqual(['first', 'second']);
  });

  describe('type-specific constraint filtering', () => {
    it('ignores constraints that do not apply to the chosen type', () => {
      const form = buildFormFromParameters({
        fields: fieldsParam({
          name: 'mixed',
          label: 'Mixed',
          type: 'number',
          maxLength: 10,
          minDate: '2020-01-01',
          choices: ['nope'],
        }),
      });

      expect(form.fields).toEqual([
        { name: 'mixed', label: 'Mixed', type: 'number' },
      ]);
    });

    it('reads maxLength only for text and textarea', () => {
      const text = buildFormFromParameters({
        fields: fieldsParam({ name: 'a', label: 'A', type: 'text', maxLength: 7 }),
      });
      const textarea = buildFormFromParameters({
        fields: fieldsParam({ name: 'b', label: 'B', type: 'textarea', maxLength: 9 }),
      });
      const booleanField = buildFormFromParameters({
        fields: fieldsParam({ name: 'c', label: 'C', type: 'boolean', maxLength: 9 }),
      });

      expect(text.fields[0]).toHaveProperty('maxLength', 7);
      expect(textarea.fields[0]).toHaveProperty('maxLength', 9);
      expect(booleanField.fields[0]).not.toHaveProperty('maxLength');
    });

    it('reads choices only for select and multiselect', () => {
      const select = buildFormFromParameters({
        fields: fieldsParam({ name: 'a', label: 'A', type: 'select', choices: ['x'] }),
      });
      const multiselect = buildFormFromParameters({
        fields: fieldsParam({ name: 'b', label: 'B', type: 'multiselect', choices: ['x', 'y'] }),
      });

      expect(select.fields[0]).toHaveProperty('choices', ['x']);
      expect(multiselect.fields[0]).toHaveProperty('choices', ['x', 'y']);
    });
  });

  describe('invalid parameter values', () => {
    it('rejects non-numeric min/max/maxLength with an error naming the field', () => {
      expect(() =>
        buildFormFromParameters({
          fields: fieldsParam({ name: 'age', label: 'Age', type: 'number', min: 'abc' }),
        }),
      ).toThrow(/age/i);
    });

    it.each([
      [42, /fields/i],
      [{ field: 'nope' }, /fields/i],
      [{ field: [13] }, /field/i],
    ])('rejects malformed fields parameter %j', (raw, errorMatch) => {
      expect(() => buildFormFromParameters({ fields: raw })).toThrow(errorMatch);
    });

    it('rejects choice lists that are not string arrays', () => {
      expect(() =>
        buildFormFromParameters({
          fields: fieldsParam({ name: 'a', label: 'A', type: 'select', choices: 'x,y' }),
        }),
      ).toThrow(/choice/i);
    });
  });
});
