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
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#14120F',              // warm near-black, never pure #000
    textSecondary: '#6B6660',
    textTertiary: '#9A948B',
    background: '#FBFAF7',        // milk glass
    surface: '#FFFFFF',
    backgroundElement: '#F2EFE9',
    backgroundSelected: '#E7E2D8',
    border: '#E6E2DA',
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
    border: '#2E2B27',
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

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
})!;

/**
 * System fonts on purpose. SF Pro on iOS and Roboto on Android are what each
 * platform's users already read at speed, they ship Dynamic Type and font scaling
 * for free, and they cost zero bundle bytes. A custom face here would be decoration
 * paid for in accessibility.
 */
export const Type = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: '700' },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  headline: { fontSize: 19, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  callout: { fontSize: 15, lineHeight: 20, fontWeight: '400' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  micro: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
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

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

/**
 * iOS draws shadows, Android draws elevation. Spread these rather than writing
 * shadow properties inline, or one platform silently gets nothing.
 */
export const Elevation = {
  card: Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOpacity: 0.07,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
    },
    android: { elevation: 2 },
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

/** Apple HIG and Material both land on 44dp as the floor for a tappable target. */
export const HitTarget = 44;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
