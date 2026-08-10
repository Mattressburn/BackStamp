/**
 * The specimen placard.
 *
 * One object, presented large, with its record stacked beneath it — the museum-label
 * treatment the archive reference uses. Rules instead of shadows; the only shadow on
 * the screen belongs to the specimen tile, because a physical dish casts one and a
 * panel of text does not. The accent is ceremonial: hairline outlines everywhere, and
 * a single solid fill on the one thing that changes what you own.
 */

import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import {
  Colors,
  Elevation,
  HitTarget,
  MaxContentWidth,
  Motion,
  Radius,
  Rule,
  Spacing,
  Type,
} from '@/constants/theme';
import {
  getForm,
  getPattern,
  getSettings,
  getUserItem,
  removeFromCollection,
  searchCatalog,
  setOwnership,
} from '@/db';
import {
  Divider,
  Label,
  PriceFigure,
  priceSourceLabel,
  RarityBadge,
  SpecimenTile,
  useColors,
} from '@/features/collection/collection-ui';
import type {
  Condition,
  ItemDetail,
  OwnershipStatus,
  Photo,
  PhotoVisibility,
  UserItem,
} from '@shared/types';

const money = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const CONDITIONS: Condition[] = ['mint', 'excellent', 'good', 'fair', 'damaged'];
const VISIBILITIES: PhotoVisibility[] = ['attributed', 'anonymous', 'private'];

const ENTER_EASING = Easing.bezier(...Motion.easing);

/**
 * Content arrives with a short fade and rise. `useReducedMotion` drops the animation
 * entirely rather than shortening it — a user who asked for no motion means none.
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
export default function ItemDetailScreen() {
  const params = useLocalSearchParams<{ slug: string | string[] }>();
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const photoSize = Math.min(
    width - (Spacing.three * 2),
    MaxContentWidth - (Spacing.three * 2),
  );
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [ownership, setUserItem] = useState<UserItem | null>(null);
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
        const [userItem, settings, rows, token] = await Promise.all([
          getUserItem(slug),
          getSettings(),
          searchCatalog('', Number.MAX_SAFE_INTEGER),
          getToken(),
        ]);
        const row = rows.find((candidate) => candidate.slug === slug);
        if (cancelled) return;

        setUserItem(userItem);
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

  async function reloadOwnership() {
    if (!slug) return;
    const next = await getUserItem(slug);
    setUserItem(next);
    setNotes(next?.notes ?? '');
  }

  async function chooseStatus(status: OwnershipStatus) {
    if (!slug) return;
    setSaving(true);
    setSaveError(null);
    try {
      await setOwnership(
        slug,
        status,
        status === 'have' ? Math.max(1, ownership?.quantity ?? 1) : 0,
        ownership?.condition ?? null,
        notes.trim() || null,
      );
      await reloadOwnership();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not update your collection.');
    } finally {
      setSaving(false);
    }
  }

  async function changeQuantity(delta: number) {
    if (!slug || ownership?.status !== 'have') return;
    const quantity = Math.max(1, ownership.quantity + delta);
    if (quantity === ownership.quantity) return;
    setSaving(true);
    setSaveError(null);
    try {
      await setOwnership(slug, 'have', quantity, ownership.condition, notes.trim() || null);
      await reloadOwnership();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not update quantity.');
    } finally {
      setSaving(false);
    }
  }

  async function chooseCondition(condition: Condition) {
    if (!slug || ownership?.status !== 'have') return;
    setSaving(true);
    setSaveError(null);
    try {
      await setOwnership(slug, 'have', ownership.quantity, condition, notes.trim() || null);
      await reloadOwnership();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not update condition.');
    } finally {
      setSaving(false);
    }
  }

  async function saveNotes() {
    if (!slug || !ownership) return;
    setSaving(true);
    setSaveError(null);
    try {
      await setOwnership(
        slug,
        ownership.status,
        ownership.quantity,
        ownership.condition,
        notes.trim() || null,
      );
      await reloadOwnership();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save notes.');
    } finally {
      setSaving(false);
    }
  }

  async function removeItem() {
    if (!slug) return;
    setSaving(true);
    setSaveError(null);
    try {
      await removeFromCollection(slug);
      setUserItem(null);
      setNotes('');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not remove this piece.');
    } finally {
      setSaving(false);
    }
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
        <Text style={[styles.patternName, { color: colors.text }]}>Piece unavailable</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          It is not in the offline catalog, and the network copy could not be loaded.
        </Text>
        <ActionButton label="Go back" onPress={() => router.back()} />
      </View>
    );
  }

  const years = formatYears(detail.pattern.yearsStart, detail.pattern.yearsEnd);
  const specs: { label: string; value: string; numeral?: boolean }[] = [
    { label: 'Production', value: years },
    { label: 'Colorway', value: detail.pattern.colorway ?? 'Not documented' },
    { label: 'Form', value: detail.form.shape },
    { label: 'Model number', value: detail.form.modelNo, numeral: true },
    ...(detail.form.capacityQt !== null
      ? [{ label: 'Capacity', value: `${detail.form.capacityQt} qt`, numeral: true }]
      : []),
    ...(detail.form.dimensions ? [{ label: 'Dimensions', value: detail.form.dimensions }] : []),
  ];

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + Spacing.two,
          paddingBottom: insets.bottom + Spacing.six,
        },
      ]}>
      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        style={({ pressed }) => [
          styles.backButton,
          { borderColor: colors.border },
          pressed && {
            backgroundColor: colors.backgroundElement,
            transform: [{ scale: Motion.pressScale }],
          },
        ]}>
        <Text style={[styles.backText, { color: colors.textSecondary }]}>‹ Back</Text>
      </Pressable>

      <Enter step={0}>
        <Hero detail={detail} photoToken={photoToken} size={photoSize} />
      </Enter>

      <Enter step={1} style={styles.placard}>
        <RarityBadge rarity={detail.rarity} />
        <Text style={[styles.patternName, { color: colors.text }]}>{detail.pattern.name}</Text>
        <View style={styles.placardMeta}>
          <Text style={[styles.formName, { color: colors.textSecondary }]}>{detail.form.shape}</Text>
          <View style={styles.modelLine}>
            <Label tone="secondary">model</Label>
            <Text style={[styles.modelNo, { color: colors.text }]}>{detail.form.modelNo}</Text>
          </View>
        </View>
      </Enter>

      {networkError && (
        <Text style={[styles.offlineNote, { color: colors.textSecondary, borderColor: colors.border }]}>
          Showing the offline catalog. Refresh unavailable: {networkError}
        </Text>
      )}

      <Enter step={2}>
        <Section title="Specification">
          <View style={styles.specTable}>
            <Divider />
            {specs.map((spec) => (
              <Spec key={spec.label} label={spec.label} value={spec.value} numeral={spec.numeral} />
            ))}
          </View>
          {detail.pattern.notes && (
            <Text style={[styles.body, { color: colors.textSecondary }]}>{detail.pattern.notes}</Text>
          )}
        </Section>
      </Enter>

      <Enter step={3}>
        <Section title="Current price range">
          <PriceFigure quote={detail.price} size="large" />
          {detail.price ? (
            <Text style={[styles.body, { color: colors.textSecondary }]}>
              Median {money.format(detail.price.median)} — {priceSourceLabel(detail.price.source)}.
            </Text>
          ) : (
            <Text style={[styles.body, { color: colors.textSecondary }]}>
              No comparable prices yet. This piece is excluded from collection totals.
            </Text>
          )}
        </Section>
      </Enter>

      <Enter step={4}>
        <Section title="Your collection" tinted>
          {/* The one solid fill on this screen. Everything else is a hairline outline. */}
          <View style={[styles.segment, { borderColor: colors.border }]}>
            {(['have', 'want'] as const).map((status, index) => {
              const selected = ownership?.status === status;
              return (
                <Pressable
                  key={status}
                  onPress={() => void chooseStatus(status)}
                  disabled={saving}
                  accessibilityRole="button"
                  accessibilityLabel={`Mark ${detail.pattern.name} as ${status === 'have' ? 'owned' : 'wanted'}`}
                  accessibilityState={{ selected, disabled: saving }}
                  style={({ pressed }) => [
                    styles.segmentButton,
                    index > 0 && { borderLeftWidth: Rule, borderLeftColor: colors.border },
                    selected && { backgroundColor: status === 'have' ? colors.have : colors.want },
                    pressed && !selected && { backgroundColor: colors.backgroundSelected },
                  ]}>
                  <Text style={[
                    styles.segmentText,
                    { color: selected ? colors.accentText : colors.textSecondary },
                  ]}>
                    {status === 'have' ? 'Have' : 'Want'}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {ownership?.status === 'have' && (
            <>
              <View style={styles.fieldRow}>
                <Label tone="secondary">Quantity</Label>
                <View style={[styles.stepper, { borderColor: colors.border }]}>
                  <Pressable
                    onPress={() => void changeQuantity(-1)}
                    disabled={saving || ownership.quantity <= 1}
                    accessibilityRole="button"
                    accessibilityLabel={`Decrease quantity of ${detail.pattern.name}`}
                    accessibilityState={{ disabled: saving || ownership.quantity <= 1 }}
                    style={({ pressed }) => [styles.stepperButton, pressed && { backgroundColor: colors.backgroundSelected }]}>
                    <Text style={[styles.stepperSymbol, { color: ownership.quantity <= 1 ? colors.textTertiary : colors.text }]}>−</Text>
                  </Pressable>
                  <Text
                    accessibilityLabel={`${ownership.quantity} owned`}
                    style={[styles.quantity, { color: colors.text, borderColor: colors.border }]}>
                    {ownership.quantity}
                  </Text>
                  <Pressable
                    onPress={() => void changeQuantity(1)}
                    disabled={saving}
                    accessibilityRole="button"
                    accessibilityLabel={`Increase quantity of ${detail.pattern.name}`}
                    accessibilityState={{ disabled: saving }}
                    style={({ pressed }) => [styles.stepperButton, pressed && { backgroundColor: colors.backgroundSelected }]}>
                    <Text style={[styles.stepperSymbol, { color: colors.text }]}>+</Text>
                  </Pressable>
                </View>
              </View>

              <Label tone="secondary">Condition</Label>
              <View style={styles.choiceWrap}>
                {CONDITIONS.map((condition) => {
                  const selected = ownership.condition === condition;
                  return (
                    <Pressable
                      key={condition}
                      onPress={() => void chooseCondition(condition)}
                      disabled={saving}
                      accessibilityRole="button"
                      accessibilityLabel={`Set condition to ${condition}`}
                      accessibilityState={{ selected, disabled: saving }}
                      style={({ pressed }) => [
                        styles.choice,
                        { borderColor: selected ? colors.accent : colors.border },
                        selected && { backgroundColor: colors.backgroundSelected },
                        pressed && { backgroundColor: colors.backgroundElement },
                      ]}>
                      <Text style={[styles.choiceText, { color: selected ? colors.text : colors.textSecondary }]}>
                        {condition}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          {ownership && (
            <>
              <Label tone="secondary">Notes</Label>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                editable={!saving}
                multiline
                placeholder="Where you found it, lid details, repairs…"
                placeholderTextColor={colors.textTertiary}
                accessibilityLabel={`Notes for ${detail.pattern.name}`}
                style={[
                  styles.notes,
                  { color: colors.text, backgroundColor: colors.background, borderColor: colors.border },
                ]}
              />
              <ActionButton
                label="Save notes"
                onPress={() => void saveNotes()}
                disabled={saving || notes.trim() === (ownership.notes ?? '')}
              />
              <Pressable
                onPress={() => void removeItem()}
                disabled={saving}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${detail.pattern.name} from collection`}
                accessibilityState={{ disabled: saving }}
                style={({ pressed }) => [styles.removeButton, pressed && { backgroundColor: colors.backgroundElement }]}>
                <Text style={[styles.removeText, { color: colors.danger }]}>Remove from collection</Text>
              </Pressable>
            </>
          )}
          {saveError && <Text style={[styles.error, { color: colors.danger }]}>{saveError}</Text>}
        </Section>
      </Enter>

      <Enter step={5}>
        <PhotoUpload
          itemSlug={detail.slug}
          patternName={detail.pattern.name}
          visibility={visibility}
          onVisibilityChange={setVisibility}
          onUploaded={refreshRemote}
        />
      </Enter>
    </ScrollView>
  );
}

/**
 * The object, presented large and almost unframed. With photographs it pages sideways;
 * without them the tile still carries the piece's documented colorway and its model
 * number, because a grey rectangle tells a collector nothing.
 */
function Hero({
  detail,
  photoToken,
  size,
}: {
  detail: ItemDetail;
  photoToken: string | null;
  size: number;
}) {
  const [page, setPage] = useState(0);
  const stride = size + Spacing.two;
  const photos = detail.photos;

  function onSettle(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const next = Math.min(
      Math.max(0, Math.round(event.nativeEvent.contentOffset.x / stride)),
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

  return (
    <View style={styles.hero}>
      {photos.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={stride}
          snapToAlignment="start"
          decelerationRate="fast"
          onMomentumScrollEnd={onSettle}
          contentContainerStyle={styles.heroStrip}
          accessibilityLabel={`Photographs of ${detail.pattern.name}`}>
          {photos.map((photo) => tile(photo))}
        </ScrollView>
      ) : (
        tile(photos[0] ?? null)
      )}
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
  size: number;
}) {
  const colors = useColors();

  return (
    <View
      style={[
        styles.heroTile,
        // Android draws `elevation` from the view's own outline, so the wrapper needs a
        // fill even though the tile covers it.
        { width: size, height: size, backgroundColor: colors.surface },
        Elevation.object,
      ]}>
      <SpecimenTile
        photo={photo}
        photoToken={photoToken}
        colorway={detail.pattern.colorway}
        modelNo={detail.form.modelNo}
        patternName={detail.pattern.name}
        stampSize="large"
        style={{ width: size, height: size }}
      />
      {photo?.visibility === 'attributed' && photo.uploaderHandle && (
        <View style={[styles.attribution, { backgroundColor: colors.scrim }]}>
          <Text style={[styles.attributionText, { color: Colors.light.accentText }]}>
            by {photo.uploaderHandle}
          </Text>
        </View>
      )}
    </View>
  );
}

/** Ticks rather than dots — the same rank vocabulary the rarity badge uses. */
function PageIndicator({ count, index }: { count: number; index: number }) {
  const colors = useColors();

  return (
    <View
      style={styles.pageIndicator}
      accessibilityLabel={`Photograph ${index + 1} of ${count}`}>
      {Array.from({ length: count }, (_, position) => (
        <View
          key={position}
          style={[
            styles.pageTick,
            { backgroundColor: position === index ? colors.text : colors.border },
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
    <Section title="Add your photo" tinted>
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
              { borderColor: selected ? colors.accent : colors.border },
              selected && { backgroundColor: colors.backgroundSelected },
              pressed && { backgroundColor: colors.backgroundElement },
            ]}>
            <View style={styles.visibilityCopy}>
              {/* Full-strength text, not a toned Label: this sits on a tinted field and
                  the toned greys fall under 4.5:1 there. Selection reads from the
                  accent hairline and the radio mark. */}
              <Text style={[styles.visibilityTitle, { color: colors.text }]}>{choice}</Text>
              <Text style={[styles.body, { color: colors.textSecondary }]}>{visibilityDescription(choice)}</Text>
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
            <ActionButton
              label="Cancel camera"
              onPress={() => {
                setCameraReady(false);
                setCameraOpen(false);
              }}
            />
            <ActionButton
              label={cameraReady ? 'Take photo' : 'Camera starting…'}
              onPress={() => void takePhoto()}
              disabled={!cameraReady}
              emphasis="accent"
            />
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
            <ActionButton label="Retake photo" onPress={() => void openCamera()} />
            <ActionButton
              label={uploading ? 'Uploading…' : `Upload as ${visibility}`}
              onPress={() => void submitPhoto()}
              disabled={uploading}
              emphasis="accent"
            />
          </View>
        </View>
      )}

      {!cameraOpen && !photoUri && (
        <ActionButton label="Take a photo" onPress={() => void openCamera()} emphasis="accent" />
      )}
      {error && <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>}
    </Section>
  );
}

function visibilityDescription(visibility: PhotoVisibility): string {
  if (visibility === 'attributed') return 'Published with your handle shown.';
  if (visibility === 'anonymous') {
    return 'Published without attribution, so people cannot connect a valuable piece to you.';
  }
  return 'Never published; use this when you do not want ownership of a valuable piece disclosed.';
}

function formatYears(start: number | null, end: number | null): string {
  if (start !== null && end !== null) return `${start}–${end}`;
  if (start !== null) return `${start} onward`;
  if (end !== null) return `Through ${end}`;
  return 'Not documented';
}

/**
 * Archive sections sit bare on the page under a hairline rule. The two sections that
 * change something — your collection and your photo — take a surface tint so the
 * interactive half of the screen reads apart from the record. No shadows either way.
 */
function Section({
  title,
  children,
  tinted = false,
}: {
  title: string;
  children: React.ReactNode;
  tinted?: boolean;
}) {
  const colors = useColors();

  return (
    <View
      style={[
        styles.section,
        tinted && styles.sectionPanel,
        tinted && { backgroundColor: colors.surface, borderColor: colors.border },
      ]}>
      {!tinted && <Divider />}
      <Label tone="secondary">{title}</Label>
      {children}
    </View>
  );
}

function Spec({ label, value, numeral = false }: { label: string; value: string; numeral?: boolean }) {
  const colors = useColors();

  return (
    <>
      <View style={styles.specRow}>
        {/* Wrapped rather than styled: `Label`'s own style prop is typed for a View. */}
        <View style={styles.specLabel}>
          <Label tone="secondary">{label}</Label>
        </View>
        <Text style={[numeral ? styles.specNumeral : styles.specValue, { color: colors.text }]}>
          {value}
        </Text>
      </View>
      <Divider />
    </>
  );
}

/**
 * Ghost by default. `accent` raises it to a ceremonial hairline outline rather than a
 * fill — the solid accent is spent once per screen, on the ownership control.
 */
function ActionButton({
  label,
  onPress,
  emphasis = 'plain',
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  emphasis?: 'plain' | 'accent';
  disabled?: boolean;
}) {
  const colors = useColors();
  const border = disabled ? colors.border : emphasis === 'accent' ? colors.accent : colors.border;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.actionButton,
        { borderColor: border },
        pressed && {
          backgroundColor: colors.backgroundElement,
          transform: [{ scale: Motion.pressScale }],
        },
      ]}>
      <Text style={[styles.actionText, { color: disabled ? colors.textTertiary : colors.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  missing: { paddingHorizontal: Spacing.four, gap: Spacing.three },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    gap: Spacing.four,
  },

  backButton: {
    alignSelf: 'flex-start',
    minHeight: HitTarget,
    paddingHorizontal: Spacing.three,
    borderWidth: Rule,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: { ...Type.label },

  // --- hero: the object, and the only shadow on the screen ---
  hero: { gap: Spacing.two },
  heroStrip: { gap: Spacing.two },
  heroTile: { borderRadius: Radius.sm },
  attribution: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
    borderRadius: Radius.xs,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  attributionText: { ...Type.label },
  pageIndicator: { flexDirection: 'row', gap: Spacing.one, justifyContent: 'center' },
  pageTick: { width: Spacing.three, height: Spacing.half, borderRadius: Radius.xs },

  // --- placard ---
  placard: { gap: Spacing.two, paddingTop: Spacing.two },
  patternName: { ...Type.display },
  placardMeta: { gap: Spacing.two, paddingTop: Spacing.one },
  formName: { ...Type.body },
  modelLine: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  modelNo: { ...Type.numeral },

  offlineNote: {
    ...Type.caption,
    borderWidth: Rule,
    borderRadius: Radius.xs,
    padding: Spacing.three,
  },

  // --- sections ---
  section: { gap: Spacing.three },
  sectionPanel: {
    borderWidth: Rule,
    borderRadius: Radius.sm,
    padding: Spacing.three,
  },
  body: { ...Type.body },

  specTable: { marginTop: -Spacing.two },
  specRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  specLabel: { flex: 1 },
  specValue: { ...Type.body, flex: 1, textAlign: 'right' },
  specNumeral: { ...Type.numeral, flex: 1, textAlign: 'right' },

  // --- collection ---
  segment: {
    flexDirection: 'row',
    borderWidth: Rule,
    borderRadius: Radius.sm,
    overflow: 'hidden',
  },
  segmentButton: { flex: 1, minHeight: HitTarget, alignItems: 'center', justifyContent: 'center' },
  segmentText: { ...Type.headline },
  fieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: Rule, borderRadius: Radius.sm },
  stepperButton: { minWidth: HitTarget, minHeight: HitTarget, alignItems: 'center', justifyContent: 'center' },
  stepperSymbol: { ...Type.headline },
  quantity: {
    ...Type.numeral,
    minWidth: Spacing.five,
    textAlign: 'center',
    borderLeftWidth: Rule,
    borderRightWidth: Rule,
    paddingVertical: Spacing.two,
  },
  choiceWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  choice: {
    minHeight: HitTarget,
    borderWidth: Rule,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceText: { ...Type.label },
  notes: {
    ...Type.body,
    minHeight: Spacing.six * 2,
    borderWidth: Rule,
    borderRadius: Radius.sm,
    padding: Spacing.three,
    textAlignVertical: 'top',
  },
  removeButton: { minHeight: HitTarget, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  removeText: { ...Type.label },
  error: { ...Type.callout },

  // --- photo upload ---
  visibilityChoice: {
    minHeight: HitTarget,
    borderWidth: Rule,
    borderRadius: Radius.sm,
    padding: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  visibilityCopy: { flex: 1, gap: Spacing.one },
  visibilityTitle: { ...Type.label },
  radioMark: { ...Type.headline },
  cameraFrame: { borderRadius: Radius.sm, overflow: 'hidden' },
  camera: { height: Spacing.six * 5 },
  cameraControls: { flexDirection: 'row', gap: Spacing.two, paddingTop: Spacing.two },
  previewBlock: { gap: Spacing.two },
  preview: { width: '100%', height: Spacing.six * 5, borderRadius: Radius.sm },

  actionButton: {
    flex: 1,
    minHeight: HitTarget,
    borderWidth: Rule,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: { ...Type.label, textAlign: 'center' },
});
