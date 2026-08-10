/**
 * The scan flow: permission, viewfinder, the identification wait, the guesses, and the
 * offline fallbacks around them.
 *
 * Two visual languages meet on this screen, deliberately.
 *
 * Everything on the vellum ground — permission, the wait, results, catalog browse,
 * ownership — is the specimen index: condensed display type, metadata stacked under
 * its tile, hairline rules instead of shadows, accent held back to an outline.
 *
 * The viewfinder is the exception. It is an instrument used one-handed in a thrift
 * aisle under bad light, so it drops the restraint: an opaque deck, a fixed dark
 * palette in both schemes, and a shutter big enough to hit without looking. The line
 * runs at the shutter — everything the shutter produces goes back to the archive.
 */

import { useNetInfo } from '@react-native-community/netinfo';
import { CameraView, PermissionStatus, useCameraPermissions } from 'expo-camera';
import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { IdentifyResponse, OwnershipStatus, ScanGuess } from '@shared/types';
import { identify, logScan, submitUnknownPattern } from '@/api';
import {
  bumpScanAttempts,
  dequeueScan,
  enqueueScan,
  getSettings,
  listQueuedScans,
  searchCatalog,
  setOwnership,
  type CatalogRow,
} from '@/db';
import {
  BottomTabInset,
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
  Divider,
  Label,
  RarityBadge,
  SpecimenTile,
  useScheme,
} from '@/features/collection/collection-ui';
import { deriveLlmWasRight, shouldRetryQueueDrain } from './logic';

type ColorPalette = (typeof Colors)[keyof typeof Colors];
type Phase =
  | 'camera'
  | 'identifying'
  | 'results'
  | 'browse'
  | 'confirming'
  | 'ownership'
  | 'saved';

/**
 * The two stages the identify round trip actually performs, and nothing else. `reading`
 * covers the single await on the vision request; `matching` covers resolving the
 * returned slugs against the local catalog. Naming a stage the code does not run would
 * be theatre, which is the opposite of why staged progress is here.
 */
type IdentifyStage = 'reading' | 'matching';

// ponytail: one capture-quality knob is enough; tune it only if upload time or model detail suffers.
const CAPTURE_QUALITY = 0.8;
const QUEUE_PHOTO_DIRECTORY = 'scan-queue';

/**
 * The viewfinder keeps one fixed palette in both schemes: a camera feed is not a
 * surface that can be tinted, and a control that changes contrast with the system
 * theme is a control that disappears in half of them.
 */
const CAMERA_INK = Colors.dark.text;
const CAMERA_INK_DIM = Colors.dark.textSecondary;
const CAMERA_DECK = Colors.dark.background;
const CAMERA_RULE = Colors.dark.border;
const CAMERA_SCRIM = Colors.dark.scrim;
const CAMERA_ACCENT = Colors.dark.accent;
const CAMERA_DISABLED = Colors.dark.textTertiary;

const SHUTTER = Spacing.six + Spacing.three;
const SHUTTER_CORE = SHUTTER - Spacing.four;
const SHUTTER_SLOT = HitTarget * 2;
const THUMB = Spacing.six;
/** Big enough that the model stamp reads as a stamp rather than a cropped arc. */
const INDEX_TILE = HitTarget * 2;
const LEAD_TILE = Spacing.six * 2;

/** Confidence bands. The wording is what gets read; the percentage stays in the label. */
const STRONG_MATCH = 0.75;
const LIKELY_MATCH = 0.5;

async function persistQueuedPhotos(photoUris: string[]): Promise<string[]> {
  const directory = new Directory(Paths.document, QUEUE_PHOTO_DIRECTORY);
  directory.create({ idempotent: true, intermediates: true });
  const copied: File[] = [];
  try {
    for (const [index, uri] of photoUris.entries()) {
      const source = new File(uri);
      const destination = new File(
        directory,
        `${randomUUID()}-${index}${source.extension || '.jpg'}`,
      );
      await source.copy(destination);
      copied.push(destination);
    }
    return copied.map((file) => file.uri);
  } catch (error) {
    for (const file of copied) {
      if (file.exists) file.delete();
    }
    throw error;
  }
}

function deleteQueuedPhotos(photoUris: string[]): void {
  const directory = new Directory(Paths.document, QUEUE_PHOTO_DIRECTORY);
  for (const uri of photoUris) {
    try {
      const file = new File(uri);
      if (file.parentDirectory.uri === directory.uri && file.exists) file.delete();
    } catch {
      // Cleanup must not block confirmation or the rest of the queue.
    }
  }
}

function queueLabel(count: number): string {
  return `${count} scan${count === 1 ? '' : 's'} waiting`;
}

function confidenceLabel(confidence: number): string {
  return `About ${Math.round(confidence * 10) * 10}% confidence`;
}

function confidenceTier(confidence: number): string {
  if (confidence >= STRONG_MATCH) return 'strong match';
  if (confidence >= LIKELY_MATCH) return 'likely match';
  return 'possible match';
}

/**
 * Motion is confirmation, not decoration: the two moments worth animating are a frame
 * landing in the tray and the guesses arriving. Reduced motion skips straight to the
 * resting state rather than shortening the animation.
 */
function Rise({
  children,
  delay = 0,
  zoom = false,
  style,
}: {
  children: ReactNode;
  delay?: number;
  zoom?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      progress.value = 1;
      return;
    }
    progress.value = withDelay(
      delay,
      withTiming(1, { duration: Motion.enter, easing: Easing.bezier(...Motion.easing) }),
    );
  }, [delay, progress, reduced]);

  const animated = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: (1 - progress.value) * Motion.enterOffset },
      { scale: zoom ? Motion.pressScale + (1 - Motion.pressScale) * progress.value : 1 },
    ],
  }));

  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

/**
 * Quiet when the queue is empty — it says nothing then, so it is worth reading when it
 * says anything at all. Loud enough to answer the only question a waiting scan raises:
 * how many, and what is it waiting on.
 */
function QueueStrip({
  count,
  colors,
  offline,
  camera = false,
}: {
  count: number;
  colors: ColorPalette;
  offline: boolean;
  camera?: boolean;
}) {
  if (count === 0) return null;

  const detail = offline ? 'waiting for a connection' : 'identifying when ready';
  const ink = camera ? CAMERA_INK : colors.text;
  const dim = camera ? CAMERA_INK_DIM : colors.textSecondary;

  return (
    <View
      accessibilityLabel={`${queueLabel(count)}, ${detail}`}
      accessibilityLiveRegion="polite"
      style={[
        styles.queueStrip,
        camera
          ? { backgroundColor: CAMERA_SCRIM, borderColor: CAMERA_RULE }
          : { backgroundColor: colors.surface, borderColor: colors.border },
      ]}>
      <Text style={[styles.numeral, { color: ink }]}>{count}</Text>
      <View style={styles.queueCopy}>
        <Text style={[styles.label, { color: ink }]}>
          {count === 1 ? 'scan waiting' : 'scans waiting'}
        </Text>
        <Text style={[styles.caption, { color: dim }]}>{detail}</Text>
      </View>
    </View>
  );
}

/** The two views a burst is made of, as an index entry each. */
function FrameStrip({ photoUris, colors }: { photoUris: string[]; colors: ColorPalette }) {
  return (
    <View style={styles.framesRow}>
      {['Pattern', 'Model no.'].map((label, index) => {
        const uri = photoUris[index];
        return (
          <View key={label} style={styles.frameColumn}>
            {uri ? (
              <Image
                accessibilityLabel={`${label} photo captured`}
                accessibilityRole="image"
                source={{ uri }}
                style={[styles.frameImage, { borderColor: colors.border }]}
              />
            ) : (
              <View
                style={[
                  styles.frameImage,
                  styles.emptyFrame,
                  { backgroundColor: colors.backgroundElement, borderColor: colors.border },
                ]}>
                <Text style={[styles.label, { color: colors.textTertiary }]}>—</Text>
              </View>
            )}
            <Label tone={uri ? 'secondary' : 'tertiary'}>{label}</Label>
          </View>
        );
      })}
    </View>
  );
}

function Notice({ message, colors, error = false }: {
  message: string | null;
  colors: ColorPalette;
  error?: boolean;
}) {
  if (!message) return null;
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[
        styles.notice,
        {
          backgroundColor: colors.surface,
          borderColor: error ? colors.danger : colors.border,
        },
      ]}>
      <Text style={[styles.label, { color: error ? colors.danger : colors.textSecondary }]}>
        {error ? 'problem' : 'note'}
      </Text>
      <Text style={[styles.body, { color: colors.text }]}>{message}</Text>
    </View>
  );
}

/** Eyebrow, title, and the sentence under it — the header every archive page shares. */
function ScreenHeader({
  eyebrow,
  title,
  blurb,
  colors,
}: {
  eyebrow: string;
  title: string;
  blurb?: string;
  colors: ColorPalette;
}) {
  return (
    <View style={styles.header}>
      <Label tone="tertiary">{eyebrow}</Label>
      <Text accessibilityRole="header" style={[styles.display, { color: colors.text }]}>
        {title}
      </Text>
      {blurb ? <Text style={[styles.body, { color: colors.textSecondary }]}>{blurb}</Text> : null}
      <Divider />
    </View>
  );
}

/** Solid accent fill is ceremonial: at most one per screen. Everything else is a ghost. */
function ActionButton({
  label,
  onPress,
  colors,
  secondary = false,
  disabled = false,
  hint,
}: {
  label: string;
  onPress: () => void;
  colors: ColorPalette;
  secondary?: boolean;
  disabled?: boolean;
  hint?: string;
}) {
  // CONTRACT: Colors.light accent/accentText needs stronger text contrast; theme.ts owns the pair.
  const fill = disabled
    ? colors.backgroundElement
    : secondary
      ? 'transparent'
      : colors.accent;
  const ink = disabled ? colors.textTertiary : secondary ? colors.text : colors.accentText;

  return (
    <Pressable
      accessibilityHint={hint}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        secondary ? styles.ghostButton : styles.solidButton,
        {
          backgroundColor: pressed && !disabled ? colors.backgroundSelected : fill,
          borderColor: disabled ? colors.border : colors.accent,
        },
      ]}>
      {({ pressed }) => (
        <Text style={[styles.buttonLabel, { color: pressed && !disabled ? colors.text : ink }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

function Surface({
  children,
  colors,
  topInset,
  bottomInset,
  queuedCount,
  offline,
}: {
  children: ReactNode;
  colors: ColorPalette;
  topInset: number;
  bottomInset: number;
  queuedCount: number;
  offline: boolean;
}) {
  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.surfaceContent,
          {
            paddingTop: topInset,
            paddingBottom: bottomInset + BottomTabInset,
          },
        ]}
        keyboardShouldPersistTaps="handled">
        <QueueStrip count={queuedCount} colors={colors} offline={offline} />
        {children}
      </ScrollView>
    </View>
  );
}

/**
 * Handing over the instrument. The two frames are drawn before the camera opens, so the
 * two-shot burst is a thing the user has already seen once by the time it is asked for.
 */
function PermissionScreen({
  mode,
  colors,
  topInset,
  bottomInset,
  queuedCount,
  offline,
  onRequest,
  onSettings,
}: {
  mode: 'checking' | 'undetermined' | 'denied';
  colors: ColorPalette;
  topInset: number;
  bottomInset: number;
  queuedCount: number;
  offline: boolean;
  onRequest: () => void;
  onSettings: () => void;
}) {
  return (
    <Surface
      colors={colors}
      topInset={topInset}
      bottomInset={bottomInset}
      queuedCount={queuedCount}
      offline={offline}>
      <ScreenHeader
        eyebrow="camera"
        title="Two views, one piece"
        blurb="Photograph the pattern first, then the embossed model number underneath. Those two views let the catalog identify the exact pattern and form."
        colors={colors}
      />

      <View style={styles.plateRow}>
        {['Pattern', 'Model no.'].map((label, index) => (
          <View key={label} style={styles.plateColumn}>
            <View style={[styles.plate, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Text style={[styles.numeralLarge, { color: colors.textTertiary }]}>{index + 1}</Text>
            </View>
            <Label tone="secondary">{label}</Label>
            <Text style={[styles.caption, { color: colors.textTertiary }]}>
              {index === 0 ? 'Face up, glare off the design' : 'Underside, centred'}
            </Text>
          </View>
        ))}
      </View>

      <Divider />

      {mode === 'checking' ? (
        <View
          accessibilityLabel="Checking camera access"
          accessibilityLiveRegion="polite"
          accessibilityRole="progressbar"
          style={styles.progressRow}>
          <ActivityIndicator color={colors.accent} />
          <Text style={[styles.callout, { color: colors.textSecondary }]}>Checking camera access…</Text>
        </View>
      ) : mode === 'undetermined' ? (
        <ActionButton label="Allow camera access" onPress={onRequest} colors={colors} />
      ) : (
        <>
          <Text style={[styles.callout, { color: colors.textSecondary }]}>
            Camera access is off. Open this app’s system settings and allow Camera to scan a dish.
          </Text>
          <ActionButton label="Open app settings" onPress={onSettings} colors={colors} />
        </>
      )}
    </Surface>
  );
}

/**
 * The wait, named. Each row is work the app is doing at that moment — the request in
 * flight, then the returned slugs being matched against the saved catalog — so the
 * ledger is evidence rather than reassurance.
 */
function IdentifyLedger({
  stage,
  hasBaseShot,
  colors,
}: {
  stage: IdentifyStage;
  hasBaseShot: boolean;
  colors: ColorPalette;
}) {
  const steps: { key: IdentifyStage; label: string; detail: string }[] = [
    {
      key: 'reading',
      label: hasBaseShot ? 'Reading pattern and model no.' : 'Reading the pattern',
      detail: hasBaseShot
        ? 'Both views are with the identifier.'
        : 'The pattern view is with the identifier.',
    },
    {
      key: 'matching',
      label: 'Matching the saved catalog',
      detail: 'Turning the answer into catalogued pieces.',
    },
  ];
  const activeIndex = steps.findIndex((step) => step.key === stage);

  return (
    <View
      accessibilityLabel={steps[activeIndex]?.detail ?? ''}
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      style={styles.ledger}>
      {steps.map((step, index) => {
        const done = index < activeIndex;
        const active = index === activeIndex;
        return (
          <View key={step.key} style={styles.ledgerRow}>
            <View style={styles.ledgerMarker}>
              {active ? (
                <ActivityIndicator color={colors.accent} size="small" />
              ) : (
                <View
                  style={[
                    styles.ledgerTick,
                    done
                      ? { backgroundColor: colors.accent, borderColor: colors.accent }
                      : { borderColor: colors.border },
                  ]}
                />
              )}
            </View>
            <View style={styles.ledgerCopy}>
              <Text
                style={[
                  styles.label,
                  { color: active ? colors.text : done ? colors.textSecondary : colors.textTertiary },
                ]}>
                {step.label}
              </Text>
              {active ? (
                <Text style={[styles.caption, { color: colors.textSecondary }]}>{step.detail}</Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Confidence as a length, not a percentage: a hairline that fills, and the word for it. */
function ConfidenceMeter({ confidence, colors }: { confidence: number; colors: ColorPalette }) {
  return (
    <View style={styles.confidenceBlock}>
      <View style={[styles.confidenceTrack, { backgroundColor: colors.backgroundElement }]}>
        <View
          style={[
            styles.confidenceFill,
            { backgroundColor: colors.accent, width: `${Math.round(confidence * 100)}%` },
          ]}
        />
      </View>
      <Text style={[styles.label, { color: colors.accent }]}>{confidenceTier(confidence)}</Text>
    </View>
  );
}

/**
 * A guess as a specimen entry: the piece in its documented colors with its model number
 * struck across it, and the metadata stacked directly underneath. The top guess gets
 * the full plate and the accent outline — the one ceremonial mark on this screen.
 */
function CandidateEntry({
  guess,
  row,
  index,
  lead,
  colors,
  onPress,
}: {
  guess: ScanGuess;
  row: CatalogRow;
  index: number;
  lead: boolean;
  colors: ColorPalette;
  onPress: () => void;
}) {
  const metadata = (
    <View style={styles.entryCopy}>
      <Text style={[styles.headline, { color: colors.text }]}>{row.patternName}</Text>
      <Text style={[styles.label, { color: colors.textSecondary }]}>
        {row.shape} · {row.modelNo}
      </Text>
      <RarityBadge rarity={row.rarity} compact={!lead} />
      <ConfidenceMeter confidence={guess.confidence} colors={colors} />
      {lead ? (
        <Text style={[styles.caption, { color: colors.textSecondary }]}>{guess.reasoning}</Text>
      ) : null}
    </View>
  );

  return (
    <Pressable
      accessibilityHint="Confirms this item and records whether it was the top guess"
      accessibilityLabel={`${row.patternName}, ${row.shape}, model ${row.modelNo}, ${confidenceLabel(guess.confidence)}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.entry,
        lead ? styles.leadEntry : styles.rowEntry,
        {
          backgroundColor: pressed ? colors.backgroundSelected : colors.surface,
          borderColor: lead ? colors.accent : colors.border,
        },
      ]}>
      <View style={lead ? styles.leadRank : styles.rowRank}>
        <Text style={[styles.numeral, { color: colors.textTertiary }]}>
          {String(index + 1).padStart(2, '0')}
        </Text>
      </View>
      <SpecimenTile
        colorway={row.colorway}
        modelNo={row.modelNo}
        patternName={row.patternName}
        stampSize={lead ? 'large' : 'small'}
        style={[lead ? styles.leadTile : styles.indexTile, Elevation.object]}
      />
      {metadata}
    </Pressable>
  );
}

/** The same entry, minus the guess — catalog browse is the identical index, unsorted. */
function CatalogEntry({
  row,
  colors,
  onPress,
}: {
  row: CatalogRow;
  colors: ColorPalette;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityHint="Confirms this item as the piece you photographed"
      accessibilityLabel={`${row.patternName}, ${row.shape}, model ${row.modelNo}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.entry,
        styles.rowEntry,
        {
          backgroundColor: pressed ? colors.backgroundSelected : colors.surface,
          borderColor: colors.border,
        },
      ]}>
      <SpecimenTile
        colorway={row.colorway}
        modelNo={row.modelNo}
        patternName={row.patternName}
        stampSize="small"
        style={[styles.indexTile, Elevation.object]}
      />
      <View style={styles.entryCopy}>
        <Text style={[styles.headline, { color: colors.text }]}>{row.patternName}</Text>
        <Text style={[styles.label, { color: colors.textSecondary }]}>
          {row.shape} · {row.modelNo}
        </Text>
        <RarityBadge rarity={row.rarity} compact />
      </View>
    </Pressable>
  );
}

export default function ScanScreen() {
  const scheme = useScheme();
  const colors = Colors[scheme];
  const insets = useSafeAreaInsets();
  const netInfo = useNetInfo();
  const [permission, requestPermission, refreshPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const drainingRef = useRef(false);
  const presentedQueuedIdRef = useRef<string | null>(null);
  const cameraIdleRef = useRef(true);

  const [phase, setPhase] = useState<Phase>('camera');
  const [cameraReady, setCameraReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [photoUris, setPhotoUris] = useState<string[]>([]);
  const [guesses, setGuesses] = useState<ScanGuess[]>([]);
  const [guessRows, setGuessRows] = useState<CatalogRow[]>([]);
  const [queuedCount, setQueuedCount] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState('Comparing both views with the saved catalog…');
  // Held apart from `phase` on purpose: a background queue drain runs the matching stage
  // while the user is still on the viewfinder, and must not pull them off it.
  const [stage, setStage] = useState<IdentifyStage | null>(null);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogRows, setCatalogRows] = useState<CatalogRow[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [unknownPatternName, setUnknownPatternName] = useState('');
  const [confirmedSlug, setConfirmedSlug] = useState('');
  const [confirmedPatternName, setConfirmedPatternName] = useState('');
  const [confirmedForm, setConfirmedForm] = useState('');
  const [ownershipStatus, setOwnershipStatus] = useState<OwnershipStatus>('have');
  const [quantity, setQuantity] = useState(1);
  const [savingOwnership, setSavingOwnership] = useState(false);

  const isOffline = netInfo.isConnected === false || netInfo.isInternetReachable === false;
  const canDrainQueue = netInfo.isConnected === true && netInfo.isInternetReachable !== false;
  const needsBaseShot = photoUris.length === 1;
  const cameraIdle = phase === 'camera' && photoUris.length === 0 && !capturing;
  cameraIdleRef.current = cameraIdle;
  const safeTop = insets.top + Spacing.three;
  const safeBottom = insets.bottom + BottomTabInset + Spacing.three;
  const surfaceBottom = insets.bottom + Spacing.three;

  const refreshQueuedCount = useCallback(async () => {
    const count = (await listQueuedScans()).length;
    setQueuedCount(Math.max(0, count - (presentedQueuedIdRef.current ? 1 : 0)));
  }, []);

  const presentIdentifyResponse = useCallback(async (
    response: IdentifyResponse,
    queuedPhotoUris: string[],
  ) => {
    setPhotoUris(queuedPhotoUris);
    setGuesses(response.guesses);
    setError(null);
    setStage('matching');
    if (response.lowConfidence || response.guesses.length === 0) {
      setCatalogQuery('');
      setStage(null);
      setPhase('browse');
      return;
    }

    // CONTRACT: app bootstrap must seed or sync the local catalog before this screen mounts.
    const catalog = await searchCatalog('', Number.MAX_SAFE_INTEGER);
    const resolved = response.guesses
      .slice(0, 3)
      .map((guess) => catalog.find((row) => row.slug === guess.itemSlug))
      .filter((row): row is CatalogRow => Boolean(row));
    if (resolved.length === 0) {
      setCatalogQuery('');
      setStage(null);
      setPhase('browse');
      return;
    }
    setGuessRows(resolved);
    setStage(null);
    setPhase('results');
  }, []);

  const drainQueue = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    try {
      const queued = await listQueuedScans();
      for (const scan of queued) {
        try {
          const result = await identify(scan.photos, scan.hasBaseShot);
          if (result.ok) {
            if (!cameraIdleRef.current) break;
            await presentIdentifyResponse(result.data, scan.photos);
            presentedQueuedIdRef.current = scan.localId;
            break;
          }
          if (shouldRetryQueueDrain(result.code, scan.attempts)) {
            await bumpScanAttempts(scan.localId);
            break;
          }
          await dequeueScan(scan.localId);
          deleteQueuedPhotos(scan.photos);
          setNotice('A saved scan could not be identified. Please photograph it again.');
        } catch {
          if (shouldRetryQueueDrain('internal', scan.attempts)) {
            await bumpScanAttempts(scan.localId);
            break;
          }
          await dequeueScan(scan.localId);
          deleteQueuedPhotos(scan.photos);
          setNotice('A saved scan could not be identified. Please photograph it again.');
        }
      }
    } finally {
      drainingRef.current = false;
      try {
        await refreshQueuedCount();
      } catch {
        // A later connectivity or screen-state change retries the count refresh.
      }
    }
  }, [presentIdentifyResponse, refreshQueuedCount]);

  useEffect(() => {
    void refreshQueuedCount();
  }, [refreshQueuedCount]);

  useEffect(() => {
    if (canDrainQueue && cameraIdle) void drainQueue();
  }, [cameraIdle, canDrainQueue, drainQueue]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshPermission();
    });
    return () => subscription.remove();
  }, [refreshPermission]);

  useEffect(() => {
    if (phase !== 'browse') return;
    let ignore = false;
    setCatalogLoading(true);
    void searchCatalog(catalogQuery)
      .then((rows) => {
        if (!ignore) setCatalogRows(rows);
      })
      .catch(() => {
        if (!ignore) setError('The saved catalog could not be opened.');
      })
      .finally(() => {
        if (!ignore) setCatalogLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [catalogQuery, phase]);

  const resetScan = () => {
    setPhase('camera');
    setCameraReady(false);
    setCapturing(false);
    setPhotoUris([]);
    setGuesses([]);
    setGuessRows([]);
    setNotice(null);
    setError(null);
    setStage(null);
    setCatalogQuery('');
    setUnknownPatternName('');
    setConfirmedSlug('');
    setConfirmedPatternName('');
    setConfirmedForm('');
    setOwnershipStatus('have');
    setQuantity(1);
  };

  const queueBurst = async (uris: string[], hasBaseShot: boolean) => {
    setStage(null);
    setProgressMessage('Saving this scan on your phone…');
    setPhase('identifying');
    let queuedPhotoUris: string[] = [];
    try {
      queuedPhotoUris = await persistQueuedPhotos(uris);
      await enqueueScan(queuedPhotoUris, hasBaseShot);
    } catch {
      deleteQueuedPhotos(queuedPhotoUris);
      setPhase('camera');
      setError('This scan could not be saved. Keep the photos and try again.');
      return;
    }
    try {
      await refreshQueuedCount();
    } catch {
      setQueuedCount((current) => current + 1);
    }
    resetScan();
    setNotice('Saved offline. It will identify when your connection returns.');
  };

  const identifyBurst = async (uris: string[], hasBaseShot: boolean) => {
    if (isOffline) {
      await queueBurst(uris, hasBaseShot);
      return;
    }

    setProgressMessage(
      hasBaseShot
        ? 'Reading the pattern and embossed model number…'
        : 'Comparing the pattern with the saved catalog…',
    );
    setStage('reading');
    setPhase('identifying');
    setError(null);
    try {
      const result = await identify(uris, hasBaseShot);
      if (result.ok) {
        await presentIdentifyResponse(result.data, uris);
      } else if (shouldRetryQueueDrain(result.code, 0)) {
        await queueBurst(uris, hasBaseShot);
      } else {
        setStage(null);
        setPhase('camera');
        setError(result.error);
      }
    } catch {
      setStage(null);
      setPhase('camera');
      setError('The photo could not be read. Please capture it again.');
    }
  };

  const captureFrame = async () => {
    if (!cameraRef.current || !cameraReady || capturing) return;
    cameraIdleRef.current = false;
    setCapturing(true);
    setError(null);
    try {
      const picture = await cameraRef.current.takePictureAsync({
        base64: false,
        exif: false,
        quality: CAPTURE_QUALITY,
        skipProcessing: false,
      });
      if (needsBaseShot) {
        const burst = [...photoUris, picture.uri];
        setPhotoUris(burst);
        await identifyBurst(burst, true);
      } else {
        setPhotoUris([picture.uri]);
      }
    } catch {
      setError('The camera did not save that frame. Please try again.');
    } finally {
      setCapturing(false);
    }
  };

  const confirmItem = async (slug: string, patternName: string, form: string) => {
    setConfirmedSlug(slug);
    setConfirmedPatternName(patternName);
    setConfirmedForm(form);
    setStage(null);
    setProgressMessage('Saving your confirmation and correction…');
    setPhase('confirming');
    setError(null);
    try {
      const settings = await getSettings();
      // CONTRACT: api.ts must encode consented photoUris, and db.ts needs a pending-log queue
      // so offline confirmations and their llmWasRight labels survive a failed request.
      const result = await logScan({
        photoUris,
        guesses,
        confirmedItemSlug: slug,
        llmWasRight: deriveLlmWasRight(guesses, slug),
        consentedToTraining: settings.trainingOptIn,
      });
      if (!result.ok) {
        setNotice('Confirmed locally. The scan history could not sync.');
      }
    } catch {
      setNotice('Confirmed locally. The scan history could not sync.');
    } finally {
      const queuedId = presentedQueuedIdRef.current;
      if (queuedId) {
        try {
          await dequeueScan(queuedId);
          deleteQueuedPhotos(photoUris);
          presentedQueuedIdRef.current = null;
          try {
            await refreshQueuedCount();
          } catch {
            // The displayed count is already correct; refresh on the next queue event.
          }
        } catch {
          setNotice('Confirmed locally. The saved scan will finish cleaning up later.');
        }
      }
      setPhase('ownership');
    }
  };

  const submitUnknown = async () => {
    const patternName = unknownPatternName.trim();
    if (!patternName) {
      setError('Enter the pattern name you use for this piece.');
      return;
    }
    if (isOffline) {
      setError('Submitting a new pattern needs a connection. Catalog browsing still works offline.');
      return;
    }

    setStage(null);
    setProgressMessage('Creating the new catalog entry…');
    setPhase('confirming');
    setError(null);
    try {
      const settings = await getSettings();
      // CONTRACT: api.ts must encode photoUri before sending it to the backend.
      const result = await submitUnknownPattern({
        patternName,
        formId: null,
        description: patternName,
        photoUri: photoUris[0] ?? null,
        visibility: settings.defaultPhotoVisibility,
      });
      if (!result.ok) {
        setPhase('browse');
        setError(result.error);
        return;
      }
      await confirmItem(result.data.slug, patternName, 'Form not yet catalogued');
    } catch {
      setPhase('browse');
      setError('The new pattern could not be submitted.');
    }
  };

  const saveOwnership = async () => {
    setSavingOwnership(true);
    setError(null);
    try {
      await setOwnership(confirmedSlug, ownershipStatus, quantity);
      setPhase('saved');
    } catch {
      setError('This item could not be added to your collection.');
    } finally {
      setSavingOwnership(false);
    }
  };

  if (!permission) {
    return (
      <PermissionScreen
        mode="checking"
        colors={colors}
        topInset={safeTop}
        bottomInset={surfaceBottom}
        queuedCount={queuedCount}
        offline={isOffline}
        onRequest={() => {}}
        onSettings={() => {}}
      />
    );
  }

  if (permission.status === PermissionStatus.UNDETERMINED) {
    return (
      <PermissionScreen
        mode="undetermined"
        colors={colors}
        topInset={safeTop}
        bottomInset={surfaceBottom}
        queuedCount={queuedCount}
        offline={isOffline}
        onRequest={() => void requestPermission()}
        onSettings={() => {}}
      />
    );
  }

  if (!permission.granted) {
    return (
      <PermissionScreen
        mode="denied"
        colors={colors}
        topInset={safeTop}
        bottomInset={surfaceBottom}
        queuedCount={queuedCount}
        offline={isOffline}
        onRequest={() => {}}
        onSettings={() => void Linking.openSettings()}
      />
    );
  }

  if (phase === 'camera') {
    const shutterBusy = capturing || !cameraReady;
    const shutterCore = shutterBusy
      ? CAMERA_DISABLED
      : needsBaseShot
        ? CAMERA_ACCENT
        : CAMERA_INK;

    return (
      <View style={[styles.screen, { backgroundColor: CAMERA_DECK }]}>
        <CameraView
          accessible={false}
          facing="back"
          onCameraReady={() => setCameraReady(true)}
          onMountError={({ message }) => setError(message)}
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
        />
        <ScrollView
          contentContainerStyle={styles.cameraOverlayContent}
          showsVerticalScrollIndicator={false}
          style={StyleSheet.absoluteFill}>
          <View pointerEvents="box-none" style={[styles.cameraTop, { paddingTop: safeTop }]}>
            <QueueStrip count={queuedCount} colors={colors} offline={isOffline} camera />
            <View style={[styles.cameraPrompt, { backgroundColor: CAMERA_SCRIM, borderColor: CAMERA_RULE }]}>
              <Text style={[styles.label, { color: needsBaseShot ? CAMERA_ACCENT : CAMERA_INK_DIM }]}>
                {needsBaseShot ? 'Shot 2 of 2 · underside' : 'Shot 1 of 2 · pattern'}
              </Text>
              <Text accessibilityRole="header" style={[styles.title, { color: CAMERA_INK }]}>
                {needsBaseShot ? 'Now flip it over' : 'Start with the pattern'}
              </Text>
              <Text style={[styles.callout, { color: CAMERA_INK }]}>
                {needsBaseShot
                  ? 'Center the embossed model number on the underside. It is usually the strongest identification clue.'
                  : 'Fill the frame with the printed pattern and keep glare away from the design.'}
              </Text>
            </View>
          </View>

          {/* The aiming square. It turns accent the moment the second shot is the one being asked for. */}
          <View pointerEvents="none" style={styles.reticleWrap}>
            <View style={styles.reticle}>
              {['topLeft', 'topRight', 'bottomLeft', 'bottomRight'].map((corner) => (
                <View
                  key={corner}
                  style={[
                    styles.reticleCorner,
                    styles[corner as 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'],
                    { borderColor: needsBaseShot ? CAMERA_ACCENT : CAMERA_INK },
                  ]}
                />
              ))}
            </View>
          </View>

          <View
            pointerEvents="box-none"
            style={[
              styles.cameraDeck,
              Elevation.sheet,
              { backgroundColor: CAMERA_DECK, borderTopColor: CAMERA_RULE, paddingBottom: safeBottom },
            ]}>
            {notice ? (
              <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.cameraNotice}>
                <Text style={[styles.callout, { color: CAMERA_INK }]}>{notice}</Text>
              </View>
            ) : null}
            {error ? (
              <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.cameraNotice}>
                <Text style={[styles.callout, { color: Colors.dark.danger }]}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.shutterRow}>
              <View style={styles.shutterSlot}>
                {photoUris[0] ? (
                  <Rise zoom style={styles.thumbWrap}>
                    <Image
                      accessibilityLabel="Pattern photo captured"
                      accessibilityRole="image"
                      source={{ uri: photoUris[0] }}
                      style={[styles.thumb, { borderColor: CAMERA_ACCENT }]}
                    />
                    <Text style={[styles.label, { color: CAMERA_ACCENT }]}>kept</Text>
                  </Rise>
                ) : null}
              </View>

              <Pressable
                accessibilityLabel={needsBaseShot ? 'Capture base model number' : 'Capture pattern'}
                accessibilityRole="button"
                accessibilityState={{ disabled: shutterBusy }}
                disabled={shutterBusy}
                onPress={() => void captureFrame()}
                style={({ pressed }) => [
                  styles.shutter,
                  {
                    borderColor: shutterBusy ? CAMERA_DISABLED : CAMERA_INK,
                    transform: [{ scale: pressed ? Motion.pressScale : 1 }],
                  },
                ]}>
                <View style={[styles.shutterCore, { backgroundColor: shutterCore }]} />
              </Pressable>

              <View style={styles.shutterSlot}>
                {needsBaseShot ? (
                  <Pressable
                    accessibilityHint="Identifies from the pattern photo alone"
                    accessibilityLabel="Skip the base shot"
                    accessibilityRole="button"
                    onPress={() => void identifyBurst(photoUris, false)}
                    style={({ pressed }) => [
                      styles.cameraGhostButton,
                      {
                        backgroundColor: pressed ? CAMERA_RULE : 'transparent',
                        borderColor: CAMERA_INK_DIM,
                      },
                    ]}>
                    <Text style={[styles.buttonLabel, { color: CAMERA_INK }]}>Skip</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

            <Text accessibilityLiveRegion="polite" style={[styles.label, { color: CAMERA_INK_DIM }]}>
              {capturing ? 'Saving frame…' : needsBaseShot ? 'Capture the underside' : 'Capture the pattern'}
            </Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  if (phase === 'identifying' || phase === 'confirming') {
    return (
      <Surface
        colors={colors}
        topInset={safeTop}
        bottomInset={surfaceBottom}
        queuedCount={queuedCount}
        offline={isOffline}>
        <ScreenHeader
          eyebrow={phase === 'identifying' ? 'in progress' : 'confirming'}
          title={phase === 'identifying' ? 'Identifying your piece' : 'Saving your choice'}
          colors={colors}
        />
        {stage ? (
          <IdentifyLedger stage={stage} hasBaseShot={photoUris.length > 1} colors={colors} />
        ) : (
          <View
            accessibilityLabel={progressMessage}
            accessibilityLiveRegion="polite"
            accessibilityRole="progressbar"
            style={styles.progressRow}>
            <ActivityIndicator color={colors.accent} />
            <Text style={[styles.callout, { color: colors.textSecondary }]}>{progressMessage}</Text>
          </View>
        )}
        {phase === 'identifying' ? <FrameStrip photoUris={photoUris} colors={colors} /> : null}
      </Surface>
    );
  }

  if (phase === 'results') {
    const candidates = guesses
      .slice(0, 3)
      .map((guess) => ({ guess, row: guessRows.find((row) => row.slug === guess.itemSlug) }))
      .filter((candidate): candidate is { guess: ScanGuess; row: CatalogRow } => Boolean(candidate.row));
    return (
      <Surface
        colors={colors}
        topInset={safeTop}
        bottomInset={surfaceBottom}
        queuedCount={queuedCount}
        offline={isOffline}>
        <ScreenHeader
          eyebrow={`${candidates.length} ${candidates.length === 1 ? 'match' : 'matches'}`}
          title="Best matches"
          blurb="Tap the exact pattern and form to confirm it."
          colors={colors}
        />
        <Notice message={notice} colors={colors} />
        <Notice message={error} colors={colors} error />
        <View style={styles.stack}>
          {candidates.map(({ guess, row }, index) => (
            <Rise key={row.slug} delay={index * (Motion.press / 2)}>
              <CandidateEntry
                guess={guess}
                row={row}
                index={index}
                lead={index === 0}
                colors={colors}
                onPress={() => void confirmItem(row.slug, row.patternName, `${row.shape} · ${row.modelNo}`)}
              />
            </Rise>
          ))}
        </View>
        <Divider />
        <ActionButton
          label="None of these"
          hint="Opens the saved catalog so you can find the piece yourself"
          onPress={() => {
            setCatalogQuery('');
            setError(null);
            setPhase('browse');
          }}
          colors={colors}
          secondary
        />
      </Surface>
    );
  }

  if (phase === 'browse') {
    return (
      <Surface
        colors={colors}
        topInset={safeTop}
        bottomInset={surfaceBottom}
        queuedCount={queuedCount}
        offline={isOffline}>
        <ScreenHeader
          eyebrow="saved catalog"
          title="Find the right piece"
          blurb="The saved catalog works without a connection. Search by pattern, shape, or model number."
          colors={colors}
        />
        <Notice message={notice} colors={colors} />
        <Notice message={error} colors={colors} error />
        <TextInput
          accessibilityLabel="Search the saved catalog"
          accessibilityRole="search"
          autoCapitalize="words"
          onChangeText={setCatalogQuery}
          placeholder="Butterprint, casserole, 444…"
          placeholderTextColor={colors.textTertiary}
          returnKeyType="search"
          style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
          value={catalogQuery}
        />
        {catalogLoading ? (
          <View
            accessibilityLabel="Searching the saved catalog"
            accessibilityLiveRegion="polite"
            accessibilityRole="progressbar"
            style={styles.progressRow}>
            <ActivityIndicator color={colors.accent} />
            <Text style={[styles.callout, { color: colors.textSecondary }]}>Searching the saved catalog…</Text>
          </View>
        ) : (
          <View style={styles.stack}>
            <Label tone="tertiary">
              {catalogRows.length} {catalogRows.length === 1 ? 'entry' : 'entries'}
            </Label>
            {catalogRows.map((row) => (
              <CatalogEntry
                key={row.slug}
                row={row}
                colors={colors}
                onPress={() => void confirmItem(row.slug, row.patternName, `${row.shape} · ${row.modelNo}`)}
              />
            ))}
            {catalogRows.length === 0 ? (
              <Text style={[styles.callout, { color: colors.textSecondary }]}>No saved catalog items match that search.</Text>
            ) : null}
          </View>
        )}

        <Divider />

        <View style={[styles.slab, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Label tone="tertiary">not catalogued</Label>
          <Text accessibilityRole="header" style={[styles.headline, { color: colors.text }]}>
            Name it yourself
          </Text>
          <Text style={[styles.callout, { color: colors.textSecondary }]}>
            Name it in your own words. A connection is required to create the catalog entry.
          </Text>
          <TextInput
            accessibilityLabel="Name the unknown pattern"
            accessibilityRole="text"
            autoCapitalize="words"
            onChangeText={setUnknownPatternName}
            placeholder="Pattern name"
            placeholderTextColor={colors.textTertiary}
            returnKeyType="done"
            style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
            value={unknownPatternName}
          />
          <ActionButton
            label={isOffline ? 'Connect to submit new pattern' : 'Submit new pattern'}
            onPress={() => void submitUnknown()}
            colors={colors}
            disabled={isOffline}
          />
        </View>
      </Surface>
    );
  }

  if (phase === 'ownership') {
    return (
      <Surface
        colors={colors}
        topInset={safeTop}
        bottomInset={surfaceBottom}
        queuedCount={queuedCount}
        offline={isOffline}>
        <ScreenHeader eyebrow="confirmed" title={confirmedPatternName} colors={colors} />
        <Text style={[styles.label, { color: colors.textSecondary }]}>{confirmedForm}</Text>
        <Notice message={notice} colors={colors} />
        <Notice message={error} colors={colors} error />
        <View style={[styles.slab, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text accessibilityRole="header" style={[styles.headline, { color: colors.text }]}>
            Add it to your collection
          </Text>
          <View accessibilityRole="radiogroup" style={styles.toggleRow}>
            {(['have', 'want'] as const).map((status) => {
              const selected = ownershipStatus === status;
              return (
                <Pressable
                  accessibilityLabel={status === 'have' ? 'Mark as owned' : 'Mark as wanted'}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  key={status}
                  onPress={() => setOwnershipStatus(status)}
                  style={({ pressed }) => [
                    styles.toggleButton,
                    {
                      backgroundColor: pressed ? colors.backgroundSelected : colors.background,
                      borderColor: selected ? colors.accent : colors.border,
                    },
                  ]}>
                  {/* Selection carries a filled mark as well as a hue, so it survives color blindness. */}
                  {selected ? (
                    <View style={[styles.selectedMark, { backgroundColor: colors.accent }]} />
                  ) : null}
                  <Text style={[styles.buttonLabel, { color: selected ? colors.accent : colors.textSecondary }]}>
                    {status === 'have' ? 'Have' : 'Want'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {ownershipStatus === 'have' ? (
            <View style={styles.quantityRow}>
              <Label tone="secondary">quantity</Label>
              <View style={styles.stepper}>
                <Pressable
                  accessibilityLabel="Decrease quantity"
                  accessibilityRole="button"
                  accessibilityState={{ disabled: quantity === 1 }}
                  disabled={quantity === 1}
                  onPress={() => setQuantity((current) => Math.max(1, current - 1))}
                  style={({ pressed }) => [
                    styles.stepperButton,
                    {
                      backgroundColor: pressed ? colors.backgroundSelected : colors.background,
                      borderColor: colors.border,
                    },
                  ]}>
                  <Text style={[styles.numeral, { color: quantity === 1 ? colors.textTertiary : colors.text }]}>−</Text>
                </Pressable>
                <Text
                  accessibilityLabel={`Quantity ${quantity}`}
                  style={[styles.numeralLarge, styles.quantityValue, { color: colors.text }]}>
                  {quantity}
                </Text>
                <Pressable
                  accessibilityLabel="Increase quantity"
                  accessibilityRole="button"
                  onPress={() => setQuantity((current) => current + 1)}
                  style={({ pressed }) => [
                    styles.stepperButton,
                    {
                      backgroundColor: pressed ? colors.backgroundSelected : colors.background,
                      borderColor: colors.border,
                    },
                  ]}>
                  <Text style={[styles.numeral, { color: colors.text }]}>+</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Text style={[styles.callout, { color: colors.textSecondary }]}>Want-list items do not need a quantity.</Text>
          )}
          <ActionButton
            label={savingOwnership ? 'Saving to collection…' : 'Save to collection'}
            onPress={() => void saveOwnership()}
            colors={colors}
            disabled={savingOwnership}
          />
        </View>
      </Surface>
    );
  }

  return (
    <Surface
      colors={colors}
      topInset={safeTop}
      bottomInset={surfaceBottom}
      queuedCount={queuedCount}
      offline={isOffline}>
      <ScreenHeader eyebrow="saved" title={confirmedPatternName} colors={colors} />
      <Text style={[styles.body, { color: colors.textSecondary }]}>
        Now on your {ownershipStatus === 'have' ? 'shelf' : 'want list'}.
      </Text>
      <ActionButton label="Scan another piece" onPress={resetScan} colors={colors} />
    </Surface>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  surfaceContent: {
    alignSelf: 'center',
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.three,
    width: '100%',
  },

  // --- type roles. Display face for titles, labels and numerals; system face for prose.
  display: { ...Type.display },
  title: { ...Type.title },
  headline: { ...Type.headline },
  label: { ...Type.label },
  numeral: { ...Type.numeral },
  numeralLarge: { ...Type.numeralLarge },
  body: { ...Type.body },
  callout: { ...Type.callout },
  caption: { ...Type.caption },
  buttonLabel: { ...Type.label, textAlign: 'center' },

  header: { gap: Spacing.two },

  actionButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: HitTarget,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  /** The single ceremonial fill. Pill is reserved for it. */
  solidButton: { borderRadius: Radius.pill },
  ghostButton: { borderRadius: Radius.sm, borderWidth: Rule },

  queueStrip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: Radius.sm,
    borderWidth: Rule,
    flexDirection: 'row',
    gap: Spacing.two,
    minHeight: HitTarget,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  queueCopy: { gap: Spacing.half },

  framesRow: { flexDirection: 'row', gap: Spacing.three },
  frameColumn: { gap: Spacing.one },
  frameImage: {
    borderRadius: Radius.xs,
    borderWidth: Rule,
    height: Spacing.six,
    width: Spacing.six,
  },
  emptyFrame: { alignItems: 'center', justifyContent: 'center' },

  notice: {
    borderRadius: Radius.sm,
    borderWidth: Rule,
    gap: Spacing.one,
    padding: Spacing.three,
  },

  plateRow: { flexDirection: 'row', gap: Spacing.three },
  plateColumn: { flex: 1, gap: Spacing.two },
  plate: {
    alignItems: 'center',
    aspectRatio: 1,
    borderRadius: Radius.sm,
    borderWidth: Rule,
    justifyContent: 'center',
  },

  progressRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.two,
    minHeight: HitTarget,
  },

  ledger: { gap: Spacing.three },
  ledgerRow: { flexDirection: 'row', gap: Spacing.three },
  ledgerMarker: {
    alignItems: 'center',
    justifyContent: 'center',
    width: Spacing.four,
  },
  ledgerTick: {
    borderRadius: Radius.xs,
    borderWidth: Rule,
    height: Spacing.two,
    width: Spacing.two,
  },
  ledgerCopy: { flex: 1, gap: Spacing.half },

  confidenceBlock: { gap: Spacing.half, paddingTop: Spacing.half },
  confidenceTrack: {
    borderRadius: Radius.xs,
    height: Spacing.half,
    overflow: 'hidden',
    width: '100%',
  },
  confidenceFill: { height: '100%' },

  stack: { gap: Spacing.two },

  entry: {
    borderWidth: Rule,
    minHeight: HitTarget,
  },
  leadEntry: {
    borderRadius: Radius.lg,
    gap: Spacing.two,
    padding: Spacing.three,
  },
  rowEntry: {
    alignItems: 'flex-start',
    borderRadius: Radius.sm,
    flexDirection: 'row',
    gap: Spacing.three,
    padding: Spacing.two,
  },
  leadRank: { position: 'absolute', right: Spacing.three, top: Spacing.three, zIndex: 1 },
  rowRank: { minWidth: Spacing.four },
  leadTile: { height: LEAD_TILE, width: '100%' },
  indexTile: { height: INDEX_TILE, width: INDEX_TILE },
  entryCopy: { flex: 1, gap: Spacing.one },

  input: {
    ...Type.body,
    borderRadius: Radius.sm,
    borderWidth: Rule,
    minHeight: HitTarget,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },

  slab: {
    borderRadius: Radius.lg,
    borderWidth: Rule,
    gap: Spacing.three,
    padding: Spacing.three,
  },

  toggleRow: { flexDirection: 'row', gap: Spacing.two },
  toggleButton: {
    alignItems: 'center',
    borderRadius: Radius.sm,
    borderWidth: Rule,
    flex: 1,
    flexDirection: 'row',
    gap: Spacing.two,
    justifyContent: 'center',
    minHeight: HitTarget,
    paddingHorizontal: Spacing.three,
  },
  selectedMark: {
    borderRadius: Radius.xs,
    height: Spacing.two,
    width: Spacing.two,
  },
  quantityRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  stepper: { alignItems: 'center', flexDirection: 'row', gap: Spacing.two },
  stepperButton: {
    alignItems: 'center',
    borderRadius: Radius.sm,
    borderWidth: Rule,
    height: HitTarget,
    justifyContent: 'center',
    width: HitTarget,
  },
  quantityValue: { minWidth: HitTarget, textAlign: 'center' },

  // --- the instrument. Bold on purpose; the archive resumes after the shutter.
  cameraOverlayContent: {
    flexGrow: 1,
    justifyContent: 'space-between',
  },
  cameraTop: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  cameraPrompt: {
    alignSelf: 'stretch',
    borderRadius: Radius.sm,
    borderWidth: Rule,
    gap: Spacing.two,
    padding: Spacing.three,
  },
  reticleWrap: {
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: Spacing.four,
  },
  reticle: {
    aspectRatio: 1,
    maxWidth: MaxContentWidth / 2,
    width: '66%',
  },
  reticleCorner: {
    height: Spacing.four,
    position: 'absolute',
    width: Spacing.four,
  },
  topLeft: { borderLeftWidth: Spacing.half, borderTopWidth: Spacing.half, left: 0, top: 0 },
  topRight: { borderRightWidth: Spacing.half, borderTopWidth: Spacing.half, right: 0, top: 0 },
  bottomLeft: { borderBottomWidth: Spacing.half, borderLeftWidth: Spacing.half, bottom: 0, left: 0 },
  bottomRight: { borderBottomWidth: Spacing.half, borderRightWidth: Spacing.half, bottom: 0, right: 0 },
  cameraDeck: {
    alignItems: 'center',
    borderTopWidth: Rule,
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
  },
  cameraNotice: {
    alignSelf: 'stretch',
    paddingBottom: Spacing.two,
  },
  shutterRow: {
    alignItems: 'center',
    alignSelf: 'stretch',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  shutterSlot: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: HitTarget,
    width: SHUTTER_SLOT,
  },
  shutter: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    borderWidth: Spacing.one,
    height: SHUTTER,
    justifyContent: 'center',
    width: SHUTTER,
  },
  shutterCore: {
    borderRadius: Radius.pill,
    height: SHUTTER_CORE,
    width: SHUTTER_CORE,
  },
  thumbWrap: { alignItems: 'center', gap: Spacing.half },
  thumb: {
    borderRadius: Radius.xs,
    borderWidth: Rule,
    height: THUMB,
    width: THUMB,
  },
  cameraGhostButton: {
    alignItems: 'center',
    borderRadius: Radius.sm,
    borderWidth: Rule,
    justifyContent: 'center',
    minHeight: HitTarget,
    paddingHorizontal: Spacing.three,
  },
});
