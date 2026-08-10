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
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetchItem, getToken, uploadPhoto } from '@/api';
import {
  Colors,
  Elevation,
  HitTarget,
  MaxContentWidth,
  Radius,
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
  AiApproximationBadge,
  PhotoPlaceholder,
  photoSource,
  priceSourceLabel,
  RarityBadge,
} from '@/features/collection/collection-ui';
import type {
  Condition,
  ItemDetail,
  OwnershipStatus,
  PhotoVisibility,
  UserItem,
} from '@shared/types';

const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });
const CONDITIONS: Condition[] = ['mint', 'excellent', 'good', 'fair', 'damaged'];
const VISIBILITIES: PhotoVisibility[] = ['attributed', 'anonymous', 'private'];

// CONTRACT: app.json must declare the expo-camera permission used by photo uploads.
export default function ItemDetailScreen() {
  const params = useLocalSearchParams<{ slug: string | string[] }>();
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  const colors = Colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
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
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Piece unavailable</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          It is not in the offline catalog, and the network copy could not be loaded.
        </Text>
        <ActionButton label="Go back" onPress={() => router.back()} colors={colors} />
      </View>
    );
  }

  const years = formatYears(detail.pattern.yearsStart, detail.pattern.yearsEnd);

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + Spacing.two,
          paddingBottom: insets.bottom + Spacing.five,
        },
      ]}>
      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        style={({ pressed }) => [
          styles.backButton,
          { backgroundColor: pressed ? colors.backgroundSelected : colors.backgroundElement },
        ]}>
        <Text style={[styles.backText, { color: colors.text }]}>‹ Back</Text>
      </Pressable>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.photoStrip}
        accessibilityLabel={`Photos of ${detail.pattern.name}`}>
        {detail.photos.length > 0 ? detail.photos.map((photo) => (
          <View
            key={photo.id}
            style={[
              styles.heroPhoto,
              { width: photoSize, height: photoSize, backgroundColor: colors.backgroundElement },
            ]}>
            <Image source={photoSource(photo, photoToken)} contentFit="cover" style={styles.image} />
            {photo.isAiPlaceholder && <AiApproximationBadge />}
            {photo.visibility === 'attributed' && photo.uploaderHandle && (
              <View style={[styles.photoAttribution, { backgroundColor: colors.scrim }]}>
                <Text style={[styles.photoAttributionText, { color: Colors.light.accentText }]}>
                  by {photo.uploaderHandle}
                </Text>
              </View>
            )}
          </View>
        )) : (
          <View style={[
            styles.heroPhoto,
            { width: photoSize, height: photoSize, backgroundColor: colors.backgroundElement },
          ]}>
            <PhotoPlaceholder label="No catalog photo available offline" />
          </View>
        )}
      </ScrollView>

      <View style={styles.titleBlock}>
        <RarityBadge rarity={detail.rarity} />
        <Text style={[styles.title, { color: colors.text }]}>{detail.pattern.name}</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {detail.form.shape} · model {detail.form.modelNo}
        </Text>
      </View>

      {networkError && (
        <Text style={[styles.offlineNote, { color: colors.textSecondary, borderColor: colors.border }]}>
          Showing the offline catalog. Refresh unavailable: {networkError}
        </Text>
      )}

      <Section title="About this piece" colors={colors}>
        <Fact label="Production" value={years} colors={colors} />
        <Fact label="Colorway" value={detail.pattern.colorway ?? 'Not documented'} colors={colors} />
        <Fact label="Form" value={detail.form.shape} colors={colors} />
        <Fact label="Model number" value={detail.form.modelNo} colors={colors} />
        {detail.form.capacityQt !== null && (
          <Fact label="Capacity" value={`${detail.form.capacityQt} qt`} colors={colors} />
        )}
        {detail.form.dimensions && <Fact label="Dimensions" value={detail.form.dimensions} colors={colors} />}
        {detail.pattern.notes && (
          <Text style={[styles.history, { color: colors.textSecondary }]}>{detail.pattern.notes}</Text>
        )}
      </Section>

      <Section title="Current price range" colors={colors}>
        {detail.price ? (
          <>
            <Text style={[styles.price, { color: colors.text }]}>
              {money.format(detail.price.low)}–{money.format(detail.price.high)}
            </Text>
            <Text style={[styles.priceSource, { color: colors.textSecondary }]}>
              {priceSourceLabel(detail.price.source)} · {detail.price.sampleSize} {detail.price.sampleSize === 1 ? 'comparable' : 'comparables'}
            </Text>
            <Text style={[styles.body, { color: colors.textSecondary }]}>
              Median {money.format(detail.price.median)} — {priceSourceLabel(detail.price.source)}.
            </Text>
          </>
        ) : (
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            No comparable prices yet. This piece is excluded from collection totals.
          </Text>
        )}
      </Section>

      <Section title="Your collection" colors={colors}>
        <View style={[styles.segment, { backgroundColor: colors.backgroundElement }]}>
          {(['have', 'want'] as const).map((status) => {
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
              <Text style={[styles.fieldLabel, { color: colors.text }]}>Quantity</Text>
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
                <Text accessibilityLabel={`${ownership.quantity} owned`} style={[styles.quantity, { color: colors.text }]}>
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

            <Text style={[styles.fieldLabel, { color: colors.text }]}>Condition</Text>
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
                    <Text style={[styles.choiceText, { color: selected ? colors.accent : colors.textSecondary }]}>
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
            <Text style={[styles.fieldLabel, { color: colors.text }]}>Notes</Text>
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
                { color: colors.text, backgroundColor: colors.backgroundElement, borderColor: colors.border },
              ]}
            />
            <ActionButton
              label="Save notes"
              onPress={() => void saveNotes()}
              colors={colors}
              disabled={saving || notes.trim() === (ownership.notes ?? '')}
              secondary
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

      <PhotoUpload
        itemSlug={detail.slug}
        patternName={detail.pattern.name}
        visibility={visibility}
        onVisibilityChange={setVisibility}
        onUploaded={refreshRemote}
        colors={colors}
      />
    </ScrollView>
  );
}

function PhotoUpload({
  itemSlug,
  patternName,
  visibility,
  onVisibilityChange,
  onUploaded,
  colors,
}: {
  itemSlug: string;
  patternName: string;
  visibility: PhotoVisibility;
  onVisibilityChange: (visibility: PhotoVisibility) => void;
  onUploaded: () => Promise<void>;
  colors: (typeof Colors)['light'] | (typeof Colors)['dark'];
}) {
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
    <Section title="Add your photo" colors={colors}>
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
              colors={colors}
              secondary
            />
            <ActionButton
              label={cameraReady ? 'Take photo' : 'Camera starting…'}
              onPress={() => void takePhoto()}
              colors={colors}
              disabled={!cameraReady}
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
            <ActionButton label="Retake photo" onPress={() => void openCamera()} colors={colors} secondary />
            <ActionButton
              label={uploading ? 'Uploading…' : `Upload as ${visibility}`}
              onPress={() => void submitPhoto()}
              colors={colors}
              disabled={uploading}
            />
          </View>
        </View>
      )}

      {!cameraOpen && !photoUri && (
        <ActionButton label="Take a photo" onPress={() => void openCamera()} colors={colors} />
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

function Section({
  title,
  children,
  colors,
}: {
  title: string;
  children: React.ReactNode;
  colors: (typeof Colors)['light'] | (typeof Colors)['dark'];
}) {
  return (
    <View style={[styles.section, { backgroundColor: colors.surface, ...Elevation.card }]}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
      {children}
    </View>
  );
}

function Fact({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: (typeof Colors)['light'] | (typeof Colors)['dark'];
}) {
  return (
    <View style={[styles.fact, { borderBottomColor: colors.border }]}>
      <Text style={[styles.factLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.factValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  colors,
  secondary = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  colors: (typeof Colors)['light'] | (typeof Colors)['dark'];
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.actionButton,
        {
          backgroundColor: secondary
            ? pressed ? colors.backgroundSelected : colors.backgroundElement
            : pressed ? colors.have : colors.accent,
          borderColor: secondary ? colors.border : colors.accent,
        },
      ]}>
      <Text style={[styles.actionText, { color: secondary ? colors.text : colors.accentText }]}>{label}</Text>
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
    gap: Spacing.three,
  },
  backButton: {
    alignSelf: 'flex-start',
    minHeight: HitTarget,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: { ...Type.bodyStrong },
  photoStrip: { gap: Spacing.two },
  heroPhoto: { borderRadius: Radius.lg, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  photoAttribution: { position: 'absolute', top: Spacing.two, right: Spacing.two, borderRadius: Radius.pill, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one },
  photoAttributionText: { ...Type.micro },
  titleBlock: { gap: Spacing.one },
  title: { ...Type.display },
  subtitle: { ...Type.body },
  offlineNote: { ...Type.caption, borderWidth: Spacing.half, borderRadius: Radius.md, padding: Spacing.three },
  section: { borderRadius: Radius.lg, padding: Spacing.three, gap: Spacing.three },
  sectionTitle: { ...Type.headline },
  body: { ...Type.body },
  history: { ...Type.body, paddingTop: Spacing.one },
  fact: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.three, paddingBottom: Spacing.two, borderBottomWidth: Spacing.half },
  factLabel: { ...Type.callout },
  factValue: { ...Type.bodyStrong, flex: 1, textAlign: 'right' },
  price: { ...Type.title },
  priceSource: { ...Type.callout },
  segment: { flexDirection: 'row', borderRadius: Radius.md, padding: Spacing.one },
  segmentButton: { flex: 1, minHeight: HitTarget, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  segmentText: { ...Type.bodyStrong },
  fieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fieldLabel: { ...Type.bodyStrong },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: Spacing.half, borderRadius: Radius.pill },
  stepperButton: { minWidth: HitTarget, minHeight: HitTarget, alignItems: 'center', justifyContent: 'center' },
  stepperSymbol: { ...Type.headline },
  quantity: { ...Type.bodyStrong, minWidth: Spacing.four, textAlign: 'center' },
  choiceWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  choice: { minHeight: HitTarget, borderWidth: Spacing.half, borderRadius: Radius.pill, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center' },
  choiceText: { ...Type.callout, textTransform: 'capitalize' },
  notes: { ...Type.body, minHeight: Spacing.six * 2, borderWidth: Spacing.half, borderRadius: Radius.md, padding: Spacing.three, textAlignVertical: 'top' },
  removeButton: { minHeight: HitTarget, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  removeText: { ...Type.bodyStrong },
  error: { ...Type.callout },
  visibilityChoice: { minHeight: HitTarget, borderWidth: Spacing.half, borderRadius: Radius.md, padding: Spacing.three, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  visibilityCopy: { flex: 1, gap: Spacing.one },
  visibilityTitle: { ...Type.bodyStrong, textTransform: 'capitalize' },
  radioMark: { ...Type.headline },
  cameraFrame: { borderRadius: Radius.lg, overflow: 'hidden' },
  camera: { height: Spacing.six * 5 },
  cameraControls: { flexDirection: 'row', gap: Spacing.two, paddingTop: Spacing.two },
  previewBlock: { gap: Spacing.two },
  preview: { width: '100%', height: Spacing.six * 5, borderRadius: Radius.lg },
  actionButton: { flex: 1, minHeight: HitTarget, borderWidth: Spacing.half, borderRadius: Radius.pill, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center' },
  actionText: { ...Type.bodyStrong, textAlign: 'center' },
});
