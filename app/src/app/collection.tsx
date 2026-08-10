/**
 * The collection, drawn as a specimen index.
 *
 * The reference is a typographic archive on vellum: a plate on top, its metadata
 * stacked directly underneath, hairline rules doing the separating, and no color in
 * the chrome. A shelf of Pyrex is exactly that — 379 pattern x form combinations, each
 * one an entry — so the grid is the honest shape for it, and the old list of tall
 * rounded cards was not.
 *
 * Ceremony budget for this screen: one solid accent fill, and it belongs to the empty
 * state's primary action. Everything else that needs emphasis gets a rule, a tint, or
 * the condensed face.
 */

import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { Easing, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetchItem, fetchPrices, getToken } from '@/api';
import {
  BottomTabInset,
  Elevation,
  HitTarget,
  MaxContentWidth,
  Motion,
  Radius,
  Rule,
  Spacing,
  Type,
} from '@/constants/theme';
import { getCollection, searchCatalog, setOwnership, type CatalogRow } from '@/db';
import { calculateCollectionValues } from '@/features/collection/collection-total';
import {
  Divider,
  Label,
  priceSourceLabel,
  RarityBadge,
  SpecimenTile,
  useColors,
} from '@/features/collection/collection-ui';
import type { ItemDetail, OwnershipStatus, PriceQuote, UserItem } from '@shared/types';

// CONTRACT: `Label` in collection-ui types its `style` prop as StyleProp<ViewStyle> but
// spreads it onto a <Text> (that mismatch is the standing tsc error on that file), and
// its `tone` union has no entry for `colors.want`. Until both are fixed this file uses
// `Type.label` on a plain <Text> wherever it needs a text color outside Label's tones.

const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });

/**
 * Four slots is the first two grid rows; past that every tile lands together. The step
 * is derived so the last tile finishes at `enter + 3 steps` = 220ms, inside `settle`.
 */
const STAGGER_SLOTS = 4;
const STAGGER_STEP = (Motion.settle - Motion.enter) / STAGGER_SLOTS;

type Palette = ReturnType<typeof useColors>;

export default function CollectionScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const [mode, setMode] = useState<OwnershipStatus>('have');
  const [items, setItems] = useState<UserItem[]>([]);
  const [catalog, setCatalog] = useState<Map<string, CatalogRow>>(new Map());
  const [details, setDetails] = useState<Map<string, ItemDetail>>(new Map());
  const [quotes, setQuotes] = useState<PriceQuote[]>([]);
  const [pricesLoaded, setPricesLoaded] = useState(false);
  const [photoToken, setPhotoToken] = useState<string | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingSlug, setSavingSlug] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setLoadError(null);

    try {
      const [localItems, catalogRows, token] = await Promise.all([
        getCollection(),
        searchCatalog('', Number.MAX_SAFE_INTEGER),
        getToken(),
      ]);
      setItems(localItems);
      setCatalog(new Map(catalogRows.map((row) => [row.slug, row])));
      setPhotoToken(token);
      setLoading(false);
      setQuotes([]);
      setPricesLoaded(false);
      setPriceError(null);

      if (localItems.length === 0) {
        setQuotes([]);
        setDetails(new Map());
        setPricesLoaded(true);
        return;
      }

      const slugs = localItems.map((item) => item.itemSlug);
      const [priceResult, itemResults] = await Promise.all([
        // CONTRACT: /price/batch must accept collection-scale slug counts; totals
        // intentionally use one batch call instead of one request per row.
        fetchPrices(slugs),
        Promise.all(slugs.map((slug) => fetchItem(slug))),
      ]);

      if (priceResult.ok) {
        setQuotes(priceResult.data);
        setPricesLoaded(true);
        setPriceError(null);
      } else {
        setPriceError(priceResult.error);
      }

      setDetails(new Map(itemResults.flatMap((result) =>
        result.ok ? [[result.data.slug, result.data] as const] : [],
      )));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not read your collection.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const values = useMemo(() => calculateCollectionValues(items, quotes), [items, quotes]);
  const haveTotal = values.reduce((total, value) => total + value.haveTotal, 0);
  const wantTotal = values.reduce((total, value) => total + value.wantTotal, 0);
  const quotedSlugs = useMemo(() => new Set(quotes.map((quote) => quote.itemSlug)), [quotes]);
  const unpricedCount = pricesLoaded
    ? items.filter((item) => !quotedSlugs.has(item.itemSlug)).length
    : 0;
  const haveHasPrice = pricesLoaded && items.some(
    (item) => item.status === 'have' && quotedSlugs.has(item.itemSlug),
  );
  const wantHasPrice = pricesLoaded && items.some(
    (item) => item.status === 'want' && quotedSlugs.has(item.itemSlug),
  );
  const visibleItems = items.filter((item) => item.status === mode);
  const counts = {
    have: items.filter((item) => item.status === 'have').length,
    want: items.filter((item) => item.status === 'want').length,
  };

  async function changeQuantity(item: UserItem, delta: number) {
    const quantity = Math.max(1, item.quantity + delta);
    if (quantity === item.quantity) return;
    setSavingSlug(item.itemSlug);
    try {
      await setOwnership(item.itemSlug, 'have', quantity, item.condition, item.notes);
      setItems((current) => current.map((entry) =>
        entry.itemSlug === item.itemSlug ? { ...entry, quantity } : entry,
      ));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not update quantity.');
    } finally {
      setSavingSlug(null);
    }
  }

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator
          color={colors.accent}
          accessibilityLabel="Loading collection"
          accessibilityRole="progressbar"
        />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <FlatList
        data={visibleItems}
        keyExtractor={(item) => item.itemSlug}
        numColumns={2}
        columnWrapperStyle={styles.column}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load(true)}
            tintColor={colors.accent}
            accessibilityLabel="Refresh collection"
          />
        )}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + Spacing.three,
            paddingBottom: insets.bottom + BottomTabInset + Spacing.four,
          },
        ]}
        ListHeaderComponent={(
          <View style={styles.header}>
            <View style={styles.masthead}>
              <View style={styles.mastheadCopy}>
                <Label tone="accent">Your shelf</Label>
                <Text style={[styles.title, { color: colors.text }]}>Collection</Text>
              </View>
              <View style={styles.mastheadCount}>
                <Text style={[styles.countValue, { color: colors.text }]}>{items.length}</Text>
                <Label tone="tertiary">{items.length === 1 ? 'piece' : 'pieces'}</Label>
              </View>
            </View>

            <Divider />

            {items.length > 0 && (
              <>
                <ValueLedger
                  colors={colors}
                  values={values}
                  haveTotal={haveTotal}
                  wantTotal={wantTotal}
                  haveHasPrice={haveHasPrice}
                  wantHasPrice={wantHasPrice}
                  unpricedCount={unpricedCount}
                  pricesLoaded={pricesLoaded}
                  priceError={priceError}
                />
                <Divider />
              </>
            )}

            <View
              style={[styles.segment, { borderColor: colors.border }]}
              accessibilityRole="tablist">
              {(['have', 'want'] as const).map((status, position) => {
                const selected = mode === status;
                return (
                  <View key={status} style={styles.segmentSlot}>
                    {position > 0 && (
                      <View style={[styles.segmentRule, { backgroundColor: colors.border }]} />
                    )}
                    <Pressable
                      onPress={() => setMode(status)}
                      accessibilityRole="tab"
                      accessibilityLabel={`Show ${status === 'have' ? 'owned pieces' : 'want list'}`}
                      accessibilityState={{ selected }}
                      style={({ pressed }) => [
                        styles.segmentButton,
                        selected && { backgroundColor: colors.backgroundSelected },
                        pressed && { backgroundColor: colors.backgroundElement },
                      ]}>
                      <Text style={[
                        styles.segmentText,
                        { color: selected ? colors.text : colors.textSecondary },
                      ]}>
                        {status === 'have' ? 'Have' : 'Want'}
                      </Text>
                      <Text style={[
                        styles.segmentCount,
                        { color: selected ? colors.textSecondary : colors.textTertiary },
                      ]}>
                        {counts[status]}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>

            {loadError && <Text style={[styles.error, { color: colors.danger }]}>{loadError}</Text>}
          </View>
        )}
        renderItem={({ item, index }) => (
          <SpecimenCell
            item={item}
            index={index}
            catalog={catalog.get(item.itemSlug)}
            detail={details.get(item.itemSlug)}
            colors={colors}
            saving={savingSlug === item.itemSlug}
            photoToken={photoToken}
            reducedMotion={reducedMotion}
            onChangeQuantity={changeQuantity}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.rowGap} />}
        ListEmptyComponent={(
          <EmptyCollection mode={mode} hasOtherItems={items.length > 0} colors={colors} />
        )}
      />
    </View>
  );
}

/**
 * The ledger. Two figures, their captions above and the claim behind them below — the
 * archive's stacked-metadata discipline applied to money.
 *
 * Honesty rules carried over unchanged: pieces with no comps never enter a total and
 * the exclusion is stated; a failed price batch fails the whole total rather than
 * quietly under-reporting it; and no figure is rendered without its source.
 */
function ValueLedger({
  colors,
  values,
  haveTotal,
  wantTotal,
  haveHasPrice,
  wantHasPrice,
  unpricedCount,
  pricesLoaded,
  priceError,
}: {
  colors: Palette;
  values: ReturnType<typeof calculateCollectionValues>;
  haveTotal: number;
  wantTotal: number;
  haveHasPrice: boolean;
  wantHasPrice: boolean;
  unpricedCount: number;
  pricesLoaded: boolean;
  priceError: string | null;
}) {
  // A total can draw on both price sources at once, so the label names every source
  // that fed it rather than picking one and implying the rest.
  const loadedSource = values.length > 0
    ? values.map((value) => priceSourceLabel(value.source)).join(' + ')
    : 'no comparables yet';
  const pendingSource = priceError ? 'prices unavailable' : 'awaiting comparables';
  const source = pricesLoaded ? loadedSource : pendingSource;
  const emptySource = pricesLoaded ? 'no comparables yet' : pendingSource;

  return (
    <View style={styles.ledger}>
      <View style={styles.ledgerRow}>
        <LedgerFigure
          caption="Estimated shelf value"
          total={haveHasPrice ? haveTotal : null}
          source={haveHasPrice ? source : emptySource}
          colors={colors}
        />
        <View style={[styles.ledgerRule, { backgroundColor: colors.border }]} />
        <LedgerFigure
          caption="Want list · one each"
          total={wantHasPrice ? wantTotal : null}
          source={wantHasPrice ? source : emptySource}
          colors={colors}
        />
      </View>

      {pricesLoaded && values.map((value) => (
        <Text key={value.source} style={[styles.note, { color: colors.textSecondary }]}>
          {[
            value.haveTotal > 0 ? `${money.format(value.haveTotal)} owned` : null,
            value.wantTotal > 0 ? `${money.format(value.wantTotal)} wanted` : null,
          ].filter(Boolean).join(' · ')} — {priceSourceLabel(value.source)}
        </Text>
      ))}
      {pricesLoaded && values.length === 0 && (
        <Text style={[styles.note, { color: colors.textSecondary }]}>No comparable prices found.</Text>
      )}
      {pricesLoaded && unpricedCount > 0 && (
        <Text style={[styles.note, { color: colors.textSecondary }]}>
          {unpricedCount} {unpricedCount === 1 ? 'piece has' : 'pieces have'} no comps and {unpricedCount === 1 ? 'is' : 'are'} excluded from these totals.
        </Text>
      )}
      {!pricesLoaded && (
        <Text style={[styles.note, { color: colors.textSecondary }]}>
          {priceError ? `Prices unavailable: ${priceError}` : 'Loading comparable prices…'}
        </Text>
      )}
    </View>
  );
}

/**
 * `PriceFigure` welds a *quoted range* to its one source, which is the right tool
 * everywhere a `PriceQuote` exists. A collection total is neither — it is a sum of
 * medians that can span both sources — so this figure exists instead, with `source` as
 * a required prop so the number still cannot be rendered bare.
 */
function LedgerFigure({
  caption,
  total,
  source,
  colors,
}: {
  caption: string;
  total: number | null;
  source: string;
  colors: Palette;
}) {
  return (
    <View style={styles.ledgerCell}>
      <Label tone="secondary">{caption}</Label>
      <Text style={[
        styles.ledgerValue,
        { color: total === null ? colors.textTertiary : colors.text },
      ]}>
        {total === null ? '—' : money.format(total)}
      </Text>
      <Label tone="tertiary">{source}</Label>
    </View>
  );
}

/**
 * One index entry: the plate, then its metadata directly beneath in a fixed order —
 * pattern in the condensed face, form in the reading face, model number and rank on the
 * spine line. The plate is the only thing on the screen that casts a shadow, because it
 * is the only thing standing in for a physical object.
 */
function SpecimenCell({
  item,
  index,
  catalog,
  detail,
  colors,
  saving,
  photoToken,
  reducedMotion,
  onChangeQuantity,
}: {
  item: UserItem;
  index: number;
  catalog: CatalogRow | undefined;
  detail: ItemDetail | undefined;
  colors: Palette;
  saving: boolean;
  photoToken: string | null;
  reducedMotion: boolean;
  onChangeQuantity: (item: UserItem, delta: number) => Promise<void>;
}) {
  const photo = detail?.photos[0];
  const patternName = detail?.pattern.name ?? catalog?.patternName ?? item.itemSlug;
  const form = detail?.form.shape ?? catalog?.shape ?? 'Catalog details unavailable';
  const rarity = detail?.rarity ?? catalog?.rarity;
  const modelNo = detail?.form.modelNo ?? catalog?.modelNo ?? null;
  const colorway = detail?.pattern.colorway ?? catalog?.colorway ?? null;

  const entering = reducedMotion
    ? undefined
    : FadeInDown
      .duration(Motion.enter)
      .delay(Math.min(index, STAGGER_SLOTS - 1) * STAGGER_STEP)
      .easing(Easing.bezier(...Motion.easing))
      .withInitialValues({ transform: [{ translateY: Motion.enterOffset }] });

  return (
    <Animated.View style={styles.cell} entering={entering}>
      <Pressable
        onPress={() => router.push({ pathname: '/item/[slug]', params: { slug: item.itemSlug } })}
        accessibilityRole="button"
        accessibilityLabel={`View ${patternName}, ${form}`}
        style={({ pressed }) => [styles.cellMain, pressed && styles.cellPressed]}>
        <View
          style={[
            styles.plate,
            { backgroundColor: colors.surface, borderColor: colors.border },
            Elevation.object,
          ]}>
          <SpecimenTile
            photo={photo}
            photoToken={photoToken}
            colorway={colorway}
            modelNo={modelNo}
            patternName={patternName}
            style={styles.plateFill}
          />
        </View>

        <View style={styles.meta}>
          <Text numberOfLines={2} style={[styles.metaPattern, { color: colors.text }]}>
            {patternName}
          </Text>
          <Text numberOfLines={1} style={[styles.metaForm, { color: colors.textSecondary }]}>
            {form}
          </Text>
          <View style={styles.metaSpine}>
            <Text numberOfLines={1} style={[styles.metaModel, { color: colors.textTertiary }]}>
              {modelNo ? `No. ${modelNo}` : 'unlisted'}
            </Text>
            {rarity && <RarityBadge rarity={rarity} compact />}
          </View>
        </View>
      </Pressable>

      {item.status === 'have' ? (
        <View style={[styles.stepper, { borderColor: colors.border }]}>
          <Pressable
            onPress={() => void onChangeQuantity(item, -1)}
            disabled={saving || item.quantity <= 1}
            accessibilityRole="button"
            accessibilityLabel={`Decrease quantity of ${patternName}`}
            accessibilityState={{ disabled: saving || item.quantity <= 1 }}
            style={({ pressed }) => [
              styles.stepperButton,
              pressed && { backgroundColor: colors.backgroundSelected },
            ]}>
            <Text style={[
              styles.stepperSymbol,
              { color: item.quantity <= 1 ? colors.textTertiary : colors.text },
            ]}>
              −
            </Text>
          </Pressable>
          <View style={[styles.stepperRule, { backgroundColor: colors.border }]} />
          <Text
            accessibilityLabel={`${item.quantity} owned`}
            style={[styles.quantity, { color: colors.text }]}>
            {item.quantity}
          </Text>
          <View style={[styles.stepperRule, { backgroundColor: colors.border }]} />
          <Pressable
            onPress={() => void onChangeQuantity(item, 1)}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel={`Increase quantity of ${patternName}`}
            accessibilityState={{ disabled: saving }}
            style={({ pressed }) => [
              styles.stepperButton,
              pressed && { backgroundColor: colors.backgroundSelected },
            ]}>
            <Text style={[styles.stepperSymbol, { color: colors.text }]}>+</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={[styles.wantMark, { color: colors.want, borderColor: colors.want }]}>
          Wanted
        </Text>
      )}
    </Animated.View>
  );
}

/**
 * An index with nothing filed in it yet. There are no illustration assets, so the empty
 * state is drawn the way the archive would print an unfilled page: three ruled plates,
 * numbered, waiting. The one solid accent fill on this screen is the action below them.
 */
function EmptyCollection({
  mode,
  hasOtherItems,
  colors,
}: {
  mode: OwnershipStatus;
  hasOtherItems: boolean;
  colors: Palette;
}) {
  const completelyEmpty = !hasOtherItems;

  return (
    <View style={styles.empty}>
      <View
        style={styles.emptyPlates}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        {['001', '002', '003'].map((plate) => (
          <View key={plate} style={[styles.emptyPlate, { borderColor: colors.border }]}>
            <Text style={[styles.emptyPlateNo, { color: colors.textTertiary }]}>{plate}</Text>
          </View>
        ))}
      </View>

      <Divider />

      <View style={styles.emptyCopy}>
        <Label tone="accent">
          {completelyEmpty ? 'Empty index' : mode === 'have' ? 'Nothing owned' : 'Nothing wanted'}
        </Label>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>
          {completelyEmpty ? 'Your shelf is empty' : `Nothing marked ${mode} yet`}
        </Text>
        <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
          {completelyEmpty
            ? 'Scan a piece to identify it, check comparable prices, and start your collection.'
            : mode === 'have'
              ? 'Pieces move here when you mark them as owned.'
              : 'Save pieces you are hunting so they stay separate from what you own.'}
        </Text>
      </View>

      <Pressable
        onPress={() => router.push('/')}
        accessibilityRole="button"
        accessibilityLabel="Go to Scan"
        style={({ pressed }) => [
          styles.primaryButton,
          { backgroundColor: pressed ? colors.have : colors.accent },
        ]}>
        <Text style={[styles.primaryButtonText, { color: colors.accentText }]}>Scan a piece</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
  },

  // --- masthead + ledger ---
  header: { gap: Spacing.three, marginBottom: Spacing.four },
  masthead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  mastheadCopy: { gap: Spacing.one },
  mastheadCount: { alignItems: 'flex-end' },
  title: { ...Type.display },
  countValue: { ...Type.numeralLarge },

  ledger: { gap: Spacing.two },
  ledgerRow: { flexDirection: 'row', alignItems: 'stretch' },
  ledgerCell: { flex: 1, gap: Spacing.one },
  ledgerRule: { width: Rule, marginHorizontal: Spacing.three },
  ledgerValue: { ...Type.numeralLarge },
  note: { ...Type.caption },

  // --- have / want ---
  segment: {
    flexDirection: 'row',
    borderWidth: Rule,
    borderRadius: Radius.sm,
    overflow: 'hidden',
  },
  segmentSlot: { flex: 1, flexDirection: 'row' },
  segmentRule: { width: Rule, alignSelf: 'stretch' },
  segmentButton: {
    flex: 1,
    minHeight: HitTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  segmentText: { ...Type.label },
  segmentCount: { ...Type.numeral },
  error: { ...Type.callout },

  // --- the grid ---
  column: { gap: Spacing.two },
  rowGap: { height: Spacing.four },
  /** `maxWidth` keeps a lone final tile at column width instead of stretching the row. */
  cell: { flex: 1, maxWidth: '50%', gap: Spacing.two },
  cellMain: { gap: Spacing.two },
  /** Scale only. Dimming a parent of a shadow-caster flattens the plate's shadow on iOS. */
  cellPressed: { transform: [{ scale: Motion.pressScale }] },

  plate: { aspectRatio: 1, borderWidth: Rule, borderRadius: Radius.sm },
  plateFill: { flex: 1, alignSelf: 'stretch' },

  meta: { gap: Spacing.half },
  /** Fixed to two lines so metadata sits on one baseline across a row, as an index does. */
  metaPattern: { ...Type.headline, minHeight: Type.headline.lineHeight * 2 },
  metaForm: { ...Type.caption },
  metaSpine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    marginTop: Spacing.half,
  },
  metaModel: { ...Type.label, flexShrink: 1 },

  stepper: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderWidth: Rule,
    borderRadius: Radius.sm,
    overflow: 'hidden',
  },
  stepperRule: { width: Rule },
  stepperButton: { flex: 1, minHeight: HitTarget, alignItems: 'center', justifyContent: 'center' },
  stepperSymbol: { ...Type.headline },
  quantity: {
    ...Type.numeral,
    minWidth: Spacing.five,
    textAlign: 'center',
    alignSelf: 'center',
    paddingHorizontal: Spacing.one,
  },
  wantMark: {
    ...Type.label,
    alignSelf: 'flex-start',
    borderWidth: Rule,
    borderRadius: Radius.xs,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },

  // --- empty index ---
  empty: { gap: Spacing.four, paddingTop: Spacing.two, paddingBottom: Spacing.six },
  emptyPlates: { flexDirection: 'row', gap: Spacing.two },
  emptyPlate: {
    flex: 1,
    aspectRatio: 1,
    borderWidth: Rule,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyPlateNo: { ...Type.numeral },
  emptyCopy: { gap: Spacing.two },
  emptyTitle: { ...Type.title },
  emptyBody: { ...Type.body },
  primaryButton: {
    alignSelf: 'flex-start',
    minHeight: HitTarget,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { ...Type.bodyStrong },
});
