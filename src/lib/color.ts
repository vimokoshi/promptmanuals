/**
 * Colour utility functions for the Prompt Manuals theme system.
 *
 * Converts hex colour values to CSS oklch format, which is required by the
 * shadcn/ui token system. Calculations are approximations suitable for
 * generating readable CSS tokens — not for pixel-perfect colour science.
 */

const HEX_PATTERN = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i;

/** Relative luminance using the sRGB approximation (BT.709 coefficients). */
function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Hue angle in degrees from normalised RGB components. */
function hueAngle(r: number, g: number, b: number, max: number, min: number): number {
  if (max === min) return 0;
  const delta = max - min;
  let h: number;
  if (max === r)      h = ((g - b) / delta) * 60;
  else if (max === g) h = (2 + (b - r) / delta) * 60;
  else                h = (4 + (r - g) / delta) * 60;
  return h < 0 ? h + 360 : h;
}

/**
 * Parsed colour components derived from a hex string.
 */
interface HexColour {
  /** Relative luminance in [0, 1]. */
  readonly luminance: number;
  /** CSS oklch() string suitable for use in custom properties. */
  readonly oklch: string;
}

/**
 * Converts a CSS hex colour (e.g. `"#9B1FCC"`) to an oklch representation.
 *
 * @returns `null` when `hex` is not a valid 3- or 6-digit hex colour.
 */
export function parseHexColour(hex: string): HexColour | null {
  const match = HEX_PATTERN.exec(hex);
  if (!match) return null;

  const r = parseInt(match[1], 16) / 255;
  const g = parseInt(match[2], 16) / 255;
  const b = parseInt(match[3], 16) / 255;

  const luminance = relativeLuminance(r, g, b);
  const max       = Math.max(r, g, b);
  const min       = Math.min(r, g, b);
  const chroma    = (max - min) * 0.4;
  const hue       = hueAngle(r, g, b, max, min);

  // Map luminance to oklch L channel (0.2–1.0 range for perceptual balance)
  const l = luminance * 0.8 + 0.2;
  const oklch = `oklch(${l.toFixed(3)} ${chroma.toFixed(3)} ${hue.toFixed(1)})`;

  return { luminance, oklch };
}

/**
 * Returns `"oklch(0.98 0 0)"` (near-white) for dark colours and
 * `"oklch(0.2 0 0)"` (near-black) for light colours — suitable for use as
 * the foreground token against a coloured primary background.
 */
export function contrastForeground(luminance: number): string {
  return luminance > 0.5 ? "oklch(0.2 0 0)" : "oklch(0.98 0 0)";
}
