/**
 * The shared primitives every screen composes from.
 *
 * Read the reference lock in `constants/theme.ts` before changing anything here. The
 * short version: cards separate with a solid offset and no blur, buttons press 3px
 * down and lose that offset, and one Rubik family sets everything.
 *
 * Two rules are enforced structurally rather than by discipline. `PriceFigure` welds a
 * number to the claim it makes, so a bare price cannot be rendered. `SpecimenTile`
 * marks its colorway fallback as a swatch, so a generated stand-in cannot pass as a
 * photograph of the dish.
 */

import { Image } from 'expo-image';
import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  View,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { API_URL } from '@/api';
import {
  inkOn,
  neutralSwatch,
  parseColorway,
  SWATCH_SOURCE_LABEL,
  type Scheme,
} from '@/constants/colorways';
import {
  Colors,
  Elevation,
  Fonts,
  HitTarget,
  Motion,
  OnAccent,
  Radius,
  RarityColors,
  Rule,
  Spacing,
  Type,
  type ElevationSet,
} from '@/constants/theme';
import { BRAND } from '@shared/branding';
import type { Photo, PriceQuote, PriceSourceKind, Rarity } from '@shared/types';

const money = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export function useScheme(): Scheme {
  return useColorScheme() === 'dark' ? 'dark' : 'light';
}

export function useColors() {
  return Colors[useScheme()];
}

/**
 * The printed-card offsets for the active scheme. Always read elevation through this,
 * never as `Elevation.card`, the offset colors are palette values and the light ones
 * read as a pale smear on the dark ground.
 */
export function useElevation(): ElevationSet {
  return Elevation[useScheme()];
}

export function photoSource(photo: Photo, token: string | null) {
  const uri = photo.url.startsWith('http')
    ? photo.url
    : `${API_URL.replace(/\/$/, '')}/${photo.url.replace(/^\//, '')}`;
  return {
    uri,
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  };
}

export function priceSourceLabel(source: PriceSourceKind): string {
  return source === 'sold' ? 'sold, last 90 days' : 'currently listed';
}

// ------------------------------------------------------------------ text

type LabelTone = 'secondary' | 'tertiary' | 'accent' | 'spice' | 'want' | 'onAccent';

/** Uppercase metadata label. The spine of every card and section in the file. */
export function Label({
  children,
  tone = 'spice',
  style,
}: {
  children: React.ReactNode;
  tone?: LabelTone;
  style?: StyleProp<TextStyle>;
}) {
  const colors = useColors();
  const color = {
    secondary: colors.textSecondary,
    tertiary: colors.textTertiary,
    accent: colors.accent,
    spice: colors.spice,
    want: colors.want,
    onAccent: OnAccent.label,
  }[tone];

  return <Text style={[styles.label, { color }, style]}>{children}</Text>;
}

// ------------------------------------------------------------------ surfaces

/**
 * An index card. The offset under it is the only thing separating it from the drawer,
 * so a card without one disappears.
 *
 * `attached` squares the top-left corner, which is how a panel joins the file tab
 * sitting above it. `raised` is the deeper offset used by the detail card and by a
 * candidate row, which sit above the ordinary run of cards.
 */
export function Card({
  children,
  style,
  raised = false,
  attached = false,
}: {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  raised?: boolean;
  attached?: boolean;
}) {
  const colors = useColors();
  const elevation = useElevation();

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface },
        raised ? elevation.cardRaised : elevation.card,
        attached && styles.cardAttached,
        style,
      ]}>
      {children}
    </View>
  );
}

/** A 1px rule between rows inside one card. It never separates two cards. */
export function Divider({ inset = 0 }: { inset?: number }) {
  const colors = useColors();
  return <View style={{ height: Rule, backgroundColor: colors.divider, marginLeft: inset }} />;
}

// ------------------------------------------------------------------ actions

export type ButtonTone = 'primary' | 'gold' | 'quiet' | 'translucent';

/**
 * A button presses down into its own offset. There is no scale and no opacity fade:
 * the offset is the affordance, so losing it is what a press looks like.
 *
 * `translucent` is the one tone with no offset, because it only ever appears on a
 * solid accent field where a darker tone of the ground would read as a stain.
 */
export function PressButton({
  children,
  tone = 'primary',
  onPress,
  disabled = false,
  style,
  textStyle,
  accessibilityLabel,
  ...rest
}: {
  children: React.ReactNode;
  tone?: ButtonTone;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
} & Omit<PressableProps, 'style' | 'children' | 'onPress' | 'disabled'>) {
  const colors = useColors();
  const elevation = useElevation();
  const textChildren =
    typeof children === 'string' || typeof children === 'number'
      ? String(children)
      : Array.isArray(children) &&
          children.every((child) => typeof child === 'string' || typeof child === 'number')
        ? children.join('')
        : null;

  const skin = {
    primary: { backgroundColor: colors.accent, color: colors.accentText, lift: elevation.button },
    gold: { backgroundColor: colors.want, color: Colors.light.text, lift: elevation.buttonGold },
    quiet: {
      backgroundColor: colors.backgroundElement,
      color: colors.spice,
      lift: elevation.buttonQuiet,
    },
    translucent: { backgroundColor: OnAccent.fillStrong, color: OnAccent.text, lift: undefined },
  }[tone];

  return (
    <Pressable
      {...rest}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? textChildren ?? undefined}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: skin.backgroundColor },
        !pressed && skin.lift,
        pressed && { transform: [{ translateY: Motion.pressTranslate }] },
        disabled && styles.buttonDisabled,
        style,
      ]}>
      {textChildren !== null ? (
        <Text style={[styles.buttonLabel, { color: skin.color }, textStyle]}>{textChildren}</Text>
      ) : (
        children
      )}
    </Pressable>
  );
}

/** The round back control: a chevron in a tinted disc. */
export function CircleButton({
  children,
  onPress,
  accessibilityLabel,
  onAccent = false,
  size = 34,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  accessibilityLabel: string;
  onAccent?: boolean;
  size?: number;
}) {
  const colors = useColors();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={(HitTarget - size) / 2}
      style={({ pressed }) => [
        styles.circleButton,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: onAccent ? OnAccent.fillStrong : colors.backgroundElement,
        },
        pressed && { transform: [{ translateY: Motion.pressTranslate }] },
      ]}>
      {typeof children === 'string' ? (
        <Text style={[styles.circleGlyph, { color: onAccent ? OnAccent.text : colors.spice }]}>
          {children}
        </Text>
      ) : (
        children
      )}
    </Pressable>
  );
}

// ------------------------------------------------------------------ chrome

/**
 * The avocado band across the top of a filed screen.
 *
 * `wordmark` prints the app name, which comes from `shared/branding` and is never
 * typed out anywhere else. The two dots to its right are the file's tab colors, gold
 * and cream, standing in for the drawer this all lives in.
 */
export function HeaderBar({
  wordmark = false,
  title,
  label,
  onBack,
  right,
}: {
  wordmark?: boolean;
  title?: string;
  label?: string;
  onBack?: () => void;
  right?: React.ReactNode;
}) {
  const colors = useColors();

  return (
    <View style={[styles.headerBar, { backgroundColor: colors.headerBar }]}>
      {onBack && (
        <CircleButton onPress={onBack} accessibilityLabel="Back" onAccent size={32}>
          ‹
        </CircleButton>
      )}
      {wordmark && <Text style={styles.headerWordmark}>{BRAND.name.toLowerCase()}</Text>}
      {title && <Text style={styles.headerWordmark}>{title}</Text>}
      {label && <Text style={styles.headerLabel}>{label}</Text>}
      <View style={styles.headerSpacer} />
      {right}
      {wordmark && !right && (
        <View style={styles.headerDots}>
          <View style={[styles.headerDot, { backgroundColor: colors.want }]} />
          <View style={[styles.headerDot, { backgroundColor: OnAccent.text }]} />
        </View>
      )}
    </View>
  );
}

/**
 * The file tabs above a panel. The panel below the active tab squares its top-left
 * corner (`<Card attached>`) so the two read as one piece of card stock.
 */
export function FileTabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: readonly { key: T; label: string }[];
  active: T;
  onChange: (key: T) => void;
}) {
  const colors = useColors();

  return (
    <View style={styles.fileTabs} accessibilityRole="tablist">
      {tabs.map((tab) => {
        const selected = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            style={[
              styles.fileTab,
              { backgroundColor: selected ? colors.backgroundSelected : colors.backgroundElement },
            ]}>
            <Text
              style={[
                styles.fileTabLabel,
                { color: selected ? Colors.light.text : colors.textTertiary },
              ]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A half-width fact block: a small uppercase label over one figure. */
export function SpecChip({ label, value }: { label: string; value: string }) {
  const colors = useColors();

  return (
    <View style={[styles.specChip, { backgroundColor: colors.backgroundElement }]}>
      <Text style={[styles.specChipLabel, { color: colors.textTertiary }]}>{label}</Text>
      <Text style={[styles.specChipValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

// ------------------------------------------------------------------ claims

/**
 * A price and the claim it makes, welded together.
 *
 * Sold comps and active listings are different assertions and collectors know it, so
 * the source label is not decoration, it is part of the figure. Rendering a number
 * without one is the thing this component exists to make impossible.
 *
 * `block` is the detail screen's treatment: the figure on a tinted panel, which turns
 * dashed with an em dash when there are no comparables.
 */
export function PriceFigure({
  quote,
  size = 'regular',
  block = false,
  emptyNote = 'No comparables in the last 90 days.',
}: {
  quote: Pick<PriceQuote, 'low' | 'high' | 'source' | 'sampleSize'> | null;
  size?: 'regular' | 'large';
  block?: boolean;
  emptyNote?: string;
}) {
  const colors = useColors();
  const large = size === 'large';

  const body = quote ? (
    <>
      <Text style={[large ? styles.priceLarge : styles.price, { color: colors.spice }]}>
        {money.format(quote.low)}–{money.format(quote.high)}
      </Text>
      <Text style={[styles.priceNote, { color: colors.textSecondary }]}>
        {priceSourceLabel(quote.source)} · {quote.sampleSize}{' '}
        {quote.sampleSize === 1 ? 'comp' : 'comps'}
      </Text>
    </>
  ) : (
    <>
      <Text style={[large ? styles.priceLarge : styles.price, { color: colors.textTertiary }]}>
        —
      </Text>
      <Text style={[styles.priceNote, { color: colors.textSecondary }]}>{emptyNote}</Text>
    </>
  );

  if (!block) return <View style={styles.priceBlock}>{body}</View>;

  return (
    <View
      style={[
        styles.pricePanel,
        { backgroundColor: colors.background },
        !quote && { borderWidth: 2, borderStyle: 'dashed', borderColor: colors.border },
      ]}>
      {body}
    </View>
  );
}

/**
 * Rarity as a rank rather than a word: five ticks, filled up to where this piece sits.
 * Loud color is correct here and nowhere else in the chrome.
 */
const RARITY_ORDER: Rarity[] = ['common', 'uncommon', 'hard-to-find', 'rare', 'grail'];

/** "hard-to-find" -> "Hard to find". Sentence case, not title case. */
export function rarityText(rarity: Rarity): string {
  const words = rarity.replaceAll('-', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function RarityBadge({ rarity, compact = false }: { rarity: Rarity; compact?: boolean }) {
  const scheme = useScheme();
  const colors = Colors[scheme];
  const color = RarityColors[scheme][rarity];
  const rank = RARITY_ORDER.indexOf(rarity) + 1;

  return (
    <View
      style={styles.rarityRow}
      accessibilityLabel={`Rarity: ${rarityText(rarity)}, ${rank} of ${RARITY_ORDER.length}`}>
      <View style={styles.rarityTicks}>
        {RARITY_ORDER.map((step, index) => (
          <View
            key={step}
            style={[styles.rarityTick, { backgroundColor: index < rank ? color : colors.border }]}
          />
        ))}
      </View>
      {!compact && <Text style={[styles.rarityLabel, { color }]}>{rarityText(rarity)}</Text>}
    </View>
  );
}

/** The rank as a pill, for the one place it lands on a photograph: the hero. */
export function RarityPill({ rarity }: { rarity: Rarity }) {
  const scheme = useScheme();
  const rank = RARITY_ORDER.indexOf(rarity) + 1;

  return (
    <View
      style={[styles.rarityPill, { backgroundColor: RarityColors[scheme][rarity] }]}
      accessibilityLabel={`Rarity: ${rarityText(rarity)}, ${rank} of ${RARITY_ORDER.length}`}>
      <Text style={[styles.rarityPillText, { color: Colors.light.text }]}>{rarityText(rarity)}</Text>
    </View>
  );
}

export function AiApproximationBadge() {
  return (
    <View style={styles.cornerBadge}>
      <Text style={styles.cornerBadgeText}>AI approximation</Text>
    </View>
  );
}

// ------------------------------------------------------------------ imagery

/**
 * The specimen tile, the one image slot the whole app shares.
 *
 * Photograph if there is one. If there is not, the piece still arrives wearing its
 * documented colors rather than a grey rectangle, with its model number struck across
 * it the way the real mark sits on the underside. The `swatch` corner mark and the
 * accessibility label both say it is a swatch, because a generated stand-in that reads
 * as a photograph of the dish is a claim the catalog cannot support.
 */
export function SpecimenTile({
  photo,
  photoToken,
  colorway,
  modelNo,
  patternName,
  style,
  stampSize = 'regular',
}: {
  photo?: Photo | null;
  photoToken?: string | null;
  colorway?: string | null;
  modelNo?: string | null;
  patternName?: string | null;
  style?: StyleProp<ViewStyle>;
  stampSize?: 'small' | 'regular' | 'large';
}) {
  const scheme = useScheme();
  const colors = Colors[scheme];
  // The stamp is sized from the tile it lands in, so one component serves a 62pt
  // thumbnail and a full-width hero without clipping at either end.
  const [edge, setEdge] = useState(0);

  if (photo) {
    return (
      <View style={[styles.tile, { backgroundColor: colors.backgroundElement }, style]}>
        <Image
          source={photoSource(photo, photoToken ?? null)}
          contentFit="cover"
          transition={Motion.enter}
          style={styles.tileImage}
          accessibilityLabel={patternName ? `Photograph of ${patternName}` : 'Photograph'}
        />
        {photo.isAiPlaceholder && <AiApproximationBadge />}
      </View>
    );
  }

  const swatch = parseColorway(colorway, scheme) ?? neutralSwatch(scheme);
  const stampFraction = stampSize === 'small' ? 0.68 : stampSize === 'large' ? 0.4 : 0.52;

  return (
    <View
      onLayout={(event) => setEdge(event.nativeEvent.layout.width)}
      style={[styles.tile, { backgroundColor: swatch.ground }, style]}
      accessibilityLabel={[
        patternName,
        colorway ? `${colorway},` : null,
        SWATCH_SOURCE_LABEL,
        modelNo ? `model ${modelNo}` : null,
      ]
        .filter(Boolean)
        .join(' ')}>
      {swatch.figure && <View style={[styles.swatchBand, { backgroundColor: swatch.figure }]} />}
      {modelNo && edge > 0 && (
        <ModelStamp modelNo={modelNo} size={edge * stampFraction} ground={swatch.ground} />
      )}
      {/*
        The mark scales, it never disappears. A 66pt row thumbnail cannot carry the
        full-size badge, but suppressing it there would leave the busiest screen in the
        app rendering swatches that read as photographs, which is the one thing the
        swatch rule exists to prevent. Small tiles get a smaller badge, not none.
      */}
      <View style={[styles.swatchNote, stampSize === 'small' && styles.swatchNoteSmall]}>
        <Text style={[styles.cornerBadgeText, stampSize === 'small' && styles.cornerBadgeTextSmall]}>
          swatch
        </Text>
      </View>
    </View>
  );
}

/**
 * The mark on the underside, which is the thing the app is named after and the thing
 * the scan flow actually reads. Debossed rather than printed: a ring the color of the
 * glass, offset just enough to read as pressed into it.
 */
export function ModelStamp({
  modelNo,
  size,
  ground,
}: {
  modelNo: string;
  size: number;
  ground: string;
}) {
  const ink = inkOn(ground);

  return (
    <View style={styles.stampWrap} pointerEvents="none">
      <View
        style={[
          styles.stampRing,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: Math.max(Rule, size * 0.032),
            borderColor: ink.stroke,
          },
        ]}>
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          style={[
            styles.stampText,
            { color: ink.text, fontSize: size * 0.46, lineHeight: size * 0.52, width: size * 0.76 },
          ]}>
          {modelNo}
        </Text>
      </View>
    </View>
  );
}

/**
 * The empty image slot, for callers with no catalog row to draw a swatch from. Ruled
 * diagonally so it reads as a slot waiting for a photograph rather than as a piece
 * that happens to be grey.
 */
export function PhotoPlaceholder({
  label = 'No photo yet',
  style,
}: {
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();

  return (
    <View style={[styles.tile, { backgroundColor: colors.backgroundElement }, style]}>
      <View style={styles.stripeWrap} pointerEvents="none">
        {Array.from({ length: 14 }, (_, index) => (
          <View key={index} style={[styles.stripe, { backgroundColor: colors.border }]} />
        ))}
      </View>
      <Text style={[styles.placeholderLabel, { color: colors.textTertiary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { ...Type.label },

  card: { borderRadius: Radius.md, overflow: 'hidden' },
  cardAttached: { borderTopLeftRadius: 0 },

  button: {
    minHeight: HitTarget,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.gutter,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.45 },
  buttonLabel: { ...Type.bodyStrong, textAlign: 'center' },

  circleButton: { alignItems: 'center', justifyContent: 'center' },
  circleGlyph: { ...Type.bodyStrong, fontSize: 15, lineHeight: 17 },

  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + Spacing.one,
    paddingHorizontal: Spacing.gutter,
    paddingVertical: Spacing.three + Spacing.half,
  },
  headerWordmark: {
    ...Type.display,
    flexShrink: 0,
    paddingRight: Spacing.half,
    fontSize: 20,
    lineHeight: 24,
    color: OnAccent.text,
  },
  headerLabel: { ...Type.label, fontSize: 12, letterSpacing: 1.6, color: OnAccent.label },
  headerSpacer: { flex: 1 },
  headerDots: { flexDirection: 'row', gap: 5 },
  headerDot: { width: 9, height: 9, borderRadius: Radius.pill },

  fileTabs: { flexDirection: 'row', gap: 6 },
  fileTab: {
    paddingVertical: 9,
    paddingHorizontal: Spacing.three,
    borderTopLeftRadius: Radius.tab,
    borderTopRightRadius: Radius.tab,
  },
  fileTabLabel: { ...Type.bodyStrong, fontSize: 12, lineHeight: 14 },

  specChip: { flex: 1, borderRadius: Radius.sm, padding: 10, gap: Spacing.one },
  specChipLabel: { ...Type.micro },
  specChipValue: { ...Type.display, fontSize: 20, lineHeight: 24, letterSpacing: -0.2 },

  rarityRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  rarityTicks: { flexDirection: 'row', gap: Spacing.half },
  rarityTick: { width: Spacing.three, height: 5, borderRadius: Radius.pill },
  rarityLabel: { ...Type.micro },
  rarityPill: {
    borderRadius: Radius.pill,
    paddingVertical: 5,
    paddingHorizontal: Spacing.three - Spacing.one,
  },
  rarityPillText: { ...Type.bodyStrong, fontSize: 11, lineHeight: 13 },

  priceBlock: { gap: Spacing.one },
  pricePanel: { borderRadius: Radius.md, padding: Spacing.three - 2, gap: Spacing.one },
  price: { ...Type.numeral, fontSize: 17, lineHeight: 21 },
  priceLarge: { ...Type.title },
  priceNote: { ...Type.caption, fontSize: 11, lineHeight: 16 },

  tile: {
    overflow: 'hidden',
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileImage: { width: '100%', height: '100%' },

  /** The fired-on band a Pyrex piece carries, abstracted to a stripe. */
  swatchBand: { position: 'absolute', left: 0, right: 0, top: '50%', bottom: '26%', opacity: 0.92 },

  stampWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  stampRing: { alignItems: 'center', justifyContent: 'center' },
  stampText: { ...Type.display, textAlign: 'center' },

  stripeWrap: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    gap: Spacing.one,
    transform: [{ rotate: '45deg' }, { scale: 1.6 }],
  },
  stripe: { flex: 1 },
  placeholderLabel: { fontFamily: Fonts.mono, fontSize: 9, letterSpacing: 1, textTransform: 'uppercase' },

  // Two complete styles rather than one plus an override: setting `left: undefined` on
  // top of a base does not reliably clear it once the styles are flattened, which
  // stretched the swatch mark across the whole tile.
  cornerBadge: {
    position: 'absolute',
    left: Spacing.two,
    bottom: Spacing.two,
    borderRadius: Radius.xs,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    backgroundColor: 'rgba(42,35,24,0.55)',
  },
  swatchNote: {
    position: 'absolute',
    right: Spacing.two,
    bottom: Spacing.two,
    borderRadius: Radius.xs,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    backgroundColor: 'rgba(42,35,24,0.55)',
  },
  // Overrides only padding and inset, never `left`: the base style does not set it, and
  // the note above records what happens when a flattened override tries to clear one.
  swatchNoteSmall: {
    right: Spacing.one,
    bottom: Spacing.one,
    paddingHorizontal: Spacing.one + 1,
    paddingVertical: 1,
  },
  cornerBadgeText: { ...Type.micro, color: OnAccent.text },
  cornerBadgeTextSmall: { fontSize: 8, lineHeight: 10, letterSpacing: 0.4 },
});
