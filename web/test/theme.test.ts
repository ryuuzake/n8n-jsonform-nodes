import { describe, expect, it } from 'vitest';

import { accentCssVariables } from '@/theme';

describe('accentCssVariables', () => {
  it('maps a dark accent onto the primary variables with light foreground text', () => {
    expect(accentCssVariables('#7c3aed')).toEqual({
      '--primary': '#7c3aed',
      '--ring': '#7c3aed',
      '--primary-foreground': 'oklch(0.985 0 0)',
    });
  });

  it('picks dark foreground text for bright accents like yellow', () => {
    const vars = accentCssVariables('#ffff00');

    expect(vars).not.toBeNull();
    expect(vars?.['--primary-foreground']).toBe('oklch(0.21 0.006 285.885)');
  });

  it('accepts rgb() colors', () => {
    expect(accentCssVariables('rgb(124, 58, 237)')?.['--primary']).toBe('rgb(124, 58, 237)');
  });

  it('normalizes short hex accents', () => {
    expect(accentCssVariables('#f0c')?.['--primary']).toBe('#f0c');
  });

  it.each([
    ['unset (empty string)', ''],
    ['whitespace', '   '],
    ['non-color text', 'purple'],
    ['incomplete hex', '#ff'],
    ['hex with alpha channel', '#7c3aed80'],
    ['rgba()', 'rgba(124, 58, 237, 0.5)'],
    ['out-of-range rgb()', 'rgb(300, 0, 0)'],
  ])('rejects %s so the stock theme stays untouched', (_label, value) => {
    expect(accentCssVariables(value)).toBeNull();
  });
});
