import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetchItem, fetchPrices, getToken } from '@/api';
import {
  BottomTabInset,
  Colors,
  Elevation,
  HitTarget,
  MaxContentWidth,
  Radius,
  Spacing,
  Type,
} from '@/constants/theme';
import { getCollection, searchCatalog, setOwnership, type CatalogRow } from '@/db';
import { calculateCollectionValues } from '@/features/collection/collection-total';
import {
  AiApproximationBadge,
  PhotoPlaceholder,
  photoSource,
  priceSourceLabel,
  RarityBadge,
} from '@/features/collection/collection-ui';
import type { ItemDetail, OwnershipStatus, PriceQuote, UserItem } from '@shared/types';

const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });

export default function CollectionScreen() {
  const colors = Colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
  const insets = useSafeAreaInsets();
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
            <View style={styles.headingRow}>
              <View>
                <Text style={[styles.eyebrow, { color: colors.accent }]}>YOUR SHELF</Text>
                <Text style={[styles.title, { color: colors.text }]}>Collection</Text>
              </View>
              <Text style={[styles.count, { color: colors.textSecondary }]}>
                {items.length} {items.length === 1 ? 'piece' : 'pieces'}
              </Text>
            </View>

            {items.length > 0 && (
              <ValueSummary
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
            )}

            <View
              style={[styles.segment, { backgroundColor: colors.backgroundElement }]}
              accessibilityRole="tablist">
              {(['have', 'want'] as const).map((status) => {
                const selected = mode === status;
                return (
                  <Pressable
                    key={status}
                    onPress={() => setMode(status)}
                    accessibilityRole="tab"
                    accessibilityLabel={`Show ${status === 'have' ? 'owned pieces' : 'want list'}`}
                    accessibilityState={{ selected }}
                    style={({ pressed }) => [
                      styles.segmentButton,
                      selected && { backgroundColor: colors.surface, ...Elevation.card },
                      pressed && { backgroundColor: colors.backgroundSelected },
                    ]}>
                    <Text style={[
                      styles.segmentText,
                      { color: selected ? colors.text : colors.textSecondary },
                    ]}>
                      {status === 'have' ? 'Have' : 'Want'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {loadError && <Text style={[styles.error, { color: colors.danger }]}>{loadError}</Text>}
          </View>
        )}
        renderItem={({ item }) => (
          <CollectionRow
            item={item}
            catalog={catalog.get(item.itemSlug)}
            detail={details.get(item.itemSlug)}
            colors={colors}
            saving={savingSlug === item.itemSlug}
            photoToken={photoToken}
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

function ValueSummary({
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
  colors: (typeof Colors)['light'] | (typeof Colors)['dark'];
  values: ReturnType<typeof calculateCollectionValues>;
  haveTotal: number;
  wantTotal: number;
  haveHasPrice: boolean;
  wantHasPrice: boolean;
  unpricedCount: number;
  pricesLoaded: boolean;
  priceError: string | null;
}) {
  return (
    <View style={[styles.valuePanel, { backgroundColor: colors.surface, ...Elevation.card }]}>
      <View style={styles.valueColumns}>
        <ValueColumn
          label="Estimated shelf value"
          total={haveHasPrice ? haveTotal : null}
          colors={colors}
        />
        <View style={[styles.valueDivider, { backgroundColor: colors.border }]} />
        <ValueColumn
          label="Want-list estimate · one each"
          total={wantHasPrice ? wantTotal : null}
          colors={colors}
        />
      </View>

      {pricesLoaded && values.map((value) => (
        <Text key={value.source} style={[styles.source, { color: colors.textSecondary }]}>
          {[
            value.haveTotal > 0 ? `${money.format(value.haveTotal)} owned` : null,
            value.wantTotal > 0 ? `${money.format(value.wantTotal)} wanted` : null,
          ].filter(Boolean).join(' · ')} — {priceSourceLabel(value.source)}
        </Text>
      ))}
      {pricesLoaded && values.length === 0 && (
        <Text style={[styles.source, { color: colors.textSecondary }]}>No comparable prices found.</Text>
      )}
      {pricesLoaded && unpricedCount > 0 && (
        <Text style={[styles.exclusion, { color: colors.textSecondary }]}>
          {unpricedCount} {unpricedCount === 1 ? 'piece has' : 'pieces have'} no comps and {unpricedCount === 1 ? 'is' : 'are'} excluded from these totals.
        </Text>
      )}
      {!pricesLoaded && (
        <Text style={[styles.source, { color: colors.textSecondary }]}>
          {priceError ? `Prices unavailable: ${priceError}` : 'Loading comparable prices…'}
        </Text>
      )}
    </View>
  );
}

function ValueColumn({
  label,
  total,
  colors,
}: {
  label: string;
  total: number | null;
  colors: (typeof Colors)['light'] | (typeof Colors)['dark'];
}) {
  return (
    <View style={styles.valueColumn}>
      <Text style={[styles.valueLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.value, { color: colors.text }]}>{total === null ? '—' : money.format(total)}</Text>
    </View>
  );
}

function CollectionRow({
  item,
  catalog,
  detail,
  colors,
  saving,
  photoToken,
  onChangeQuantity,
}: {
  item: UserItem;
  catalog: CatalogRow | undefined;
  detail: ItemDetail | undefined;
  colors: (typeof Colors)['light'] | (typeof Colors)['dark'];
  saving: boolean;
  photoToken: string | null;
  onChangeQuantity: (item: UserItem, delta: number) => Promise<void>;
}) {
  const photo = detail?.photos[0];
  const patternName = detail?.pattern.name ?? catalog?.patternName ?? item.itemSlug;
  const form = detail?.form.shape ?? catalog?.shape ?? 'Catalog details unavailable';
  const rarity = detail?.rarity ?? catalog?.rarity;

  return (
    <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Pressable
        onPress={() => router.push({ pathname: '/item/[slug]', params: { slug: item.itemSlug } })}
        accessibilityRole="button"
        accessibilityLabel={`View ${patternName}, ${form}`}
        style={({ pressed }) => [styles.rowMain, pressed && { backgroundColor: colors.backgroundElement }]}>
        <View style={[styles.thumbnail, { backgroundColor: colors.backgroundElement }]}>
          {photo ? (
            <>
              <Image source={photoSource(photo, photoToken)} contentFit="cover" style={styles.image} />
              {photo.isAiPlaceholder && <AiApproximationBadge />}
            </>
          ) : <PhotoPlaceholder />}
        </View>
        <View style={styles.rowCopy}>
          <Text numberOfLines={2} style={[styles.rowTitle, { color: colors.text }]}>{patternName}</Text>
          <Text numberOfLines={2} style={[styles.rowSubtitle, { color: colors.textSecondary }]}>{form}</Text>
          {rarity && <RarityBadge rarity={rarity} />}
        </View>
      </Pressable>

      {item.status === 'have' ? (
        <View style={styles.quantityBlock}>
          <Text style={[styles.quantityLabel, { color: colors.textSecondary }]}>Quantity</Text>
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
              <Text style={[styles.stepperSymbol, { color: item.quantity <= 1 ? colors.textTertiary : colors.text }]}>−</Text>
            </Pressable>
            <Text accessibilityLabel={`${item.quantity} owned`} style={[styles.quantity, { color: colors.text }]}>
              {item.quantity}
            </Text>
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
        </View>
      ) : (
        <Text style={[styles.wantedLabel, { color: colors.want }]}>WANTED</Text>
      )}
    </View>
  );
}

function EmptyCollection({
  mode,
  hasOtherItems,
  colors,
}: {
  mode: OwnershipStatus;
  hasOtherItems: boolean;
  colors: (typeof Colors)['light'] | (typeof Colors)['dark'];
}) {
  const completelyEmpty = !hasOtherItems;
  return (
    <View style={styles.empty}>
      <Text style={[styles.emptyTitle, { color: colors.text }]}>
        {completelyEmpty ? 'Your shelf is empty' : `Nothing marked ${mode} yet`}
      </Text>
      <Text style={[styles.emptyCopy, { color: colors.textSecondary }]}>
        {completelyEmpty
          ? 'Scan a piece to identify it, check comparable prices, and start your collection.'
          : mode === 'have'
            ? 'Pieces move here when you mark them as owned.'
            : 'Save pieces you are hunting so they stay separate from what you own.'}
      </Text>
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
  header: { gap: Spacing.three, marginBottom: Spacing.three },
  headingRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  eyebrow: { ...Type.micro, letterSpacing: Spacing.half },
  title: { ...Type.display },
  count: { ...Type.callout, paddingBottom: Spacing.one },
  valuePanel: { borderRadius: Radius.lg, padding: Spacing.three, gap: Spacing.two },
  valueColumns: { flexDirection: 'row', alignItems: 'stretch' },
  valueColumn: { flex: 1, gap: Spacing.one },
  valueDivider: { width: Spacing.half, marginHorizontal: Spacing.three },
  valueLabel: { ...Type.caption },
  value: { ...Type.headline },
  source: { ...Type.caption },
  exclusion: { ...Type.caption },
  segment: { flexDirection: 'row', borderRadius: Radius.md, padding: Spacing.one },
  segmentButton: {
    flex: 1,
    minHeight: HitTarget,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentText: { ...Type.bodyStrong },
  error: { ...Type.callout },
  row: {
    minHeight: Spacing.six + Spacing.five,
    borderWidth: Spacing.half,
    borderRadius: Radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  thumbnail: {
    width: Spacing.six + Spacing.three,
    alignSelf: 'stretch',
    overflow: 'hidden',
  },
  image: { width: '100%', height: '100%' },
  rowCopy: { flex: 1, padding: Spacing.three, gap: Spacing.one },
  rowTitle: { ...Type.headline },
  rowSubtitle: { ...Type.caption },
  quantityBlock: { alignItems: 'center', gap: Spacing.one, paddingRight: Spacing.three },
  quantityLabel: { ...Type.micro, textTransform: 'uppercase' },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: Spacing.half, borderRadius: Radius.pill },
  stepperButton: { minWidth: HitTarget, minHeight: HitTarget, alignItems: 'center', justifyContent: 'center' },
  stepperSymbol: { ...Type.headline },
  quantity: { ...Type.bodyStrong, minWidth: Spacing.four, textAlign: 'center' },
  wantedLabel: { ...Type.micro, paddingHorizontal: Spacing.three },
  rowGap: { height: Spacing.two },
  empty: { alignItems: 'center', paddingVertical: Spacing.six, paddingHorizontal: Spacing.four, gap: Spacing.three },
  emptyTitle: { ...Type.title, textAlign: 'center' },
  emptyCopy: { ...Type.body, textAlign: 'center' },
  primaryButton: {
    minHeight: HitTarget,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { ...Type.bodyStrong },
});
