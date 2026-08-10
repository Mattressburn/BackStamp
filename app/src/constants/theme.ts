/**
 * Design tokens. Every screen reads from here; nothing hardcodes a hex value.
 *
 * --- Reference lock (2026-08-10, second design pass: Harvest File) ---
 *
 * This lock REPLACES the specimen-index lock that shipped earlier the same day. That
 * one is gone on purpose, not by drift. It set an archival type-specimen index on
 * vellum: condensed Oswald, hairline rules, radius 2 to 8, no card shadows. Harvest
 * File contradicts all four, so the two cannot coexist and half an app on each would
 * be worse than either. The decision to swap was made explicitly by the user.
 *
 * PRIMARY: a 1970s card file. Not a gallery wall that recedes behind the dishes, but
 * period furniture the dishes are filed inside. Avocado, harvest gold and spice brown
 * on toasted cream, which is what Pyrex itself was printed in during the years most of
 * this catalog covers. The drawer is `background`, each piece is a `surface` card.
 *
 * THE ONE STRUCTURAL MOVE: separation is a solid offset with no blur, in a darker tone
 * of the ground beneath, like ink pressed through an index card. It is not a drop
 * shadow. A blur radius anywhere in this app is a bug. The offset also carries the
 * press affordance: a button translates 3px down and loses its offset, so pressing it
 * looks like pressing a physical key. Nothing scales; `Motion.pressScale` is 1.
 *
 * ROLE RULES - moving a token outside its role breaks the lock:
 *   Elevation     = the printed-card offset. Never a blurred shadow.
 *   Accent        = avocado. Primary actions, active tab, and the header band. Unlike
 *                   the previous lock, a solid accent field IS correct here, but only
 *                   as the header band or a primary action, never as a page ground.
 *   Spice         = section labels, prices, and the scan action. Never a large field.
 *   Want          = harvest gold. The want star, the active file tab, the shutter.
 *   Rarity colors = rank, and only rank.
 *   Colorway hex  = the specimen swatch in `colorways.ts`. Never UI chrome.
 *   CameraChrome  = the scan flow only. It sits over a live camera feed, so it does
 *                   not follow the app theme; it is dark in both.
 *   OnAccent      = text and fills that land on a solid avocado or spice field.
 *   Display face  = Rubik at 900. Titles and figures. Never prose.
 *
 * TYPE: one family, Rubik, at 400 / 700 / 900. This reverses the previous lock's split
 * of a bundled display face over the platform body face. That split existed because a
 * condensed face costs reading speed at body sizes; Rubik is a normal-width grotesque
 * that reads fine at 14px, so the reason no longer applies. Titles are tight-tracked,
 * never letterspaced. Uppercase survives only at `label` and `micro`.
 *
 * REJECTED: blur on any shadow; hairline rules as the primary separator (they survive
 * only inside a card, dividing its rows); scale-on-press; cool greys.
 *
 * --- Two values the handoff did not specify, derived here ---
 *
 * DARK OFFSETS. The handoff gives a full dark palette and no dark shadow colors, and
 * its light card offset is a tan (#D8C9A6) that would read as a pale smear on a
 * #231D14 ground. So `Elevation` is keyed by scheme and the dark offsets are drawn
 * from the dark family: darker than the ground the card sits on, never lighter.
 *
 * WEB. The handoff specifies iOS shadow props and an Android border fallback, which
 * leaves the browser preview - our only QA surface - with no separation at all now
 * that hairlines are gone. `boxShadow` is used instead, uniformly: React Native 0.76
 * and later accept it on every platform, so one string replaces a three-way
 * Platform.select and the browser shows what the phone will. Unverified on a device.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#3A2C18',
    textSecondary: '#7A6A4E',
    textTertiary: '#8A7A5C',
    background: '#F1E7D3', // toasted cream, the file drawer
    surface: '#FBF6E9', // the index card
    backgroundElement: '#E4D8BE', // inactive tabs, quiet buttons, spec chips
    backgroundSelected: '#D9A521', // the active file tab
    border: '#D8C9A6',
    divider: '#EFE6D2', // the rule between rows inside one card
    accent: '#6E7A22', // avocado
    accentText: '#F7F0DE',
    headerBar: '#6E7A22',
    have: '#6E7A22',
    want: '#D9A521', // harvest gold
    danger: '#A33A2E',
    spice: '#8A4B23',
    scrim: 'rgba(42,35,24,0.55)',
  },
  dark: {
    text: '#F0E7D2',
    textSecondary: '#9A8C70',
    textTertiary: '#8A7A5C',
    background: '#231D14', // toasted brown, not neutral grey
    surface: '#2E271B',
    backgroundElement: '#332B1E',
    backgroundSelected: '#D9A521',
    border: '#3E3524',
    divider: '#3E3524',
    accent: '#8B9A2B',
    accentText: '#231D14',
    headerBar: '#3D4415',
    have: '#8B9A2B',
    want: '#D9A521',
    danger: '#E0705F',
    spice: '#C98A4B',
    scrim: 'rgba(0,0,0,0.6)',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * Rarity is the one place loud color is correct: it is a rank, and collectors read it
 * at a glance. Ordered common -> grail. Re-tuned to sit in the warm palette.
 */
export const RarityColors = {
  light: {
    common: '#8A7A5C',
    uncommon: '#6E7A22',
    'hard-to-find': '#D9A521',
    rare: '#8A4B23',
    grail: '#8B2E52',
  },
  dark: {
    common: '#8A7A5C',
    uncommon: '#8B9A2B',
    'hard-to-find': '#E0B94B',
    rare: '#C98A4B',
    grail: '#D4728F',
  },
} as const;

/**
 * The scan flow's own palette. It is laid over a live camera feed, so it does not
 * follow the app theme: a light-mode scan screen would wash out the viewfinder. Fixed
 * in both schemes on purpose.
 */
export const CameraChrome = {
  ground: '#2A2318',
  fill: 'rgba(247,240,222,0.10)',
  frameFill: 'rgba(247,240,222,0.06)',
  frameEdge: 'rgba(217,165,33,0.55)',
  guide: '#D9A521',
  guidePressed: '#A87C15',
  ghost: 'rgba(217,165,33,0.35)',
  ring: 'rgba(247,240,222,0.14)',
  text: '#F7F0DE',
  textDim: 'rgba(247,240,222,0.62)',
  textFaint: 'rgba(247,240,222,0.50)',
  flash: '#F7F0DE',
} as const;

/**
 * Text and fills that land on a solid avocado or spice field: the header band, the
 * confirmation screen, the offline banner. Translucent cream rather than a second
 * opaque color, so one set works on every accent field.
 */
export const OnAccent = {
  text: '#F7F0DE',
  textDim: 'rgba(247,240,222,0.72)',
  label: 'rgba(247,240,222,0.75)',
  labelDim: 'rgba(247,240,222,0.60)',
  caption: 'rgba(247,240,222,0.55)',
  fill: 'rgba(247,240,222,0.12)',
  fillStrong: 'rgba(247,240,222,0.16)',
  rule: 'rgba(247,240,222,0.20)',
} as const;

/**
 * One family, three weights. 900 sets titles and figures, 700 labels and buttons, 400
 * prose. Rubik is instanced from the variable font and subset to Latin plus the
 * punctuation the catalog uses (~38KB each).
 */
export const FontAssets = {
  'Rubik-Regular': require('@/assets/fonts/Rubik-Regular.ttf'),
  'Rubik-Bold': require('@/assets/fonts/Rubik-Bold.ttf'),
  'Rubik-Black': require('@/assets/fonts/Rubik-Black.ttf'),
} as const;

export const Fonts = {
  display: 'Rubik-Black',
  displayLight: 'Rubik-Bold',
  sans: 'Rubik-Regular',
  mono: Platform.select({ ios: 'ui-monospace', web: 'var(--font-mono)', default: 'monospace' })!,
} as const;

/** Titles are tight-tracked, not letterspaced. Uppercase survives only at the bottom. */
export const Type = {
  /** Screen titles. */
  display: { fontFamily: Fonts.display, fontSize: 34, lineHeight: 38, letterSpacing: -0.6 },
  /** Card titles. */
  title: { fontFamily: Fonts.display, fontSize: 27, lineHeight: 31, letterSpacing: -0.5 },
  /** Row titles. */
  headline: { fontFamily: Fonts.displayLight, fontSize: 17, lineHeight: 21, letterSpacing: 0 },
  /** Uppercase metadata labels. */
  label: {
    fontFamily: Fonts.displayLight,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
  },
  numeral: { fontFamily: Fonts.displayLight, fontSize: 15, lineHeight: 19 },
  /** Prices and counts. */
  numeralLarge: { fontFamily: Fonts.display, fontSize: 26, lineHeight: 30, letterSpacing: -0.4 },
  body: { fontFamily: Fonts.sans, fontSize: 14, lineHeight: 22 },
  bodyStrong: { fontFamily: Fonts.displayLight, fontSize: 14, lineHeight: 20 },
  callout: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 20 },
  caption: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18 },
  /** The smallest label. Uppercase, tracked. */
  micro: {
    fontFamily: Fonts.displayLight,
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
} as const;

/** 4pt grid. `three` (16) is the grid unit; screens gutter at `gutter`. */
export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
  /** The screen gutter the mocks are drawn on. Off-grid on purpose, at 20. */
  gutter: 20,
} as const;

/** Round, not pillowy. The file tab and the card corner are the same family. */
export const Radius = {
  xs: 8,
  sm: 12,
  md: 14,
  lg: 16,
  xl: 18,
  /** File tabs, top corners only. */
  tab: 12,
  /** Bottom sheets and the viewfinder frame. */
  xxl: 26,
  pill: 999,
} as const;

/**
 * A hairline. Demoted: it no longer separates cards, it only divides rows inside one
 * card, where `colors.divider` is its color. Card separation is `Elevation`.
 */
export const Rule = 1;

/**
 * The printed-card shadow: a solid offset, no blur, in a darker tone of the ground.
 *
 * Keyed by scheme because the offset colors are palette values, not black at an
 * opacity, read them through `useElevation()` in `collection-ui`, never as
 * `Elevation.card`. `boxShadow` rather than the iOS shadow props so the browser
 * preview shows the same thing the phone will.
 */
export function offsetShadow(height: number, color: string) {
  return { boxShadow: `0 ${height}px 0 ${color}` };
}

const OFFSET = {
  light: {
    card: '#D8C9A6',
    accent: '#55601A',
    gold: '#A87C15',
    spice: '#6B3819',
  },
  dark: {
    card: '#17120C',
    accent: '#5A6619',
    gold: '#8F6510',
    spice: '#8A5A2B',
  },
} as const;

function elevationFor(scheme: 'light' | 'dark') {
  const offset = OFFSET[scheme];
  return {
    /** Rows, group cards, the search field. */
    card: offsetShadow(2, offset.card),
    /** Candidate rows and the item detail card, which sit above the rest. */
    cardRaised: offsetShadow(3, offset.card),
    /** The primary action. */
    button: offsetShadow(4, offset.accent),
    /** The gold action, and the want star. */
    buttonGold: offsetShadow(4, offset.gold),
    /** The quiet action beside a primary one. */
    buttonQuiet: offsetShadow(4, offset.card),
    /** The scan FAB, in spice. */
    object: offsetShadow(4, offset.spice),
    /** The shutter, which sits deeper than anything else. */
    shutter: offsetShadow(5, offset.gold),
  } as const;
}

export const Elevation = {
  light: elevationFor('light'),
  dark: elevationFor('dark'),
} as const;

export type ElevationSet = ReturnType<typeof elevationFor>;

/**
 * Buttons press *down* into their offset rather than scaling: the offset is the
 * affordance, so removing it is the press. `pressScale` stays exported at 1 so a
 * caller that spreads it gets a no-op rather than a missing key.
 */
export const Motion = {
  press: 90,
  enter: 160,
  settle: 240,
  /** Screen transitions, which are longer here than anything inside a screen. */
  transition: 380,
  /** The confirmation check. */
  pop: 420,
  easing: [0.22, 1, 0.36, 1] as const,
  enterOffset: 14,
  pressScale: 1,
  pressTranslate: 3,
} as const;

/**
 * The launch ground. It hands off from the native splash screen, so these two values
 * must equal `expo-splash-screen`'s `backgroundColor` and its `dark.backgroundColor`
 * in app.json exactly, or the app opens with a visible flash of the wrong color. Light
 * is the avocado band, dark is the drawer.
 */
export const SplashGround = { light: '#6E7A22', dark: '#231D14' } as const;

/** Apple HIG and Material both land on 44dp as the floor for a tappable target. */
export const HitTarget = 44;

/** The tab bar is 78 tall in the mocks, plus the home indicator on Android. */
export const BottomTabInset = Platform.select({ ios: 78, android: 80 }) ?? 78;
export const MaxContentWidth = 800;
