import { useNetInfo } from '@react-native-community/netinfo';
import { CameraView, PermissionStatus, useCameraPermissions } from 'expo-camera';
import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
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
  useColorScheme,
} from 'react-native';
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
  Fonts,
  HitTarget,
  MaxContentWidth,
  Radius,
  Spacing,
  Type,
} from '@/constants/theme';
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

// ponytail: one capture-quality knob is enough; tune it only if upload time or model detail suffers.
const CAPTURE_QUALITY = 0.8;
const CAMERA_TEXT = Colors.dark.text;
const QUEUE_PHOTO_DIRECTORY = 'scan-queue';

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
  if (count === 0) return 'No scans waiting';
  return `${count} scan${count === 1 ? '' : 's'} waiting`;
}

function confidenceLabel(confidence: number): string {
  return `About ${Math.round(confidence * 10) * 10}% confidence`;
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
  colors: ColorPalette;
  secondary?: boolean;
  disabled?: boolean;
}) {
  const backgroundColor = disabled
    ? colors.backgroundSelected
    : secondary
      ? colors.backgroundElement
      : colors.accent;
  const color = disabled
    ? colors.textTertiary
    : secondary
      ? colors.text
      : colors.accentText;
  // CONTRACT: Colors.light accent/accentText needs stronger text contrast; theme.ts owns the pair.

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        { backgroundColor: pressed && !disabled ? colors.backgroundSelected : backgroundColor },
      ]}>
      {({ pressed }) => (
        <Text style={[styles.buttonText, { color: pressed && !disabled ? colors.text : color }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

function QueueBadge({ count, colors, camera = false }: {
  count: number;
  colors: ColorPalette;
  camera?: boolean;
}) {
  return (
    <View
      accessibilityLabel={queueLabel(count)}
      style={[
        styles.queueBadge,
        { backgroundColor: camera ? colors.scrim : colors.backgroundElement },
      ]}>
      {camera ? <View pointerEvents="none" style={[styles.scrimLayer, { backgroundColor: colors.scrim }]} /> : null}
      <Text style={[styles.microText, { color: camera ? CAMERA_TEXT : colors.textSecondary }]}>
        {queueLabel(count)}
      </Text>
    </View>
  );
}

function CapturedFrames({
  photoUris,
  colors,
  camera = false,
}: {
  photoUris: string[];
  colors: ColorPalette;
  camera?: boolean;
}) {
  const frameColor = camera ? CAMERA_TEXT : colors.text;
  const frameBackground = camera ? colors.scrim : colors.backgroundElement;
  return (
    <View style={styles.framesRow}>
      {['Pattern', 'Base'].map((label, index) => {
        const uri = photoUris[index];
        return (
          <View key={label} style={styles.frameColumn}>
            {uri ? (
              <Image
                accessibilityLabel={`${label} photo captured`}
                accessibilityRole="image"
                source={{ uri }}
                style={[styles.frameImage, { borderColor: frameColor }]}
              />
            ) : (
              <View
                style={[
                  styles.frameImage,
                  styles.emptyFrame,
                  { backgroundColor: frameBackground, borderColor: frameColor },
                ]}>
                <Text style={[styles.captionText, { color: frameColor }]}>Next</Text>
              </View>
            )}
            <Text style={[styles.captionText, { color: frameColor }]}>
              {label} {uri ? 'captured' : ''}
            </Text>
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
          backgroundColor: colors.backgroundElement,
          borderColor: error ? colors.danger : colors.border,
        },
      ]}>
      <Text style={[styles.calloutText, { color: error ? colors.danger : colors.text }]}>
        {message}
      </Text>
    </View>
  );
}

function Surface({
  children,
  colors,
  topInset,
  bottomInset,
  queuedCount,
}: {
  children: ReactNode;
  colors: ColorPalette;
  topInset: number;
  bottomInset: number;
  queuedCount: number;
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
        <QueueBadge count={queuedCount} colors={colors} />
        {children}
      </ScrollView>
    </View>
  );
}

function PermissionScreen({
  mode,
  colors,
  topInset,
  bottomInset,
  queuedCount,
  onRequest,
  onSettings,
}: {
  mode: 'checking' | 'undetermined' | 'denied';
  colors: ColorPalette;
  topInset: number;
  bottomInset: number;
  queuedCount: number;
  onRequest: () => void;
  onSettings: () => void;
}) {
  return (
    <Surface
      colors={colors}
      topInset={topInset}
      bottomInset={bottomInset}
      queuedCount={queuedCount}>
      <View style={[styles.permissionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text accessibilityRole="header" style={[styles.titleText, { color: colors.text }]}>Camera access</Text>
        <Text style={[styles.bodyText, { color: colors.textSecondary }]}>
          Photograph the pattern first, then the embossed model number underneath. Those two views let the catalog identify the exact pattern and form.
        </Text>
        {mode === 'checking' ? (
          <View
            accessibilityLabel="Checking camera access"
            accessibilityLiveRegion="polite"
            accessibilityRole="progressbar"
            style={styles.progressRow}>
            <ActivityIndicator color={colors.accent} />
            <Text style={[styles.calloutText, { color: colors.textSecondary }]}>Checking camera access…</Text>
          </View>
        ) : mode === 'undetermined' ? (
          <ActionButton label="Allow camera access" onPress={onRequest} colors={colors} />
        ) : (
          <>
            <Text style={[styles.calloutText, { color: colors.textSecondary }]}>
              Camera access is off. Open this app’s system settings and allow Camera to scan a dish.
            </Text>
            <ActionButton label="Open app settings" onPress={onSettings} colors={colors} />
          </>
        )}
      </View>
    </Surface>
  );
}

export default function ScanScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === 'dark' ? 'dark' : 'light'];
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
    if (response.lowConfidence || response.guesses.length === 0) {
      setCatalogQuery('');
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
      setPhase('browse');
      return;
    }
    setGuessRows(resolved);
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
    setCatalogQuery('');
    setUnknownPatternName('');
    setConfirmedSlug('');
    setConfirmedPatternName('');
    setConfirmedForm('');
    setOwnershipStatus('have');
    setQuantity(1);
  };

  const queueBurst = async (uris: string[], hasBaseShot: boolean) => {
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
    setPhase('identifying');
    setError(null);
    try {
      const result = await identify(uris, hasBaseShot);
      if (result.ok) {
        await presentIdentifyResponse(result.data, uris);
      } else if (shouldRetryQueueDrain(result.code, 0)) {
        await queueBurst(uris, hasBaseShot);
      } else {
        setPhase('camera');
        setError(result.error);
      }
    } catch {
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
        onRequest={() => {}}
        onSettings={() => void Linking.openSettings()}
      />
    );
  }

  if (phase === 'camera') {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
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
          style={styles.cameraOverlay}>
          <View pointerEvents="box-none" style={[styles.cameraTop, { paddingTop: safeTop }]}>
            <QueueBadge count={queuedCount} colors={colors} camera />
            <View style={[styles.cameraPrompt, { backgroundColor: colors.scrim }]}>
              <View pointerEvents="none" style={[styles.scrimLayer, { backgroundColor: colors.scrim }]} />
              <Text accessibilityRole="header" style={[styles.headlineText, { color: CAMERA_TEXT }]}>
                {needsBaseShot ? 'Now flip it over' : 'Start with the pattern'}
              </Text>
              <Text style={[styles.calloutText, { color: CAMERA_TEXT }]}>
                {needsBaseShot
                  ? 'Center the embossed model number on the underside. It is usually the strongest identification clue.'
                  : 'Fill the frame with the printed pattern and keep glare away from the design.'}
              </Text>
              <CapturedFrames photoUris={photoUris} colors={colors} camera />
            </View>
          </View>

          <View
            pointerEvents="box-none"
            style={[styles.cameraBottom, { backgroundColor: colors.scrim, paddingBottom: safeBottom }]}>
            <View pointerEvents="none" style={[styles.scrimLayer, { backgroundColor: colors.scrim }]} />
            {notice ? (
              <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={[styles.cameraNotice, { backgroundColor: colors.scrim }]}>
                <Text style={[styles.calloutText, { color: CAMERA_TEXT }]}>{notice}</Text>
              </View>
            ) : null}
            {error ? (
              <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={[styles.cameraNotice, { backgroundColor: colors.scrim }]}>
                <Text style={[styles.calloutText, { color: CAMERA_TEXT }]}>{error}</Text>
              </View>
            ) : null}
            <Pressable
              accessibilityLabel={needsBaseShot ? 'Capture base model number' : 'Capture pattern'}
              accessibilityRole="button"
              accessibilityState={{ disabled: capturing || !cameraReady }}
              disabled={capturing || !cameraReady}
              onPress={() => void captureFrame()}
              style={({ pressed }) => [
                styles.shutter,
                {
                  backgroundColor:
                    capturing || !cameraReady
                      ? colors.textTertiary
                      : pressed
                        ? Colors.light.backgroundSelected
                        : Colors.light.surface,
                  borderColor: Colors.light.backgroundSelected,
                },
              ]}
            />
            <Text accessibilityLiveRegion="polite" style={[styles.captionText, { color: CAMERA_TEXT }]}>
              {capturing ? 'Saving frame…' : needsBaseShot ? 'Base shot' : 'Pattern shot'}
            </Text>
            {needsBaseShot ? (
              <Pressable
                accessibilityLabel="Skip the base shot"
                accessibilityRole="button"
                onPress={() => void identifyBurst(photoUris, false)}
                style={({ pressed }) => [
                  styles.cameraSecondaryButton,
                  { backgroundColor: pressed ? colors.textSecondary : colors.scrim },
                ]}>
                <Text style={[styles.buttonText, { color: CAMERA_TEXT }]}>Skip base shot</Text>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>
      </View>
    );
  }

  if (phase === 'identifying' || phase === 'confirming') {
    return (
      <Surface colors={colors} topInset={safeTop} bottomInset={surfaceBottom} queuedCount={queuedCount}>
        <View
          accessibilityLabel={progressMessage}
          accessibilityLiveRegion="polite"
          accessibilityRole="progressbar"
          style={[styles.progressCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <ActivityIndicator color={colors.accent} />
          <Text accessibilityRole="header" style={[styles.titleText, { color: colors.text }]}>
            {phase === 'identifying' ? 'Identifying your piece' : 'Saving your choice'}
          </Text>
          <Text style={[styles.bodyText, { color: colors.textSecondary }]}>{progressMessage}</Text>
          {phase === 'identifying' ? <CapturedFrames photoUris={photoUris} colors={colors} /> : null}
        </View>
      </Surface>
    );
  }

  if (phase === 'results') {
    const candidates = guesses
      .slice(0, 3)
      .map((guess) => ({ guess, row: guessRows.find((row) => row.slug === guess.itemSlug) }))
      .filter((candidate): candidate is { guess: ScanGuess; row: CatalogRow } => Boolean(candidate.row));
    return (
      <Surface colors={colors} topInset={safeTop} bottomInset={surfaceBottom} queuedCount={queuedCount}>
        <Text accessibilityRole="header" style={[styles.displayText, { color: colors.text }]}>Best matches</Text>
        <Text style={[styles.bodyText, { color: colors.textSecondary }]}>Tap the exact pattern and form to confirm it.</Text>
        <Notice message={notice} colors={colors} />
        <Notice message={error} colors={colors} error />
        <View style={styles.stack}>
          {candidates.map(({ guess, row }, index) => (
            <Pressable
              accessibilityHint="Confirms this item and records whether it was the top guess"
              accessibilityLabel={`${row.patternName}, ${row.shape}, model ${row.modelNo}, ${confidenceLabel(guess.confidence)}`}
              accessibilityRole="button"
              key={row.slug}
              onPress={() => void confirmItem(row.slug, row.patternName, `${row.shape} · ${row.modelNo}`)}
              style={({ pressed }) => [
                styles.candidateCard,
                {
                  backgroundColor: pressed ? colors.backgroundSelected : colors.surface,
                  borderColor: colors.border,
                },
              ]}>
              <View style={[styles.rank, { backgroundColor: colors.backgroundElement }]}>
                <Text style={[styles.bodyStrongText, { color: colors.text }]}>{index + 1}</Text>
              </View>
              <View style={styles.candidateCopy}>
                <Text style={[styles.headlineText, { color: colors.text }]}>{row.patternName}</Text>
                <Text style={[styles.calloutText, { color: colors.textSecondary }]}>{row.shape} · {row.modelNo}</Text>
                <Text style={[styles.captionText, { color: colors.accent }]}>{confidenceLabel(guess.confidence)}</Text>
                <Text style={[styles.captionText, { color: colors.textSecondary }]}>{guess.reasoning}</Text>
              </View>
            </Pressable>
          ))}
        </View>
        <ActionButton
          label="None of these"
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
      <Surface colors={colors} topInset={safeTop} bottomInset={surfaceBottom} queuedCount={queuedCount}>
        <Text accessibilityRole="header" style={[styles.displayText, { color: colors.text }]}>Find the right piece</Text>
        <Text style={[styles.bodyText, { color: colors.textSecondary }]}>The saved catalog works without a connection. Search by pattern, shape, or model number.</Text>
        <Notice message={notice} colors={colors} />
        <Notice message={error} colors={colors} error />
        <TextInput
          accessibilityLabel="Search the saved catalog"
          accessibilityRole="search"
          autoCapitalize="words"
          onChangeText={setCatalogQuery}
          placeholder="Butterprint, casserole, 444…"
          placeholderTextColor={colors.textSecondary}
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
            <Text style={[styles.calloutText, { color: colors.textSecondary }]}>Searching the saved catalog…</Text>
          </View>
        ) : (
          <View style={styles.stack}>
            {catalogRows.map((row) => (
              <Pressable
                accessibilityLabel={`${row.patternName}, ${row.shape}, model ${row.modelNo}`}
                accessibilityRole="button"
                key={row.slug}
                onPress={() => void confirmItem(row.slug, row.patternName, `${row.shape} · ${row.modelNo}`)}
                style={({ pressed }) => [
                  styles.catalogRow,
                  {
                    backgroundColor: pressed ? colors.backgroundSelected : colors.surface,
                    borderColor: colors.border,
                  },
                ]}>
                <View style={styles.candidateCopy}>
                  <Text style={[styles.bodyStrongText, { color: colors.text }]}>{row.patternName}</Text>
                  <Text style={[styles.calloutText, { color: colors.textSecondary }]}>{row.shape} · {row.modelNo}</Text>
                </View>
                <Text style={[styles.bodyStrongText, { color: colors.accent }]}>Choose</Text>
              </Pressable>
            ))}
            {catalogRows.length === 0 ? (
              <Text style={[styles.calloutText, { color: colors.textSecondary }]}>No saved catalog items match that search.</Text>
            ) : null}
          </View>
        )}

        <View style={[styles.unknownCard, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
          <Text accessibilityRole="header" style={[styles.headlineText, { color: colors.text }]}>Pattern not catalogued?</Text>
          <Text style={[styles.calloutText, { color: colors.textSecondary }]}>Name it in your own words. A connection is required to create the catalog entry.</Text>
          <TextInput
            accessibilityLabel="Name the unknown pattern"
            accessibilityRole="text"
            autoCapitalize="words"
            onChangeText={setUnknownPatternName}
            placeholder="Pattern name"
            placeholderTextColor={colors.textSecondary}
            returnKeyType="done"
            style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
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
      <Surface colors={colors} topInset={safeTop} bottomInset={surfaceBottom} queuedCount={queuedCount}>
        <Text accessibilityRole="header" style={[styles.displayText, { color: colors.text }]}>{confirmedPatternName}</Text>
        <Text style={[styles.bodyText, { color: colors.textSecondary }]}>{confirmedForm}</Text>
        <Notice message={notice} colors={colors} />
        <Notice message={error} colors={colors} error />
        <View style={[styles.ownershipCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text accessibilityRole="header" style={[styles.headlineText, { color: colors.text }]}>Add it to your collection</Text>
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
                      backgroundColor: pressed
                        ? colors.backgroundSelected
                        : selected
                          ? colors.backgroundSelected
                          : colors.backgroundElement,
                    },
                  ]}>
                  <Text style={[styles.bodyStrongText, { color: selected ? colors.accent : colors.text }]}>
                    {status === 'have' ? 'Have' : 'Want'} {selected ? '✓' : ''}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {ownershipStatus === 'have' ? (
            <View style={styles.quantityRow}>
              <Text style={[styles.bodyStrongText, { color: colors.text }]}>Quantity</Text>
              <View style={styles.stepper}>
                <Pressable
                  accessibilityLabel="Decrease quantity"
                  accessibilityRole="button"
                  accessibilityState={{ disabled: quantity === 1 }}
                  disabled={quantity === 1}
                  onPress={() => setQuantity((current) => Math.max(1, current - 1))}
                  style={({ pressed }) => [
                    styles.stepperButton,
                    { backgroundColor: pressed ? colors.backgroundSelected : colors.backgroundElement },
                  ]}>
                  <Text style={[styles.titleText, { color: quantity === 1 ? colors.textTertiary : colors.text }]}>−</Text>
                </Pressable>
                <Text
                  accessibilityLabel={`Quantity ${quantity}`}
                  style={[styles.titleText, styles.quantityValue, { color: colors.text }]}
                >
                  {quantity}
                </Text>
                <Pressable
                  accessibilityLabel="Increase quantity"
                  accessibilityRole="button"
                  onPress={() => setQuantity((current) => current + 1)}
                  style={({ pressed }) => [
                    styles.stepperButton,
                    { backgroundColor: pressed ? colors.backgroundSelected : colors.backgroundElement },
                  ]}>
                  <Text style={[styles.titleText, { color: colors.text }]}>+</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Text style={[styles.calloutText, { color: colors.textSecondary }]}>Want-list items do not need a quantity.</Text>
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
    <Surface colors={colors} topInset={safeTop} bottomInset={surfaceBottom} queuedCount={queuedCount}>
      <View style={[styles.savedCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text accessibilityRole="header" style={[styles.displayText, { color: colors.text }]}>Saved</Text>
        <Text style={[styles.bodyText, { color: colors.textSecondary }]}>
          {confirmedPatternName} is now on your {ownershipStatus === 'have' ? 'shelf' : 'want list'}.
        </Text>
        <ActionButton label="Scan another piece" onPress={resetScan} colors={colors} />
      </View>
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
  displayText: {
    ...Type.display,
    fontFamily: Fonts.sans,
  },
  titleText: {
    ...Type.title,
    fontFamily: Fonts.sans,
  },
  headlineText: {
    ...Type.headline,
    fontFamily: Fonts.sans,
  },
  bodyText: {
    ...Type.body,
    fontFamily: Fonts.sans,
  },
  bodyStrongText: {
    ...Type.bodyStrong,
    fontFamily: Fonts.sans,
  },
  buttonText: {
    ...Type.bodyStrong,
    fontFamily: Fonts.sans,
    textAlign: 'center',
  },
  calloutText: {
    ...Type.callout,
    fontFamily: Fonts.sans,
  },
  captionText: {
    ...Type.caption,
    fontFamily: Fonts.sans,
  },
  microText: {
    ...Type.micro,
    fontFamily: Fonts.sans,
    textTransform: 'uppercase',
  },
  actionButton: {
    alignItems: 'center',
    borderRadius: Radius.md,
    justifyContent: 'center',
    minHeight: HitTarget,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  queueBadge: {
    alignSelf: 'flex-start',
    borderRadius: Radius.pill,
    minHeight: HitTarget,
    justifyContent: 'center',
    overflow: 'hidden',
    paddingHorizontal: Spacing.three,
  },
  framesRow: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  frameColumn: {
    gap: Spacing.one,
  },
  frameImage: {
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    height: Spacing.six,
    width: Spacing.six,
  },
  emptyFrame: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  notice: {
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
  },
  permissionCard: {
    ...Elevation.card,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.three,
    padding: Spacing.four,
  },
  progressRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.two,
    minHeight: HitTarget,
  },
  progressCard: {
    ...Elevation.card,
    alignItems: 'flex-start',
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.three,
    padding: Spacing.four,
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFill,
  },
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
    borderRadius: Radius.lg,
    gap: Spacing.two,
    overflow: 'hidden',
    padding: Spacing.three,
  },
  cameraBottom: {
    alignItems: 'center',
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    gap: Spacing.two,
    overflow: 'hidden',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
  },
  scrimLayer: {
    ...StyleSheet.absoluteFill,
  },
  cameraNotice: {
    alignSelf: 'stretch',
    borderRadius: Radius.md,
    padding: Spacing.three,
  },
  shutter: {
    borderRadius: Radius.pill,
    borderWidth: Spacing.one,
    height: Spacing.six,
    width: Spacing.six,
  },
  cameraSecondaryButton: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    justifyContent: 'center',
    minHeight: HitTarget,
    paddingHorizontal: Spacing.three,
  },
  stack: {
    gap: Spacing.two,
  },
  candidateCard: {
    ...Elevation.card,
    alignItems: 'flex-start',
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: Spacing.three,
    minHeight: HitTarget,
    padding: Spacing.three,
  },
  rank: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    height: HitTarget,
    justifyContent: 'center',
    width: HitTarget,
  },
  candidateCopy: {
    flex: 1,
    gap: Spacing.one,
  },
  input: {
    ...Type.body,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    fontFamily: Fonts.sans,
    minHeight: HitTarget,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  catalogRow: {
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: Spacing.three,
    minHeight: HitTarget,
    padding: Spacing.three,
  },
  unknownCard: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.three,
    marginTop: Spacing.three,
    padding: Spacing.three,
  },
  ownershipCard: {
    ...Elevation.card,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.three,
    padding: Spacing.four,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  toggleButton: {
    alignItems: 'center',
    borderRadius: Radius.md,
    flex: 1,
    justifyContent: 'center',
    minHeight: HitTarget,
    paddingHorizontal: Spacing.three,
  },
  quantityRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  stepper: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.two,
  },
  stepperButton: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    height: HitTarget,
    justifyContent: 'center',
    width: HitTarget,
  },
  quantityValue: {
    minWidth: HitTarget,
    textAlign: 'center',
  },
  savedCard: {
    ...Elevation.card,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.three,
    padding: Spacing.four,
  },
});
