/**
 * The card for one piece.
 *
 * Harvest File screens 6 and 12. The record is a single raised index card, hero, name,
 * price, two spec chips, pulled out of the drawer, with a "card n of m" tab above it
 * telling you where it sits in the file. Everything the prototype did not draw (the
 * quantity stepper, condition, notes, your own photograph) is filed on plainer cards
 * below it, so the record stays the thing that reads first.
 *
 * Separation is the printed offset under each card. There is no blur anywhere.
 */

import { useNetInfo } from '@react-native-community/netinfo';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { Easing, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetchItem, getToken, uploadPhoto } from '@/api';
import { parseColorway } from '@/constants/colorways';
import {
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
  getForm,
  getPattern,
  getSettings,
  getUserItem,
  listQueuedScans,
  removeFromCollection,
  searchCatalog,
  setOwnership,
} from '@/db';
import {
  cardLabel,
  cardPosition,
  offlineNotice,
  type CardPosition,
} from '@/features/collection/card-position';
import {
  Card,
  CircleButton,
  Divider,
  Label,
  PhotoPlaceholder,
  PressButton,
  PriceFigure,
  provenanceLabel,
  RarityPill,
  SpecChip,
  SpecimenTile,
  useColors,
  useScheme,
} from '@/features/collection/collection-ui';
import type {
  Condition,
  ItemDetail,
  Photo,
  PhotoVisibility,
  UserItem,
} from '@shared/types';

const CONDITIONS: Condition[] = ['mint', 'excellent', 'good', 'fair', 'damaged'];
const VISIBILITIES: PhotoVisibility[] = ['attributed', 'anonymous', 'private'];

/** The prototype's hero proportion. Wider than square, so the dish sits in a drawer slot. */
const HERO_ASPECT = 1.4;
/** The prototype's card padding, and the width of the star button beside the primary. */
const CARD_PAD = Spacing.three + Spacing.half; // 18
const STAR_WIDTH = 58;

const ENTER_EASING = Easing.bezier(...Motion.easing);

/**
 * Content arrives with a short fade and rise. `useReducedMotion` drops the animation
 * entirely rather than shortening it, a user who asked for no motion means none.
 */
function Enter({
  step = 0,
  style,
  children,
}: {
  step?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const reduced = useReducedMotion();

  return (
    <Animated.View
      style={style}
      entering={
        reduced
          ? undefined
          : FadeInDown.duration(Motion.enter)
              .delay(step * Motion.press)
              .easing(ENTER_EASING)
              .withInitialValues({ opacity: 0, transform: [{ translateY: Motion.enterOffset }] })
      }>
      {children}
    </Animated.View>
  );
}

// CONTRACT: app.json must declare the expo-camera permission used by photo uploads.
// CONTRACT: components/app-tabs.tsx should hide the tab bar on /item/[slug], handoff
// screens 6 and 12 draw none, and the pinned footer below is padded for a bare screen
// edge. If the bar stays, this screen's footer needs `BottomTabInset` added to it.
export default function ItemDetailScreen() {
  const params = useLocalSearchParams<{ slug: string | string[] }>();
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const netInfo = useNetInfo();
  // `isConnected` is null until the first probe, so only an explicit false is offline.
  // Same predicate the scan screen uses; the two must not disagree about the word.
  const offline = netInfo.isConnected === false || netInfo.isInternetReachable === false;

  const heroWidth = Math.min(width, MaxContentWidth) - Spacing.gutter * 2;
  const heroHeight = Math.round(heroWidth / HERO_ASPECT);

  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [ownership, setUserItem] = useState<UserItem | null>(null);
  const [position, setPosition] = useState<CardPosition | null>(null);
  const [queuedCount, setQueuedCount] = useState(0);
  const [notes, setNotes] = useState('');
  const [visibility, setVisibility] = useState<PhotoVisibility>('private');
  const [loading, setLoading] = useState(true);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [photoToken, setPhotoToken] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refreshRemote = useCallback(async () => {
    if (!slug) return;
    const result = await fetchItem(slug);
    if (result.ok) {
      setDetail(result.data);
      setNetworkError(null);
    } else {
      setNetworkError(result.error);
    }
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!slug) {
        setLoading(false);
        return;
      }

      try {
        const [userItem, collection, queued, settings, rows, token] = await Promise.all([
          getUserItem(slug),
          getCollection(),
          listQueuedScans(),
          getSettings(),
          searchCatalog('', Number.MAX_SAFE_INTEGER),
          getToken(),
        ]);
        const row = rows.find((candidate) => candidate.slug === slug);
        if (cancelled) return;

        setUserItem(userItem);
        setPosition(cardPosition(collection, slug));
        setQueuedCount(queued.length);
        setNotes(userItem?.notes ?? '');
        setVisibility(settings.defaultPhotoVisibility);
        setPhotoToken(token);

        let foundLocal = false;
        if (row) {
          const [pattern, form] = await Promise.all([
            getPattern(row.patternId),
            getForm(row.formId),
          ]);
          if (!cancelled && pattern && form) {
            foundLocal = true;
            setDetail({
              slug: row.slug,
              patternId: row.patternId,
              formId: row.formId,
              rarity: row.rarity,
              ebayQuery: row.ebayQuery,
              provenance: row.provenance,
              userSubmitted: Boolean(row.userSubmitted),
              pattern,
              form,
              photos: [],
              price: null,
            });
          }
        }

        if (!cancelled && foundLocal) setLoading(false);
        const result = await fetchItem(slug);
        if (cancelled) return;
        if (result.ok) setDetail(result.data);
        else setNetworkError(result.error);
        setLoading(false);
      } catch (error) {
        if (!cancelled) {
          setNetworkError(error instanceof Error ? error.message : 'Could not load this piece.');
          setLoading(false);
        }
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [slug]);

  /**
   * Filing a piece bumps its `updated_at`, and the file is ordered by that, so the card
   * number changes on every save. Re-read it here or the label quietly goes stale.
   */
  async function reloadOwnership() {
    if (!slug) return;
    const [next, collection] = await Promise.all([getUserItem(slug), getCollection()]);
    setUserItem(next);
    setPosition(cardPosition(collection, slug));
    setNotes(next?.notes ?? '');
  }

  async function save(work: () => Promise<void>, failure: string) {
    setSaving(true);
    setSaveError(null);
    try {
      await work();
      await reloadOwnership();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : failure);
    } finally {
      setSaving(false);
    }
  }

  // CONTRACT: shared/types.ts gives `UserItem` one `status`, so have and want are
  // mutually exclusive, but the footer draws them as two independent controls. Starring
  // an owned piece therefore moves it off the have list and drops its quantity. If the
  // handoff means them to be independent, `UserItem` needs a separate `wanted` flag and
  // `db.ts#setOwnership` a way to set it.
  async function file() {
    if (!slug) return;
    const quantity = ownership?.status === 'have' ? ownership.quantity + 1 : 1;
    await save(
      () => setOwnership(slug, 'have', quantity, ownership?.condition ?? null, notes.trim() || null),
      'Could not update your collection.',
    );
  }

  async function toggleWant(pieceName: string) {
    if (!slug) return;
    const wanted = ownership?.status === 'want';
    if (wanted) {
      confirmRemoval(pieceName);
      return;
    }
    await save(
      () => setOwnership(slug, 'want', 0, null, notes.trim() || null),
      'Could not update your want list.',
    );
  }

  async function changeQuantity(delta: number, pieceName: string) {
    if (!slug || ownership?.status !== 'have') return;
    if (delta < 0 && ownership.quantity <= 1) {
      confirmRemoval(pieceName);
      return;
    }
    const quantity = Math.max(1, ownership.quantity + delta);
    await save(
      () => setOwnership(slug, 'have', quantity, ownership.condition, notes.trim() || null),
      'Could not update quantity.',
    );
  }

  async function chooseCondition(condition: Condition) {
    if (!slug || ownership?.status !== 'have') return;
    await save(
      () => setOwnership(slug, 'have', ownership.quantity, condition, notes.trim() || null),
      'Could not update condition.',
    );
  }

  async function saveNotes() {
    if (!slug || !ownership) return;
    await save(
      () => setOwnership(
        slug,
        ownership.status,
        ownership.quantity,
        ownership.condition,
        notes.trim() || null,
      ),
      'Could not save notes.',
    );
  }

  async function removeItem() {
    if (!slug) return;
    await save(() => removeFromCollection(slug), 'Could not remove this piece.');
  }

  function confirmRemoval(pieceName: string) {
    if (saving) return;
    Alert.alert(
      'Remove piece',
      `Remove ${pieceName} from your shelf?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => void removeItem(),
        },
      ],
    );
  }

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator
          color={colors.accent}
          accessibilityLabel="Loading item details"
          accessibilityRole="progressbar"
        />
      </View>
    );
  }

  if (!detail) {
    return (
      <View style={[
        styles.centered,
        styles.missing,
        { backgroundColor: colors.background, paddingTop: insets.top + Spacing.three },
      ]}>
        <Text style={[styles.title, { color: colors.text }]}>Piece unavailable</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          It is not in the offline catalog, and the network copy could not be loaded.
        </Text>
        <PressButton tone="quiet" onPress={() => router.back()}>Go back</PressButton>
      </View>
    );
  }

  const owned = ownership?.status === 'have' ? ownership.quantity : 0;
  const wanted = ownership?.status === 'want';
  const name = detail.pattern.name;
  const pieceName = `${name} ${detail.form.modelNo}`;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.grow}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + Spacing.two,
            // Clears the pinned footer, measured rather than guessed: a `PressButton` is
            // its line box plus `Spacing.three` top and bottom, then the footer's own
            // padding and the home indicator.
            paddingBottom:
              insets.bottom
              + Type.bodyStrong.lineHeight + Spacing.three * 2
              + Spacing.three + Spacing.four,
          },
        ]}>
        <View style={styles.cardTab}>
          <CircleButton onPress={() => router.back()} accessibilityLabel="Back to the file">
            ‹
          </CircleButton>
          <Label tone="tertiary">{cardLabel(position)}</Label>
        </View>

        {offline && (
          <View style={[styles.banner, { backgroundColor: colors.spice }]} accessibilityRole="alert">
            <View style={[styles.bannerDot, { backgroundColor: colors.want }]} />
            <Text style={[styles.bannerText, { color: OnAccent.text }]}>
              {offlineNotice(queuedCount)}
            </Text>
          </View>
        )}

        <Enter step={0}>
          <Card raised style={styles.recordCard}>
            <Hero
              detail={detail}
              photoToken={photoToken}
              width={heroWidth}
              height={heroHeight}
            />
            <View style={styles.record}>
              <Text style={[styles.title, { color: colors.text }]}>{name}</Text>
              <Text style={[styles.caption, { color: colors.textSecondary }]}>
                {describe(detail)}
              </Text>
              <View style={styles.priceSlot}>
                <PriceFigure
                  quote={detail.price}
                  size="large"
                  block
                  emptyNote={
                    offline
                      ? "No comparables in the last 90 days. We'll check again when you're back online."
                      : 'No comparables in the last 90 days. This piece is excluded from collection totals.'
                  }
                />
              </View>
              <View style={styles.chipRow}>
                <SpecChip label="Model" value={detail.form.modelNo} />
                <SpecChip label="You own" value={String(owned)} />
              </View>
              <Label tone="tertiary" style={styles.claimLabel}>
                {provenanceLabel(detail.provenance)}
              </Label>
            </View>
          </Card>
        </Enter>

        {networkError && !offline && (
          <Text style={[styles.caption, { color: colors.textSecondary }]}>
            Showing the copy on this phone. The catalog could not be refreshed: {networkError}
          </Text>
        )}

        {/* Everything below here the prototype was silent about. It keeps working. */}
        <Enter step={1}>
          <Card style={styles.panel}>
            <Label>Your copy</Label>

            {ownership?.status === 'have' ? (
              <>
                <View style={styles.fieldRow}>
                  <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Quantity</Text>
                  <View style={styles.stepper}>
                    <CircleButton
                      onPress={() => void changeQuantity(-1, pieceName)}
                      accessibilityLabel={
                        ownership.quantity <= 1
                          ? `Remove ${pieceName} from your shelf`
                          : `Decrease quantity of ${pieceName}`
                      }>
                      −
                    </CircleButton>
                    <Text
                      accessibilityLabel={`${ownership.quantity} owned`}
                      style={[styles.quantity, { color: colors.text }]}>
                      {ownership.quantity}
                    </Text>
                    <CircleButton
                      onPress={() => void changeQuantity(1, pieceName)}
                      accessibilityLabel={`Increase quantity of ${pieceName}`}>
                      +
                    </CircleButton>
                  </View>
                </View>

                <Divider />

                <View style={styles.field}>
                  <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Condition</Text>
                  <View style={styles.chipWrap}>
                    {CONDITIONS.map((condition) => {
                      const selected = ownership.condition === condition;
                      return (
                        <Pressable
                          key={condition}
                          onPress={() => void chooseCondition(condition)}
                          disabled={saving}
                          hitSlop={Spacing.two}
                          accessibilityRole="button"
                          accessibilityLabel={`Set condition to ${condition}`}
                          accessibilityState={{ selected, disabled: saving }}
                          style={({ pressed }) => [
                            styles.filterChip,
                            {
                              backgroundColor: selected ? colors.accent : colors.backgroundElement,
                            },
                            pressed && { transform: [{ translateY: Motion.pressTranslate }] },
                          ]}>
                          <Text
                            style={[
                              styles.filterChipText,
                              { color: selected ? colors.accentText : colors.textSecondary },
                            ]}>
                            {condition}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              </>
            ) : (
              <Text style={[styles.body, { color: colors.textSecondary }]}>
                {wanted
                  ? 'On your want list. File it and you can record how many you have and what shape they are in.'
                  : 'Not filed yet. File it and you can record how many you have and what shape they are in.'}
              </Text>
            )}

            {ownership && (
              <>
                <Divider />
                <View style={styles.field}>
                  <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Notes</Text>
                  <TextInput
                    value={notes}
                    onChangeText={setNotes}
                    editable={!saving}
                    multiline
                    placeholder="Where you found it, lid details, repairs…"
                    placeholderTextColor={colors.textTertiary}
                    accessibilityLabel={`Notes for ${name}`}
                    style={[styles.notes, { color: colors.text, backgroundColor: colors.background }]}
                  />
                  <Text style={[styles.footnote, { color: colors.textTertiary }]}>
                    Notes and condition stay on this phone. Sync carries slugs and counts only.
                  </Text>
                </View>
                <PressButton
                  tone="quiet"
                  onPress={() => void saveNotes()}
                  disabled={saving || notes.trim() === (ownership.notes ?? '')}
                  accessibilityLabel={`Save notes for ${name}`}>
                  Save notes
                </PressButton>
                <Pressable
                  onPress={() => confirmRemoval(pieceName)}
                  disabled={saving}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${pieceName} from your file`}
                  accessibilityState={{ disabled: saving }}
                  style={styles.removeButton}>
                  <Text style={[styles.removeText, { color: colors.danger }]}>
                    Remove from my file
                  </Text>
                </Pressable>
              </>
            )}

            {saveError && <Text style={[styles.error, { color: colors.danger }]}>{saveError}</Text>}
          </Card>
        </Enter>

        <Enter step={2}>
          <PhotoUpload
            itemSlug={detail.slug}
            patternName={name}
            visibility={visibility}
            onVisibilityChange={setVisibility}
            onUploaded={refreshRemote}
          />
        </Enter>
      </ScrollView>

      <View
        style={[
          styles.footer,
          { backgroundColor: colors.background, paddingBottom: insets.bottom + Spacing.four },
        ]}>
        {/* CONTRACT: PressButton in collection-ui.tsx overrides a caller's
            `accessibilityState`, so neither control below can announce `selected`. The
            state is spelled into the label meanwhile. Merging the two would fix it. */}
        <PressButton
          tone="primary"
          onPress={() => void file()}
          disabled={saving}
          style={styles.fileButton}
          accessibilityLabel={
            owned > 0
              ? `${name} is in your file, ${owned} owned. Add another.`
              : `Put ${name} in my file`
          }>
          {owned > 0 ? 'Add another' : 'In my file'}
        </PressButton>
        <PressButton
          tone="quiet"
          onPress={() => void toggleWant(pieceName)}
          disabled={saving}
          style={styles.starButton}
          accessibilityLabel={
            wanted ? `${name} is on your want list. Take it off.` : `Add ${name} to my want list`
          }>
          <Text style={[styles.star, { color: wanted ? colors.want : colors.spice }]}>★</Text>
        </PressButton>
      </View>
    </View>
  );
}

/**
 * The hero, filling the top of the card edge to edge.
 *
 * Photograph if there is one, and it pages sideways when there are several. With no
 * photograph the piece still arrives wearing its documented colorway, marked as a
 * swatch. Only when the catalog has no colorway to read either does the slot go to the
 * striped placeholder, that is the honest "we have nothing" state, and a grey
 * rectangle is what it should look like.
 */
function Hero({
  detail,
  photoToken,
  width,
  height,
}: {
  detail: ItemDetail;
  photoToken: string | null;
  width: number;
  height: number;
}) {
  const scheme = useScheme();
  const [page, setPage] = useState(0);
  const photos = detail.photos;
  const size = { width, height, borderRadius: 0 } as const;

  function onSettle(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const next = Math.min(
      Math.max(0, Math.round(event.nativeEvent.contentOffset.x / width)),
      photos.length - 1,
    );
    if (next !== page) setPage(next);
  }

  const tile = (photo: Photo | null) => (
    <HeroTile
      key={photo?.id ?? detail.slug}
      photo={photo}
      photoToken={photoToken}
      detail={detail}
      size={size}
    />
  );

  const body =
    photos.length > 1 ? (
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        snapToInterval={width}
        decelerationRate="fast"
        onMomentumScrollEnd={onSettle}
        accessibilityLabel={`Photographs of ${detail.pattern.name}`}>
        {photos.map((photo) => tile(photo))}
      </ScrollView>
    ) : photos.length === 1 ? (
      tile(photos[0])
    ) : parseColorway(detail.pattern.colorway, scheme) ? (
      tile(null)
    ) : (
      <PhotoPlaceholder style={size} />
    );

  return (
    <View style={{ width, height }}>
      {body}
      <View style={styles.rarityCorner} pointerEvents="none">
        <RarityPill rarity={detail.rarity} />
      </View>
      {photos.length > 1 && <PageIndicator count={photos.length} index={page} />}
    </View>
  );
}

function HeroTile({
  photo,
  photoToken,
  detail,
  size,
}: {
  photo: Photo | null;
  photoToken: string | null;
  detail: ItemDetail;
  size: { width: number; height: number; borderRadius: number };
}) {
  const colors = useColors();

  return (
    <View style={size}>
      <SpecimenTile
        photo={photo}
        photoToken={photoToken}
        colorway={detail.pattern.colorway}
        modelNo={detail.form.modelNo}
        patternName={detail.pattern.name}
        stampSize="large"
        style={size}
      />
      {photo?.visibility === 'attributed' && photo.uploaderHandle && (
        <View style={[styles.attribution, { backgroundColor: colors.scrim }]}>
          <Text style={[styles.attributionText, { color: OnAccent.text }]}>
            by {photo.uploaderHandle}
          </Text>
        </View>
      )}
    </View>
  );
}

/** Ticks rather than dots, the same rank vocabulary the rarity badge uses. */
function PageIndicator({ count, index }: { count: number; index: number }) {
  const colors = useColors();

  return (
    <View
      style={styles.pageIndicator}
      pointerEvents="none"
      accessibilityLabel={`Photograph ${index + 1} of ${count}`}>
      {Array.from({ length: count }, (_, position) => (
        <View
          key={position}
          style={[
            styles.pageTick,
            { backgroundColor: position === index ? OnAccent.text : OnAccent.rule },
          ]}
        />
      ))}
    </View>
  );
}

function PhotoUpload({
  itemSlug,
  patternName,
  visibility,
  onVisibilityChange,
  onUploaded,
}: {
  itemSlug: string;
  patternName: string;
  visibility: PhotoVisibility;
  onVisibilityChange: (visibility: PhotoVisibility) => void;
  onUploaded: () => Promise<void>;
}) {
  const colors = useColors();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openCamera() {
    try {
      const next = permission?.granted ? permission : await requestPermission();
      if (!next.granted) {
        setError('Camera access is needed to add your photo.');
        return;
      }
      setError(null);
      setCameraReady(false);
      setCameraOpen(true);
    } catch (cameraError) {
      setError(cameraError instanceof Error ? cameraError.message : 'Could not open the camera.');
    }
  }

  async function takePhoto() {
    try {
      const photo = await camera.current?.takePictureAsync();
      if (!photo) return;
      setPhotoUri(photo.uri);
      setCameraReady(false);
      setCameraOpen(false);
    } catch (cameraError) {
      setError(cameraError instanceof Error ? cameraError.message : 'Could not take the photo.');
    }
  }

  async function submitPhoto() {
    if (!photoUri) return;
    setUploading(true);
    setError(null);
    try {
      const result = await uploadPhoto({ itemSlug, photoUri, visibility });
      if (result.ok) {
        setPhotoUri(null);
        await onUploaded();
      } else {
        setError(result.error);
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Could not upload the photo.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card style={styles.panel}>
      <Label>Your photograph</Label>
      <Text style={[styles.body, { color: colors.textSecondary }]}>
        Location metadata is removed by the server before the photo is stored.
      </Text>

      {/* CONTRACT: uploadPhoto needs a per-upload handle when visibility is attributed. */}

      {VISIBILITIES.map((choice) => {
        const selected = visibility === choice;
        return (
          <Pressable
            key={choice}
            onPress={() => onVisibilityChange(choice)}
            accessibilityRole="radio"
            accessibilityLabel={`${choice} photo visibility. ${visibilityDescription(choice)}`}
            accessibilityState={{ selected }}
            style={({ pressed }) => [
              styles.visibilityChoice,
              { backgroundColor: selected ? colors.backgroundElement : colors.background },
              pressed && { transform: [{ translateY: Motion.pressTranslate }] },
            ]}>
            <View style={styles.visibilityCopy}>
              <Text style={[styles.visibilityTitle, { color: colors.text }]}>{choice}</Text>
              <Text style={[styles.footnote, { color: colors.textSecondary }]}>
                {visibilityDescription(choice)}
              </Text>
            </View>
            <Text style={[styles.radioMark, { color: selected ? colors.accent : colors.textTertiary }]}>
              {selected ? '●' : '○'}
            </Text>
          </Pressable>
        );
      })}

      {cameraOpen && (
        <View style={[styles.cameraFrame, { backgroundColor: colors.backgroundElement }]}>
          <CameraView
            ref={camera}
            facing="back"
            mode="picture"
            onCameraReady={() => setCameraReady(true)}
            style={styles.camera}
          />
          <View style={styles.cameraControls}>
            <PressButton
              tone="quiet"
              style={styles.grow}
              onPress={() => {
                setCameraReady(false);
                setCameraOpen(false);
              }}>
              Cancel
            </PressButton>
            <PressButton
              tone="primary"
              style={styles.grow}
              onPress={() => void takePhoto()}
              disabled={!cameraReady}>
              {cameraReady ? 'Take photo' : 'Camera starting…'}
            </PressButton>
          </View>
        </View>
      )}

      {photoUri && !cameraOpen && (
        <View style={styles.previewBlock}>
          <Image
            source={{ uri: photoUri }}
            contentFit="cover"
            style={[styles.preview, { backgroundColor: colors.backgroundElement }]}
            accessibilityLabel={`New photo of ${patternName}`}
          />
          <View style={styles.cameraControls}>
            <PressButton tone="quiet" style={styles.grow} onPress={() => void openCamera()}>
              Retake
            </PressButton>
            <PressButton
              tone="primary"
              style={styles.grow}
              onPress={() => void submitPhoto()}
              disabled={uploading}>
              {uploading ? 'Uploading…' : `Upload as ${visibility}`}
            </PressButton>
          </View>
        </View>
      )}

      {!cameraOpen && !photoUri && (
        <PressButton
          tone="primary"
          onPress={() => void openCamera()}
          accessibilityLabel={`Take a photo of ${patternName}`}>
          Take a photo
        </PressButton>
      )}
      {error && <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>}
    </Card>
  );
}

function visibilityDescription(visibility: PhotoVisibility): string {
  if (visibility === 'attributed') return 'Published with your handle shown.';
  if (visibility === 'anonymous') {
    return 'Published without attribution, so people cannot connect a valuable piece to you.';
  }
  return 'Never published; use this when you do not want ownership of a valuable piece disclosed.';
}

/** "Green on white · 2 qt round casserole · made 1972–1979". Blanks drop out. */
function describe(detail: ItemDetail): string {
  const { colorway } = detail.pattern;
  const form = [
    detail.form.capacityQt !== null ? `${detail.form.capacityQt} qt` : null,
    detail.form.shape,
  ].filter(Boolean).join(' ');

  return [
    colorway ? colorway.charAt(0).toUpperCase() + colorway.slice(1) : null,
    form,
    productionYears(detail.pattern.yearsStart, detail.pattern.yearsEnd),
  ].filter(Boolean).join(' · ');
}

function productionYears(start: number | null, end: number | null): string | null {
  if (start !== null && end !== null) return `made ${start}–${end}`;
  if (start !== null) return `made ${start} onward`;
  if (end !== null) return `made through ${end}`;
  return null;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  missing: { paddingHorizontal: Spacing.four, gap: Spacing.three },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.gutter,
    gap: Spacing.two + Spacing.half,
  },

  cardTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + Spacing.half,
    paddingVertical: Spacing.two,
  },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + Spacing.half,
    borderRadius: Radius.md,
    paddingVertical: Spacing.three - Spacing.one,
    paddingHorizontal: Spacing.three - Spacing.half,
  },
  bannerDot: { width: 10, height: 10, borderRadius: Radius.pill },
  bannerText: { ...Type.caption, flex: 1 },

  // --- the record ---
  recordCard: { borderRadius: Radius.xl },
  record: { padding: CARD_PAD },
  // The prototype draws this at 31px, but the handoff's type table gives `title` as
  // 27/31 and declares itself authoritative over the HTML. Token, not the mock.
  title: { ...Type.title },
  caption: { ...Type.callout, marginTop: Spacing.one },
  priceSlot: { marginTop: Spacing.three - Spacing.half },
  chipRow: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.three - Spacing.half },
  claimLabel: { marginTop: Spacing.three },

  rarityCorner: { position: 'absolute', left: CARD_PAD - Spacing.one, top: CARD_PAD - Spacing.one },
  attribution: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
    borderRadius: Radius.xs,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  attributionText: { ...Type.micro },
  pageIndicator: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: Spacing.two,
    flexDirection: 'row',
    gap: Spacing.one,
    justifyContent: 'center',
  },
  pageTick: { width: Spacing.three, height: Spacing.one, borderRadius: Radius.pill },

  // --- the panels the prototype did not draw ---
  panel: { padding: Spacing.three, gap: Spacing.three },
  body: { ...Type.body },
  footnote: { ...Type.caption, fontSize: 11, lineHeight: 16 },
  field: { gap: Spacing.two },
  fieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fieldLabel: { ...Type.micro },

  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  quantity: { ...Type.numeralLarge, minWidth: Spacing.five, textAlign: 'center' },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two - Spacing.half },
  filterChip: {
    borderRadius: Radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterChipText: { ...Type.bodyStrong, fontSize: 11, lineHeight: 14 },

  notes: {
    ...Type.body,
    minHeight: Spacing.six + Spacing.four,
    borderRadius: Radius.sm,
    padding: Spacing.three - Spacing.half,
    textAlignVertical: 'top',
  },
  removeButton: {
    minHeight: HitTarget,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: { ...Type.micro },
  error: { ...Type.callout },

  // --- photo upload ---
  visibilityChoice: {
    minHeight: HitTarget,
    borderRadius: Radius.sm,
    padding: Spacing.three - Spacing.half,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  visibilityCopy: { flex: 1, gap: Spacing.half },
  visibilityTitle: { ...Type.micro },
  radioMark: { ...Type.headline },
  cameraFrame: { borderRadius: Radius.sm, overflow: 'hidden' },
  camera: { height: Spacing.six * 5 },
  cameraControls: { flexDirection: 'row', gap: Spacing.two, paddingTop: Spacing.two },
  previewBlock: { gap: Spacing.two },
  preview: { width: '100%', height: Spacing.six * 5, borderRadius: Radius.sm },
  grow: { flex: 1 },

  // --- the pinned footer ---
  footer: {
    flexDirection: 'row',
    gap: Spacing.two + Spacing.half,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.gutter,
    paddingTop: Spacing.three - Spacing.half,
  },
  fileButton: { flex: 1 },
  starButton: { width: STAR_WIDTH, paddingHorizontal: 0 },
  star: { ...Type.bodyStrong, fontSize: 16, lineHeight: 20 },
});
