import { Image } from 'expo-image';
import { useState } from 'react';
import {
  StyleSheet,
  Text,
  useColorScheme,
  View,
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
import { Colors, Elevation, Radius, RarityColors, Rule, Spacing, Type } from '@/constants/theme';
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

/**
 * Uppercase metadata label. The archive reference runs on these — they are what turns
 * a stack of text into an index entry.
 */
export function Label({
  children,
  tone = 'secondary',
  style,
}: {
  children: React.ReactNode;
  tone?: 'secondary' | 'tertiary' | 'accent';
  style?: StyleProp<TextStyle>;
}) {
  const colors = useColors();
  const color =
    tone === 'accent' ? colors.accent : tone === 'tertiary' ? colors.textTertiary : colors.textSecondary;
  return <Text style={[styles.label, { color }, style]}>{children}</Text>;
}

/** A hairline rule. This is what replaced card shadows. */
export function Divider({ inset = 0 }: { inset?: number }) {
  const colors = useColors();
  return <View style={{ height: Rule, backgroundColor: colors.border, marginLeft: inset }} />;
}

/**
 * A price and the claim it makes, welded together.
 *
 * Sold comps and active listings are different assertions and collectors know it, so
 * the source label is not optional decoration — it is part of the figure. Rendering a
 * number without one is the thing this component exists to make impossible.
 */
export function PriceFigure({
  quote,
  size = 'regular',
}: {
  quote: Pick<PriceQuote, 'low' | 'high' | 'source' | 'sampleSize'> | null;
  size?: 'regular' | 'large';
}) {
  const colors = useColors();
  if (!quote) {
    return (
      <View style={styles.priceBlock}>
        <Text style={[size === 'large' ? styles.priceLarge : styles.price, { color: colors.textTertiary }]}>
          —
        </Text>
        <Label tone="tertiary">no comparables yet</Label>
      </View>
    );
  }

  return (
    <View style={styles.priceBlock}>
      <Text style={[size === 'large' ? styles.priceLarge : styles.price, { color: colors.text }]}>
        {money.format(quote.low)}–{money.format(quote.high)}
      </Text>
      <Label tone="secondary">
        {priceSourceLabel(quote.source)} · {quote.sampleSize}{' '}
        {quote.sampleSize === 1 ? 'comp' : 'comps'}
      </Label>
    </View>
  );
}

/**
 * Rarity as a rank rather than a pill: five steps, the filled ones showing where this
 * piece sits. Loud color is correct here and nowhere else in the chrome.
 */
const RARITY_ORDER: Rarity[] = ['common', 'uncommon', 'hard-to-find', 'rare', 'grail'];

export function RarityBadge({ rarity, compact = false }: { rarity: Rarity; compact?: boolean }) {
  const scheme = useScheme();
  const colors = Colors[scheme];
  const color = RarityColors[scheme][rarity];
  const rank = RARITY_ORDER.indexOf(rarity) + 1;

  return (
    <View
      style={styles.rarityRow}
      accessibilityLabel={`Rarity: ${rarity.replaceAll('-', ' ')}, ${rank} of ${RARITY_ORDER.length}`}>
      <View style={styles.rarityTicks}>
        {RARITY_ORDER.map((step, index) => (
          <View
            key={step}
            style={[
              styles.rarityTick,
              { backgroundColor: index < rank ? color : colors.border },
            ]}
          />
        ))}
      </View>
      {!compact && (
        <Text style={[styles.rarityText, { color }]}>{rarity.replaceAll('-', ' ')}</Text>
      )}
    </View>
  );
}

export function AiApproximationBadge() {
  const colors = useColors();

  return (
    <View style={[styles.cornerBadge, { backgroundColor: colors.scrim }]}>
      <Text style={[styles.cornerBadgeText, { color: Colors.light.accentText }]}>AI approximation</Text>
    </View>
  );
}

/**
 * The specimen tile — the one image slot the whole app shares.
 *
 * Photograph if there is one. If there is not, the piece still arrives wearing its
 * documented colors rather than a grey rectangle, with its model number struck across
 * it the way the real mark sits on the underside. The `SWATCH` corner mark and the
 * accessibility label both say it is a swatch, because a generated stand-in that reads
 * as a photo of the dish is a claim the catalog cannot support.
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
  // The stamp is sized from the tile it lands in, so one component serves a 64pt
  // thumbnail and a full-width hero without clipping at either end.
  const [edge, setEdge] = useState(0);

  if (photo) {
    return (
      <View style={[styles.tile, { backgroundColor: colors.backgroundElement }, style]}>
        <Image
          source={photoSource(photo, photoToken ?? null)}
          contentFit="cover"
          transition={160}
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
      {swatch.figure && (
        <View style={[styles.swatchBand, { backgroundColor: swatch.figure }]} />
      )}
      {modelNo && edge > 0 && (
        <ModelStamp modelNo={modelNo} size={edge * stampFraction} ground={swatch.ground} />
      )}
      {stampSize !== 'small' && (
        <View style={styles.swatchNote}>
          <Text style={[styles.cornerBadgeText, { color: Colors.light.accentText }]}>swatch</Text>
        </View>
      )}
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
            {
              color: ink.text,
              fontSize: size * 0.46,
              lineHeight: size * 0.52,
              width: size * 0.76,
            },
          ]}>
          {modelNo}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { ...Type.label },

  rarityRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  rarityTicks: { flexDirection: 'row', gap: Spacing.half },
  rarityTick: { width: Spacing.two, height: Spacing.half + 1, borderRadius: Radius.xs },
  rarityText: { ...Type.label },

  priceBlock: { gap: Spacing.half },
  price: { ...Type.numeral },
  priceLarge: { ...Type.numeralLarge },

  tile: {
    overflow: 'hidden',
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileImage: { width: '100%', height: '100%' },

  /** The fired-on band a Pyrex piece carries, abstracted to a stripe. */
  swatchBand: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '58%',
    bottom: '18%',
    opacity: 0.92,
  },

  stampWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  stampRing: {
    borderColor: 'rgba(20,18,15,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stampText: {
    ...Type.display,
    textAlign: 'center',
    color: 'rgba(20,18,15,0.26)',
  },

  // Two complete styles rather than one plus an override: setting `left: undefined`
  // on top of a base does not reliably clear it once the styles are flattened, which
  // stretched the swatch mark across the whole tile.
  cornerBadge: {
    position: 'absolute',
    left: Spacing.two,
    bottom: Spacing.two,
    borderRadius: Radius.xs,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  swatchNote: {
    position: 'absolute',
    right: Spacing.two,
    bottom: Spacing.two,
    borderRadius: Radius.xs,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    backgroundColor: 'rgba(20,18,15,0.42)',
  },
  cornerBadgeText: { ...Type.label, fontSize: 11, letterSpacing: 1 },
});

/** Kept for callers that only need an empty slot with no catalog data to draw from. */
export function PhotoPlaceholder({ label = 'No photo yet' }: { label?: string }) {
  const colors = useColors();

  return (
    <View style={[styles.tile, { flex: 1, backgroundColor: colors.backgroundElement }]}>
      <Text style={[Type.label, { color: colors.textTertiary }]}>{label}</Text>
    </View>
  );
}

export { Elevation };
