/**
 * The collection, drawn as a card file.
 *
 * The reference is a 1970s index drawer: an avocado band across the top, a masthead
 * that says what is in the drawer and what it is worth, three file tabs, and a run of
 * index cards under whichever tab is out. A row is one card. Separation is the printed
 * offset under it, never a rule and never a blur.
 *
 * Three tabs, one row component. Have and Want read the local collection; All reads the
 * cached catalog, so most All rows have no price because none was ever requested for
 * them, that is a different state from "we looked and found nothing", and the row says
 * so. The same three-way split covers prices still loading and a failed price batch.
 */

import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
  Fonts,
  HitTarget,
  MaxContentWidth,
  Motion,
  OnAccent,
  Radius,
  Spacing,
  Type,
} from '@/constants/theme';
import {
  getCollection,
  getSettings,
  removeFromCollection,
  searchCatalog,
  setOwnership,
  type CatalogRow,
} from '@/db';
import {
  calculateCollectionValues,
  countOwnedPieces,
} from '@/features/collection/collection-total';
import {
  Card,
  CircleButton,
  FileTabs,
  HeaderBar,
  Label,
  PressButton,
  PriceFigure,
  priceSourceLabel,
  SpecimenTile,
  useColors,
  useElevation,
} from '@/features/collection/collection-ui';
import type { ItemDetail, PriceQuote, UserItem } from '@shared/types';

// CONTRACT: `fetchPrices(slugs)` takes no price-source argument, so the `showSoldComps`
// setting cannot be honoured from this screen, the source is whatever the batch
// returns. Honouring it needs `/price/batch` to accept a preferred source and
// `fetchPrices` to pass it through. This screen already labels whatever it gets.

// CONTRACT: `user_items` stores `updated_at` only. See NEW_WINDOW_MS below, without a
// `created_at` column, "newly filed" cannot be told apart from "recently edited".

// CONTRACT: `PriceFigure` has one size for a row (`Type.numeral` over a caption note).
// The mock's row price is a single 12px line, so rows here run two lines taller than the
// mock. A compact variant on `PriceFigure` would close it; overriding the type locally
// would mean rendering a price without its source, which is the one thing it prevents.

const money = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/**
 * Four slots is the first screenful of rows; past that every row lands together. The
 * step is derived so the last one finishes at `enter + 3 steps` = 220ms, inside `settle`.
 */
const STAGGER_SLOTS = 4;
const STAGGER_STEP = (Motion.settle - Motion.enter) / STAGGER_SLOTS;

/**
 * ponytail: a row counts as newly filed if it was written in the last ten minutes —
 * long enough to still be there when the user walks back from the scan that filed it,
 * short enough that it is gone next session. Ceiling: `setOwnership` bumps `updated_at`
 * on a quantity change too, so a piece whose count you just raised re-tags itself as NEW
 * on the next refetch. Fixing that needs a `created_at` column, not a longer comment.
 */
const NEW_WINDOW_MS = 10 * 60 * 1000;

const TILE = 66;
const FAB_SIZE = 64;
/** The mock puts the FAB 96 above the bottom against a 78 tab bar. */
const FAB_GAP = Spacing.three + Spacing.half;

type Palette = ReturnType<typeof useColors>;
type FileTab = 'have' | 'want' | 'all';

/** Whether a price was asked for at all, and how that went. Rows must not conflate them. */
type PriceState = 'ready' | 'pending' | 'error' | 'unasked';

type Row = { slug: string; entry: UserItem | undefined };

export default function CollectionScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const [tab, setTab] = useState<FileTab>('have');
  const [items, setItems] = useState<UserItem[]>([]);
  const [catalog, setCatalog] = useState<Map<string, CatalogRow>>(new Map());
  const [details, setDetails] = useState<Map<string, ItemDetail>>(new Map());
  const [quotes, setQuotes] = useState<PriceQuote[]>([]);
  const [pricesLoaded, setPricesLoaded] = useState(false);
  const [hideValues, setHideValues] = useState(false);
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
      const [localItems, catalogRows, token, settings] = await Promise.all([
        getCollection(),
        searchCatalog('', Number.MAX_SAFE_INTEGER),
        getToken(),
        getSettings(),
      ]);
      setItems(localItems);
      setCatalog(new Map(catalogRows.map((row) => [row.slug, row])));
      setPhotoToken(token);
      setHideValues(settings.hideValuesOnShelf);
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
  const quoteBySlug = useMemo(
    () => new Map(quotes.map((quote) => [quote.itemSlug, quote])),
    [quotes],
  );
  const unpricedCount = pricesLoaded
    ? items.filter((item) => !quoteBySlug.has(item.itemSlug)).length
    : 0;
  const haveHasPrice = pricesLoaded && items.some(
    (item) => item.status === 'have' && quoteBySlug.has(item.itemSlug),
  );
  const wantHasPrice = pricesLoaded && items.some(
    (item) => item.status === 'want' && quoteBySlug.has(item.itemSlug),
  );

  const counts = {
    have: countOwnedPieces(items),
    want: items.filter((item) => item.status === 'want').length,
    all: catalog.size,
  };

  const rows: Row[] = useMemo(() => {
    if (tab !== 'all') {
      return items
        .filter((item) => item.status === tab)
        .map((item) => ({ slug: item.itemSlug, entry: item }));
    }
    const byslug = new Map(items.map((item) => [item.itemSlug, item]));
    // The Map keeps the catalog's own order, which is pattern name then model number.
    return [...catalog.keys()].map((slug) => ({ slug, entry: byslug.get(slug) }));
  }, [tab, items, catalog]);

  const priceState: PriceState = pricesLoaded ? 'ready' : priceError ? 'error' : 'pending';
  /** Nothing filed at all, sitting on the tab it opens to: the first-launch screen. */
  const firstLaunch = items.length === 0 && tab === 'have';

  function confirmRemoval(item: UserItem, pieceName: string) {
    if (savingSlug !== null) return;
    Alert.alert(
      'Remove piece',
      `Remove ${pieceName} from your shelf?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => void removeItem(item.itemSlug),
        },
      ],
    );
  }

  async function removeItem(itemSlug: string) {
    if (savingSlug !== null) return;
    setSavingSlug(itemSlug);
    try {
      await removeFromCollection(itemSlug);
      setItems((current) => current.filter((entry) => entry.itemSlug !== itemSlug));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not remove this piece.');
    } finally {
      setSavingSlug(null);
    }
  }

  async function changeQuantity(item: UserItem, delta: number, pieceName: string) {
    if (savingSlug !== null) return;
    if (delta < 0 && item.quantity <= 1) {
      confirmRemoval(item, pieceName);
      return;
    }
    const quantity = Math.max(1, item.quantity + delta);
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
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <View style={{ paddingTop: insets.top, backgroundColor: colors.headerBar }}>
          <HeaderBar wordmark />
        </View>
        <View style={styles.centered}>
          <ActivityIndicator
            color={colors.accent}
            accessibilityLabel="Loading collection"
            accessibilityRole="progressbar"
          />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* HeaderBar has no safe-area of its own, so the band is extended into it here. */}
      <View style={{ paddingTop: insets.top, backgroundColor: colors.headerBar }}>
        <HeaderBar wordmark />
      </View>

      <FlatList
        data={rows}
        keyExtractor={(row) => row.slug}
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
          { paddingBottom: insets.bottom + BottomTabInset + FAB_GAP + FAB_SIZE + Spacing.three },
        ]}
        ListHeaderComponent={firstLaunch ? null : (
          <View>
            <Masthead
              tab={tab}
              counts={counts}
              colors={colors}
              hideValues={hideValues}
              total={tab === 'want' ? wantTotal : haveTotal}
              hasTotal={tab === 'want' ? wantHasPrice : haveHasPrice}
              sources={values.map((value) => priceSourceLabel(value.source))}
              unpricedCount={unpricedCount}
              priceState={priceState}
              priceError={priceError}
            />

            {loadError && <Text style={[styles.error, { color: colors.danger }]}>{loadError}</Text>}

            <View style={styles.tabs}>
              <FileTabs
                tabs={[
                  { key: 'have', label: 'Have' },
                  { key: 'want', label: 'Want' },
                  { key: 'all', label: counts.all > 0 ? `All ${counts.all}` : 'All' },
                ] as const}
                active={tab}
                onChange={setTab}
              />
            </View>
          </View>
        )}
        renderItem={({ item, index }) => (
          <FileRow
            row={item}
            index={index}
            attached={index === 0}
            catalog={catalog.get(item.slug)}
            detail={details.get(item.slug)}
            quote={quoteBySlug.get(item.slug) ?? null}
            priceState={item.entry ? priceState : 'unasked'}
            hideValues={hideValues}
            colors={colors}
            photoToken={photoToken}
            reducedMotion={reducedMotion}
            onChangeQuantity={changeQuantity}
            onRemove={confirmRemoval}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.rowGap} />}
        ListEmptyComponent={firstLaunch ? (
          <FirstLaunch catalogCount={counts.all} colors={colors} onBrowse={() => setTab('all')} />
        ) : (
          <EmptyTab tab={tab} colors={colors} />
        )}
      />

      {!firstLaunch && (
        <ScanFab colors={colors} bottom={insets.bottom + BottomTabInset + FAB_GAP} />
      )}
    </View>
  );
}

// ------------------------------------------------------------------ masthead

/**
 * The block above the tabs: what drawer this is, how much is in it, what it is worth.
 *
 * The money sentence is built by `TotalSentence`, which takes its claim as a required
 * prop, a collection total is a sum of medians that can span both price sources, so
 * `PriceFigure` cannot carry it, and this is the replacement that keeps the figure from
 * ever being rendered bare.
 */
function Masthead({
  tab,
  counts,
  colors,
  hideValues,
  total,
  hasTotal,
  sources,
  unpricedCount,
  priceState,
  priceError,
}: {
  tab: FileTab;
  counts: { have: number; want: number; all: number };
  colors: Palette;
  hideValues: boolean;
  total: number;
  hasTotal: boolean;
  sources: string[];
  unpricedCount: number;
  priceState: PriceState;
  priceError: string | null;
}) {
  const heading = {
    have: { label: 'Card file', title: `${counts.have} ${counts.have === 1 ? 'piece' : 'pieces'} shelved` },
    want: { label: 'On the hunt', title: `${counts.want} ${counts.want === 1 ? 'piece' : 'pieces'} wanted` },
    all: { label: 'The catalog', title: `${counts.all} ${counts.all === 1 ? 'piece' : 'pieces'} catalogued` },
  }[tab];

  return (
    <View style={styles.masthead}>
      <Label tone="spice">{heading.label}</Label>
      <Text style={[styles.title, { color: colors.text }]}>{heading.title}</Text>

      {tab === 'all' ? (
        <Text style={[styles.caption, { color: colors.textSecondary }]}>
          Everything in the catalog on this phone. {counts.have} shelved, {counts.want} on the hunt.
        </Text>
      ) : (
        <>
          <TotalSentence
            lead={tab === 'have' ? 'Worth about' : 'About'}
            trail={tab === 'have' ? '' : ' to finish the list'}
            total={hasTotal ? total : null}
            source={sources.length > 0 ? sources.join(' + ') : 'no comparables yet'}
            hideValues={hideValues}
            priceState={priceState}
            priceError={priceError}
            colors={colors}
            after={tab === 'have'
              ? counts.want > 0
                ? ` ${counts.want} more on the hunt.`
                : ' Nothing on the hunt yet.'
              : ''}
          />
          {!hideValues && priceState === 'ready' && unpricedCount > 0 && (
            <Text style={[styles.caption, { color: colors.textSecondary }]}>
              {unpricedCount} {unpricedCount === 1 ? 'piece has' : 'pieces have'} no comps and{' '}
              {unpricedCount === 1 ? 'is' : 'are'} excluded from this total.
            </Text>
          )}
        </>
      )}
    </View>
  );
}

/**
 * The collection total, welded to the claim behind it. `source` is required for the same
 * reason `PriceFigure` requires one: a number on its own does not say whether it came
 * from what sold or from what someone is asking.
 *
 * A total that is not there yet says which of the three reasons applies rather than
 * printing a zero: nothing was priced, the prices are still coming, or the batch failed.
 */
function TotalSentence({
  lead,
  trail,
  after,
  total,
  source,
  hideValues,
  priceState,
  priceError,
  colors,
}: {
  lead: string;
  trail: string;
  after: string;
  total: number | null;
  source: string;
  hideValues: boolean;
  priceState: PriceState;
  priceError: string | null;
  colors: Palette;
}) {
  const claim = hideValues
    ? 'Values are hidden on the shelf.'
    : priceState === 'pending'
      ? 'Checking comparable prices.'
      : priceState === 'error'
        ? `Prices unavailable: ${priceError ?? 'the price service did not answer'}.`
        : total === null
          ? 'No comparable prices found yet.'
          : `${lead} ${money.format(total)}${trail}, from comps ${source}.`;

  return <Text style={[styles.caption, { color: colors.textSecondary }]}>{claim}{after}</Text>;
}

// ------------------------------------------------------------------ rows

/**
 * One index card. Tile, pattern, the form and model line, then the price under it.
 *
 * A Have row ends in the ownership stepper, a Want row in the gold star. The price is
 * `PriceFigure` whenever a quote exists and whenever we asked and got nothing back; the
 * two states where we did not ask, prices still loading, and a catalog row that is not
 * in the collection, say that instead, because "no comparables" is a claim about the
 * market and those two are claims about this app.
 */
function FileRow({
  row,
  index,
  attached,
  catalog,
  detail,
  quote,
  priceState,
  hideValues,
  colors,
  photoToken,
  reducedMotion,
  onChangeQuantity,
  onRemove,
}: {
  row: Row;
  index: number;
  attached: boolean;
  catalog: CatalogRow | undefined;
  detail: ItemDetail | undefined;
  quote: PriceQuote | null;
  priceState: PriceState;
  hideValues: boolean;
  colors: Palette;
  photoToken: string | null;
  reducedMotion: boolean;
  onChangeQuantity: (item: UserItem, delta: number, pieceName: string) => Promise<void>;
  onRemove: (item: UserItem, pieceName: string) => void;
}) {
  // The card is pressed by the row's own Pressable but drawn by `Card`, so the state is
  // lifted rather than read from the style callback. Nesting the two would collapse the
  // stepper into the row's accessibility node and put it out of reach of a screen reader.
  const [pressed, setPressed] = useState(false);
  const entry = row.entry;
  const photo = detail?.photos[0];
  const knownPatternName = detail?.pattern.name ?? catalog?.patternName;
  const patternName = knownPatternName ?? 'Catalog details unavailable';
  const form = detail?.form.shape ?? catalog?.shape ?? 'Catalog details unavailable';
  const modelNo = detail?.form.modelNo ?? catalog?.modelNo ?? null;
  const pieceName = knownPatternName && modelNo ? `${knownPatternName} ${modelNo}` : 'this piece';
  const colorway = detail?.pattern.colorway ?? catalog?.colorway ?? null;
  const isNew = entry != null && Date.now() - Date.parse(entry.updatedAt) < NEW_WINDOW_MS;

  const caption = [
    form,
    modelNo,
    entry?.status === 'have' ? `×${entry.quantity}` : null,
  ].filter(Boolean).join(' · ');

  const entering = reducedMotion
    ? undefined
    : FadeInDown
      .duration(Motion.enter)
      .delay(Math.min(index, STAGGER_SLOTS - 1) * STAGGER_STEP)
      .easing(Easing.bezier(...Motion.easing))
      .withInitialValues({ transform: [{ translateY: Motion.enterOffset }] });

  return (
    <Animated.View entering={entering}>
      <Card
        attached={attached}
        style={[
          // The mock's ring sits outside the card and shifts nothing, which is an
          // outline rather than a border.
          isNew && {
            outlineWidth: 2,
            outlineColor: colors.accent,
            outlineStyle: 'solid',
            outlineOffset: Spacing.half,
          },
          pressed && { transform: [{ translateY: Motion.pressTranslate }] },
        ]}>
        <View style={styles.row}>
          <Pressable
            onPress={() => router.push({ pathname: '/item/[slug]', params: { slug: row.slug } })}
            accessibilityRole="button"
            accessibilityLabel={[
              patternName,
              caption.replaceAll('×', 'quantity '),
              entry?.status === 'want' ? 'on your want list' : null,
              isNew ? 'newly shelved' : null,
            ].filter(Boolean).join(', ')}
            onPressIn={() => setPressed(true)}
            onPressOut={() => setPressed(false)}
            style={styles.rowMain}>
            <SpecimenTile
              photo={photo}
              photoToken={photoToken}
              colorway={colorway}
              modelNo={modelNo}
              patternName={patternName}
              stampSize="small"
              style={styles.tile}
            />
            <View style={styles.rowCopy}>
              <Text numberOfLines={2} style={[styles.rowName, { color: colors.text }]}>
                {patternName}
              </Text>
              <Text numberOfLines={1} style={[styles.rowCaption, { color: colors.textSecondary }]}>
                {caption}
              </Text>
              {!hideValues && (
                priceState === 'ready' ? (
                  <PriceFigure quote={quote} emptyNote="No comparables yet." />
                ) : priceState === 'unasked' ? null : (
                  <Text style={[styles.rowPending, { color: colors.textTertiary }]}>
                    {priceState === 'error' ? 'Prices unavailable' : 'Checking comparables…'}
                  </Text>
                )
              )}
            </View>
          </Pressable>

          <View style={styles.rowTail}>
            {isNew && <Text style={[styles.newTag, { color: colors.accent }]}>New</Text>}
            {entry?.status === 'have' && (
              <Stepper
                item={entry}
                pieceName={pieceName}
                colors={colors}
                onChange={onChangeQuantity}
              />
            )}
            {entry?.status === 'want' && (
              <CircleButton
                size={30}
                onPress={() => onRemove(entry, pieceName)}
                accessibilityLabel={`Remove ${pieceName} from your want list`}>
                <Text style={[styles.star, { color: colors.want }]}>{'★'}</Text>
              </CircleButton>
            )}
          </View>
        </View>
      </Card>
    </Animated.View>
  );
}

/**
 * How many of this piece are on the shelf. `CircleButton` reaches 44dp through its own
 * `hitSlop` rather than by being 44dp, which keeps the stepper inside the height of the
 * 66pt tile beside it.
 */
function Stepper({
  item,
  pieceName,
  colors,
  onChange,
}: {
  item: UserItem;
  pieceName: string;
  colors: Palette;
  onChange: (item: UserItem, delta: number, pieceName: string) => Promise<void>;
}) {
  return (
    <View style={styles.stepper}>
      <CircleButton
        size={30}
        onPress={() => void onChange(item, 1, pieceName)}
        accessibilityLabel={`Add one more, ${item.quantity + 1} owned`}>
        +
      </CircleButton>
      <Text
        accessibilityLabel={`${item.quantity} owned`}
        style={[styles.quantity, { color: colors.text }]}>
        {item.quantity}
      </Text>
      <CircleButton
        size={30}
        onPress={() => void onChange(item, -1, pieceName)}
        accessibilityLabel={
          item.quantity <= 1
            ? `Remove ${pieceName} from your shelf`
            : `Remove one, ${item.quantity - 1} owned`
        }>
        {'−'}
      </CircleButton>
    </View>
  );
}

/** The scan action, sitting over the file. Spice, so it is the only object on the page. */
function ScanFab({ colors, bottom }: { colors: Palette; bottom: number }) {
  const elevation = useElevation();

  return (
    <Pressable
      onPress={() => router.push('/')}
      accessibilityRole="button"
      accessibilityLabel="Scan a piece"
      style={({ pressed }) => [
        styles.fab,
        { bottom, backgroundColor: colors.spice },
        !pressed && elevation.object,
        pressed && { transform: [{ translateY: Motion.pressTranslate }] },
      ]}>
      <Text style={styles.fabLabel}>SCAN</Text>
    </Pressable>
  );
}

// ------------------------------------------------------------------ empty

/**
 * Nothing filed at all. Three ruled slots waiting for the first three pieces, then the
 * one action worth taking. The browse link switches to the All tab, which is the only
 * place in the app that lists the whole catalog.
 */
function FirstLaunch({
  catalogCount,
  colors,
  onBrowse,
}: {
  catalogCount: number;
  colors: Palette;
  onBrowse: () => void;
}) {
  return (
    <View style={styles.firstLaunch}>
      <View
        style={styles.slots}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        {['01', '02', '03'].map((slot) => (
          <View key={slot} style={[styles.slot, { borderColor: colors.border }]}>
            <Text style={[styles.slotNo, { color: colors.textTertiary }]}>{slot}</Text>
          </View>
        ))}
      </View>

      <Text style={[styles.emptyTitle, { color: colors.text }]}>Nothing on the shelf yet</Text>
      <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
        Scan the first piece and we&apos;ll tell you what it is, what it&apos;s worth, and what
        else came in the set.
      </Text>

      <PressButton
        onPress={() => router.push('/')}
        accessibilityLabel="Scan my first piece"
        style={styles.emptyAction}>
        Scan my first piece
      </PressButton>

      {catalogCount > 0 && (
        <Pressable
          onPress={onBrowse}
          accessibilityRole="button"
          accessibilityLabel={`Browse all ${catalogCount} catalogued pieces`}
          style={styles.browseLink}>
          <Text style={[styles.browseText, { color: colors.spice }]}>
            or browse all {catalogCount}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/** One tab is empty but the file is not. Says which drawer is empty and why. */
function EmptyTab({ tab, colors }: { tab: FileTab; colors: Palette }) {
  return (
    <Card attached style={styles.emptyTab}>
      <Text style={[styles.emptyTabText, { color: colors.textSecondary }]}>
        {tab === 'have'
          ? 'Nothing on the shelf yet. Pieces land here when you mark them as owned.'
          : tab === 'want'
            ? 'Nothing on the hunt. Star a piece to keep it separate from what you own.'
            : 'The catalog has not downloaded yet. Pull to refresh once you have signal.'}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.gutter,
  },

  // --- masthead ---
  masthead: { paddingTop: Spacing.gutter, gap: Spacing.one },
  title: { ...Type.display, marginTop: Spacing.half },
  caption: { ...Type.callout },
  error: { ...Type.callout, marginTop: Spacing.two },
  tabs: { paddingTop: Spacing.three + Spacing.half },

  // --- rows ---
  rowGap: { height: Spacing.two + Spacing.half },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three - Spacing.one,
    padding: Spacing.three - Spacing.one,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three - Spacing.one,
  },
  tile: { width: TILE, height: TILE },
  rowCopy: { flex: 1, minWidth: 0, gap: Spacing.half },
  rowName: { ...Type.headline },
  rowCaption: { ...Type.caption },
  rowPending: { ...Type.caption, fontSize: 11, lineHeight: 16 },

  rowTail: { alignItems: 'center', gap: Spacing.two },
  newTag: { ...Type.micro },
  star: { ...Type.numeral, fontSize: 20, lineHeight: 24 },
  stepper: { alignItems: 'center', gap: Spacing.one },
  quantity: { ...Type.numeral, minWidth: Spacing.five, textAlign: 'center' },

  // --- fab ---
  fab: {
    position: 'absolute',
    right: Spacing.gutter,
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Cream on a solid spice field, which is exactly what `OnAccent` is for. */
  fabLabel: { ...Type.micro, fontSize: 11, letterSpacing: 0.6, color: OnAccent.text },

  // --- empty ---
  firstLaunch: {
    paddingTop: Spacing.five - Spacing.half,
    paddingHorizontal: Spacing.one,
    alignItems: 'center',
  },
  slots: { flexDirection: 'row', gap: Spacing.two + Spacing.half },
  slot: {
    width: 74,
    height: 74,
    borderRadius: Radius.md,
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotNo: { ...Type.numeral, fontFamily: Fonts.display },
  emptyTitle: { ...Type.title, marginTop: Spacing.four + Spacing.half, textAlign: 'center' },
  emptyBody: { ...Type.body, marginTop: Spacing.two, textAlign: 'center' },
  emptyAction: {
    marginTop: Spacing.four - Spacing.half,
    paddingHorizontal: Spacing.five - Spacing.half,
  },
  browseLink: {
    minHeight: HitTarget,
    justifyContent: 'center',
    paddingHorizontal: Spacing.two,
  },
  browseText: { ...Type.bodyStrong, fontSize: 13 },

  emptyTab: { padding: Spacing.gutter },
  emptyTabText: { ...Type.body },
});
