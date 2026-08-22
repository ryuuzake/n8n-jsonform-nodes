/**
 * Accent Color theming seam: maps a user-chosen accent onto the renderer's
 * primary shadcn theme variables so buttons, focus rings, and other
 * interactive elements pick it up in both light and dark mode.
 *
 * The overrides are applied as inline custom properties on <html>, which beat
 * both the `:root` and `.dark` stylesheet blocks regardless of system scheme,
 * while every other variable keeps its stock value. Unset/invalid accents are
 * a strict no-op so the page renders exactly the stock theme.
 */

/** Stock shadcn foreground tokens from index.css, reused for palette consistency. */
const LIGHT_FOREGROUND = 'oklch(0.985 0 0)';
const DARK_FOREGROUND = 'oklch(0.21 0.006 285.885)';

/** Perceived brightness threshold (YIQ) above which dark text reads better. */
const BRIGHTNESS_THRESHOLD = 150;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseHexColor(value: string): Rgb | null {
  if (!/^#[\da-f]{3}$|^#[\da-f]{6}$/i.test(value)) return null;
  const hex = value.slice(1);
  const expanded = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  return {
    r: parseInt(expanded.slice(0, 2), 16),
    g: parseInt(expanded.slice(2, 4), 16),
    b: parseInt(expanded.slice(4, 6), 16),
  };
}

function parseRgbColor(value: string): Rgb | null {
  const match = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(value);
  if (!match) return null;

  const [r, g, b] = match.slice(1).map(Number);
  if ([r, g, b].some((channel) => channel > 255)) return null;
  return { r, g, b };
}

function parseColor(value: string): Rgb | null {
  return parseHexColor(value) ?? parseRgbColor(value);
}

/** Pick white-ish or black text depending on which reads better on the accent. */
function foregroundFor({ r, g, b }: Rgb): string {
  const brightness = (299 * r + 587 * g + 114 * b) / 1000;
  return brightness > BRIGHTNESS_THRESHOLD ? DARK_FOREGROUND : LIGHT_FOREGROUND;
}

/**
 * The CSS variable overrides for an Accent Color, or `null` when the value is
 * unset or not a supported color (hex or rgb(); in which case the stock theme
 * must apply).
 */
export function accentCssVariables(accentColor: unknown): Record<string, string> | null {
  if (typeof accentColor !== 'string') return null;
  const color = accentColor.trim();
  if (!color) return null;

  const rgb = parseColor(color);
  if (!rgb) return null;

  return {
    '--primary': color,
    '--ring': color,
    '--primary-foreground': foregroundFor(rgb),
  };
}

/** Apply the Accent Color theme inline on <html>; no-op without a valid color. */
export function applyAccentTheme(accentColor?: string): void {
  const vars = accentCssVariables(accentColor);
  if (!vars) return;

  for (const [name, value] of Object.entries(vars)) {
    document.documentElement.style.setProperty(name, value);
  }
}
