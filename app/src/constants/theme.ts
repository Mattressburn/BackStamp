/**
 * Design tokens. Every screen reads from here; nothing hardcodes a hex value.
 *
 * Direction: the content is the color. Vintage Pyrex is turquoise, pink, orange and
 * gold on milk-white glass, and it is loud. So the chrome recedes to warm neutrals
 * with a single accent, the way a gallery paints its walls off-white and lets the
 * work carry the room. Anything else fights the dishes.
 *
 * Neutrals are warm (a yellow-shifted grey), not the blue-grey most default palettes
 * ship. Cool greys make milk glass photograph dingy next to them.
 *
 * --- Reference lock (2026-08-10 design pass, via refero-design) ---
 *
 * PRIMARY: Fonts In Use — "typographic archive on vellum". A specimen index: condensed
 * display type, metadata stacked directly beneath its image, hairline rules instead of
 * shadows, near-square geometry, color reserved for content. Backstamp *is* a specimen
 * index — 379 items across 33 patterns and 30 forms — so the archive is not a costume.
 *
 * BORROWED, bounded:
 *   Palmer          -> warm canvas ground; an object floats with its own shadow, the
 *                      surface under it casts none. Ghost-first controls.
 *   F. M. Ricci     -> the accent is ceremonial. It appears as a hairline outline, and
 *                      as a solid fill at most once per screen.
 *
 * ROLE RULES — moving a token outside its role breaks the lock:
 *   Display face  = titles, labels, numerals. Never body copy, never prose.
 *   Accent        = interactive and ceremonial. Never a background field.
 *   Rarity colors = rank, and only rank.
 *   Colorway hex  = the specimen swatch in `colorways.ts`. Never UI chrome.
 *
 * REJECTED (these are what "unfinished" looked like): pillowy cards on drop shadows,
 * radius >= 12 on chrome, hierarchy carried by font size alone.
 */

import '@/global.css';

import { Platform, StyleSheet } from 'react-native';

export const Colors = {
  light: {
    text: '#14120F',              // warm near-black, never pure #000
    textSecondary: '#6B6660',
    textTertiary: '#9A948B',
    background: '#F6F4EC',        // vellum, not white — the archive's paper ground
    surface: '#FDFCF7',
    backgroundElement: '#EDEAE0',
    backgroundSelected: '#E2DDD0',
    border: '#DCD7C9',            // hairline rules do the work shadows used to
    accent: '#2E8B84',            // Butterprint turquoise, muted to survive as UI
    accentText: '#FFFFFF',
    have: '#2E8B84',
    want: '#B4761F',
    danger: '#A33A2E',
    scrim: 'rgba(20,18,15,0.55)',
  },
  dark: {
    text: '#F5F2EC',
    textSecondary: '#A09A91',
    textTertiary: '#726C64',
    background: '#131211',
    surface: '#1C1A18',
    backgroundElement: '#232120',
    backgroundSelected: '#2E2B27',
    border: '#332F2A',
    accent: '#5FBDB4',
    accentText: '#0E1918',
    have: '#5FBDB4',
    want: '#E0A34B',
    danger: '#E0705F',
    scrim: 'rgba(0,0,0,0.65)',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * Rarity is the one place loud color is correct: it is a rank, and collectors read
 * it at a glance. Ordered common -> grail.
 */
export const RarityColors = {
  light: {
    common: '#9A948B',
    uncommon: '#4A7C59',
    'hard-to-find': '#2E6F8B',
    rare: '#8B5E2E',
    grail: '#8B2E52',
  },
  dark: {
    common: '#726C64',
    uncommon: '#7FB68E',
    'hard-to-find': '#6FAECB',
    rare: '#C79A63',
    grail: '#D4728F',
  },
} as const;

/**
 * Two families, two jobs.
 *
 * `display` is Oswald, subset to Latin and instanced to two static weights (~23KB
 * each). It is the condensed, architectural voice the archive reference carries in
 * Relay Cond — Oswald is that reference's own named substitute, not a taste pick.
 * It sets titles, small caps labels, and numerals. It never sets prose: condensed
 * faces cost reading speed at body sizes, and body copy is where Dynamic Type and
 * font scaling actually matter.
 *
 * `sans` stays the platform's own face for everything readable — SF Pro on iOS,
 * Roboto on Android — so body text keeps the scaling behaviour users have already
 * configured, at zero bundle cost.
 */
export const FontAssets = {
  'Oswald-Regular': require('@/assets/fonts/Oswald-Regular.ttf'),
  'Oswald-SemiBold': require('@/assets/fonts/Oswald-SemiBold.ttf'),
} as const;

const platformSans = Platform.select({
  ios: 'system-ui',
  web: 'var(--font-display)',
  default: 'normal',
})!;

export const Fonts = {
  display: 'Oswald-SemiBold',
  displayLight: 'Oswald-Regular',
  sans: platformSans,
  mono: Platform.select({ ios: 'ui-monospace', web: 'var(--font-mono)', default: 'monospace' })!,
} as const;

/**
 * Display roles are condensed and tracked; text roles are the system face at normal
 * tracking. Keeping tracking off body copy is deliberate — it is a display trait in
 * every reference that uses it, and it costs legibility when it migrates.
 *
 * 11px is the floor. The archive reference sets captions at 10px on a desktop
 * monitor; a phone held at arm's length in a thrift aisle is not that.
 */
export const Type = {
  /** Screen titles. */
  display: {
    fontFamily: Fonts.display,
    fontSize: 36,
    lineHeight: 40,
    letterSpacing: 0.2,
  },
  /** Section and item titles. */
  title: {
    fontFamily: Fonts.display,
    fontSize: 25,
    lineHeight: 28,
    letterSpacing: 0.2,
  },
  /** Card titles, section headers. */
  headline: {
    fontFamily: Fonts.display,
    fontSize: 19,
    lineHeight: 23,
    letterSpacing: 0.3,
  },
  /** Uppercase metadata labels — the specimen index's spine. */
  label: {
    fontFamily: Fonts.display,
    fontSize: 12,
    lineHeight: 15,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  /** Model numbers, prices, counts. Tabular where it matters. */
  numeral: {
    fontFamily: Fonts.display,
    fontSize: 17,
    lineHeight: 21,
    letterSpacing: 0.4,
  },
  numeralLarge: {
    fontFamily: Fonts.display,
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: 0.4,
  },

  // --- text roles: system face, normal tracking, untouched scaling ---
  body: { fontFamily: Fonts.sans, fontSize: 16, lineHeight: 22, fontWeight: '400' },
  bodyStrong: { fontFamily: Fonts.sans, fontSize: 16, lineHeight: 22, fontWeight: '600' },
  callout: { fontFamily: Fonts.sans, fontSize: 15, lineHeight: 20, fontWeight: '400' },
  caption: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 18, fontWeight: '400' },
  micro: { fontFamily: Fonts.sans, fontSize: 11, lineHeight: 14, fontWeight: '600' },
} as const;

/** 4pt grid. `three` (16) is the default screen gutter. */
export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/**
 * Low and near-square. The archive reference sets 2px; this raises it to 4 for touch
 * without turning chrome pillowy. `pill` survives for exactly two things — the one
 * primary action on a screen, and rank chips — so roundness reads as emphasis
 * instead of as the default.
 */
export const Radius = {
  xs: 2,
  sm: 4,
  md: 4,
  lg: 8,
  xl: 8,
  pill: 999,
} as const;

/** A hairline rule. Separation is drawn, not lit. */
export const Rule = StyleSheet.hairlineWidth;

/**
 * Elevation is for objects and sheets, not for cards.
 *
 * `object` is the soft shadow a physical piece casts on the shelf — it belongs to the
 * specimen tile and to nothing else. Cards separate with `Rule` and a surface tint.
 * Spread these rather than writing shadow properties inline, or one platform silently
 * gets nothing.
 */
export const Elevation = {
  object: Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOpacity: 0.1,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 5 },
    },
    android: { elevation: 3 },
    default: {},
  })!,
  sheet: Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOpacity: 0.16,
      shadowRadius: 28,
      shadowOffset: { width: 0, height: -6 },
    },
    android: { elevation: 12 },
    default: {},
  })!,
} as const;

/**
 * Motion is confirmation, not decoration: it says a thing happened and where it went.
 * Durations stay under a fifth of a second so nothing waits on an animation. Anything
 * longer than `settle` needs a reason.
 */
export const Motion = {
  press: 90,
  enter: 160,
  settle: 240,
  /** Standard ease-out. Fast start, soft landing — reads as physical. */
  easing: [0.22, 1, 0.36, 1] as const,
  /** How far a card lifts into place on first paint. */
  enterOffset: 8,
  pressScale: 0.98,
} as const;

/** Apple HIG and Material both land on 44dp as the floor for a tappable target. */
export const HitTarget = 44;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
