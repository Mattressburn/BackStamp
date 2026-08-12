/**
 * Every pattern in the catalog documents its colorway as prose, "turquoise and
 * white", "white on pink", "brown on speckled beige". All 33 of them, no nulls. This
 * turns that sentence into the two colors it names, so a piece with no photograph
 * still arrives on screen wearing its actual colors instead of a grey box.
 *
 * It is a swatch, not a photograph, and the UI must say so wherever it appears. The
 * same rule that forbids a bare price applies here: a generated stand-in that reads
 * as a picture of the dish is a claim the data does not support. `SWATCH_SOURCE_LABEL`
 * is the caption; use it.
 *
 * Figure and ground come from the preposition, so word order is load-bearing:
 *   "white on pink"        -> pink body, white pattern
 *   "pink and white"       -> co-equal, first named is the body
 *   "turquoise"            -> solid body, no pattern color
 * Anything that does not parse falls back to neutral rather than guessing.
 */

export type Scheme = 'light' | 'dark';

/** The closed vocabulary the catalog actually uses, checked against all 33 patterns. */
const INK: Record<string, { light: string; dark: string }> = {
  white: { light: '#FAF8F2', dark: '#E8E4DA' },
  ivory: { light: '#F2EAD6', dark: '#DED5BE' },
  cream: { light: '#F5EDD9', dark: '#E0D7C0' },
  turquoise: { light: '#3FADA4', dark: '#4FBDB4' },
  pink: { light: '#E39BB0', dark: '#D98CA3' },
  red: { light: '#C0392B', dark: '#CE4B3D' },
  orange: { light: '#D97B29', dark: '#E08A3A' },
  rust: { light: '#A85427', dark: '#B86337' },
  yellow: { light: '#E3B93F', dark: '#D9B043' },
  gold: { light: '#C9A227', dark: '#D4AE3A' },
  wheat: { light: '#DFC98F', dark: '#CDB77E' },
  green: { light: '#5C8A4A', dark: '#6D9B5A' },
  avocado: { light: '#7A8A32', dark: '#8B9A45' },
  blue: { light: '#3E6E9E', dark: '#4E7EAE' },
  tan: { light: '#C4A882', dark: '#B49872' },
  beige: { light: '#DCCDB4', dark: '#C6B79E' },
  brown: { light: '#7A5230', dark: '#8A6240' },
  black: { light: '#26221D', dark: '#3A352E' },
};

/** Modifiers that shift a named color rather than naming one. */
const MODIFIERS = new Set(['pale', 'dark', 'medium', 'light', 'deep', 'speckled', 'graduated', 'solid']);

/** Words that describe the mark's form, not its color. */
const NOISE = new Set([
  'and', 'or', 'with', 'accents', 'stripes', 'bars', 'rings', 'dots', 'greens', 'on',
]);

export type Swatch = {
  /** The body of the piece, the glass itself. */
  ground: string;
  /** The printed or fired-on decoration. Null when the colorway names one color. */
  figure: string | null;
};

export const SWATCH_SOURCE_LABEL = 'colorway swatch, not a photo';

function shade(hex: string, amount: number): string {
  const value = parseInt(hex.slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  const shifted = channels.map((channel) =>
    Math.max(0, Math.min(255, Math.round(channel + (amount * (amount > 0 ? 255 - channel : channel))))),
  );
  return `#${shifted.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Reads the colorway sentence into a ground and a figure.
 *
 * Returns null when nothing in the sentence names a known color, so callers can fall
 * back to the neutral placeholder rather than render an invented palette.
 */
export function parseColorway(colorway: string | null | undefined, scheme: Scheme): Swatch | null {
  if (!colorway) return null;

  const words = colorway.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);

  // "X on Y" names figure before ground. Everything else lists the body first.
  const separator = words.indexOf('on');
  const before = separator === -1 ? words : words.slice(0, separator);
  const after = separator === -1 ? [] : words.slice(separator + 1);

  let pending: number | null = null;
  const pick = (source: string[]): string[] => {
    const found: string[] = [];
    for (const word of source) {
      if (MODIFIERS.has(word)) {
        pending = word === 'pale' || word === 'light' ? 0.25 : word === 'dark' || word === 'deep' ? -0.25 : null;
        continue;
      }
      if (NOISE.has(word)) continue;
      const entry = INK[word] ?? INK[word.replace(/s$/, '')];
      if (!entry) continue;
      found.push(pending === null ? entry[scheme] : shade(entry[scheme], pending));
      pending = null;
    }
    return found;
  };

  const leading = pick(before);
  const trailing = pick(after);

  // "white on pink": trailing is the glass, leading is the print.
  const ground = separator === -1 ? leading[0] : trailing[0];
  const figure = separator === -1 ? leading[1] ?? null : leading[0] ?? null;

  if (!ground) return null;
  return { ground, figure: figure === ground ? null : figure ?? null };
}

/**
 * The fallback when a colorway names nothing recognisable. These mirror
 * `Colors[scheme].backgroundElement` but are written out here so this module imports
 * nothing, it has to stay free of `react-native` to be testable under plain node.
 */
const NEUTRAL = { light: '#EDEAE0', dark: '#232120' } as const;

export function neutralSwatch(scheme: Scheme): Swatch {
  return { ground: NEUTRAL[scheme], figure: null };
}

/**
 * The stamp is pressed into whatever color the piece happens to be, and the catalog
 * runs from ivory to near-black ("black with brown rings", "brown on orange"). A fixed
 * ink disappears on one end or the other, so it follows the ground's luminance.
 *
 * Returns translucent values on purpose: the mark reads as debossed into the glass
 * rather than printed on top of it.
 */
export function inkOn(ground: string): { stroke: string; text: string } {
  const value = parseInt(ground.slice(1), 16);
  // Rec. 601 luma, close enough for a two-way light/dark decision and cheap.
  const luma =
    (0.299 * ((value >> 16) & 255) + 0.587 * ((value >> 8) & 255) + 0.114 * (value & 255)) / 255;

  return luma > 0.5
    ? { stroke: 'rgba(20,18,15,0.24)', text: 'rgba(20,18,15,0.28)' }
    : { stroke: 'rgba(255,252,246,0.30)', text: 'rgba(255,252,246,0.34)' };
}

/** The INK color words a prose sentence names. Canonical keys, plurals stripped,
 *  modifiers and noise words skipped, same vocabulary parseColorway reads. */
export function namedColors(text: string | null | undefined): Set<string> {
  const found = new Set<string>();
  if (!text) return found;

  const words = text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  for (const word of words) {
    if (MODIFIERS.has(word) || NOISE.has(word)) continue;
    const color = INK[word] ? word : word.replace(/s$/, '');
    if (INK[color]) found.add(color);
  }
  return found;
}

const EQUIVALENCE_GROUPS = [
  ['turquoise', 'blue'],
  ['yellow', 'gold', 'wheat'],
  ['green', 'avocado'],
  ['orange', 'rust'],
  ['tan', 'beige', 'brown'],
  ['white', 'cream', 'ivory'],
  ['pink', 'red'],
] as const;

function expandEquivalences(colors: Set<string>): Set<string> {
  const expanded = new Set(colors);
  for (const group of EQUIVALENCE_GROUPS) {
    if (group.some((color) => colors.has(color))) {
      for (const color of group) expanded.add(color);
    }
  }
  return expanded;
}

/** True only when BOTH sides name at least one known color AND their
 *  equivalence-expanded sets share nothing. No color words on either side means
 *  no contradiction; absence of evidence is not evidence of contradiction. */
export function colorsContradict(evidence: string, colorway: string | null | undefined): boolean {
  const evidenceColors = namedColors(evidence);
  const colorwayColors = namedColors(colorway);
  if (evidenceColors.size === 0 || colorwayColors.size === 0) return false;

  const expandedEvidence = expandEquivalences(evidenceColors);
  const expandedColorway = expandEquivalences(colorwayColors);
  return ![...expandedEvidence].some((color) => expandedColorway.has(color));
}
