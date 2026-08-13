/**
 * The scan flow: permission, the two-shot burst, the identification wait, the guesses,
 * filing the result, and the fallbacks around all of it.
 *
 * This file is the wiring. Everything it draws lives in two siblings, split by which
 * ground it sits on: `scan-camera.tsx` holds the screens over the camera, which use the
 * fixed `CameraChrome` palette, and `scan-results.tsx` holds the screens on the app
 * ground, which use the theme. That is the same line the reference lock draws, so it is
 * the seam the files follow.
 *
 * The two things worth knowing before changing anything here:
 *
 * Offline is the expected case, not the exception. Antique malls have terrible signal,
 * so a burst captured with no connection is written to SQLite as file URIs and stays
 * quiet until the collector chooses Review. The queue is never base64.
 *
 * A price is never rendered without the claim behind it. The ledger on the confirmation
 * screen uses `LedgerFigure`, whose `source` prop is required, and a failed price batch
 * fails the whole total rather than quietly under-reporting it.
 */

import { useNetInfo } from '@react-native-community/netinfo';
import { CameraView, PermissionStatus, useCameraPermissions } from 'expo-camera';
import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, StyleSheet, View } from 'react-native';

import {
  fetchCatalog,
  fetchItem,
  fetchPrices,
  identify,
  identifySet,
  logScan,
  submitKnownCombination,
  submitUnknownPattern,
} from '@/api';
import {
  bumpScanAttempts,
  dequeueScan,
  enqueueScan,
  getCollection,
  getForm,
  getPattern,
  getSettings,
  getUserItem,
  listQueuedScans,
  searchCatalog,
  setOwnership,
  syncCatalog,
  type CatalogRow,
} from '@/db';
import { calculateCollectionValues } from '@/features/collection/collection-total';
import { priceSourceLabel } from '@/features/collection/collection-ui';
import type {
  ApiErrorCode,
  IdentifyResponse,
  IdentifySetResponse,
  Form,
  OwnershipStatus,
  Pattern,
  QueuedScan,
  ScanGuess,
} from '@shared/types';
import {
  IdentifyingScreen,
  PermissionScreen,
  ShutterFlash,
  ViewfinderScreen,
  type ScanBannerAction,
} from './scan-camera';
import {
  AlreadyOwnedSheet,
  BrowseDetailScreen,
  BrowseScreen,
  FiledScreen,
  KnownCombinationScreen,
  ResultScreen,
  SetResultsScreen,
  money,
  type FiledLedger,
  type SetResultItem,
} from './scan-results';
import {
  adjustSetGroupCount,
  advanceBulkQueue,
  bulkPhotoProgress,
  deriveHuntingChips,
  photoInvitesFor,
  deriveLlmWasRight,
  groupDetections,
  knownCombinationOptions,
  oldestSavedScan,
  ordinal,
  ordinalWord,
  rankHuntingRows,
  replaceOrMergeDetectionGroup,
  savedScanBannerMessage,
  setFilingPieces,
  setScanLogInputs,
  shouldPresentBrowseDetail,
  shouldRetryQueueDrain,
  summarizeFiledPrices,
  type GroupedDetection,
  type HuntingChip,
} from './logic';

type Phase =
  | 'camera'
  | 'identifying'
  | 'results'
  | 'set-results'
  | 'browse'
  | 'browse-detail'
  | 'known-combination'
  | 'confirming'
  | 'owned'
  | 'saved';

interface FiledPiece {
  itemSlug: string;
  count: number;
}

interface FiledBatch {
  pieces: FiledPiece[];
  headline: string;
}

// ponytail: one capture-quality knob is enough; tune it only if upload time or model detail suffers.
const CAPTURE_QUALITY = 0.8;
const QUEUE_PHOTO_DIRECTORY = 'scan-queue';
/** The prototype's shutter beat: flash for 150ms, advance at 260ms. */
const FLASH_MS = 150;
/** How many shape chips the browse screen offers. Four is what the mock draws. */
const CHIP_COUNT = 4;

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

/**
 * The month the row was last written. Deliberately not "since March": `UserItem` has
 * only `updatedAt`, so adding a second one last week would date the whole holding to
 * last week. What this can honestly say is when it was last filed.
 */
function monthOf(iso: string): string | null {
  const when = new Date(iso);
  return Number.isNaN(when.valueOf())
    ? null
    : when.toLocaleDateString(undefined, { month: 'long' });
}

export default function ScanScreen() {
  const netInfo = useNetInfo();
  const [permission, requestPermission, refreshPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const reviewingSavedScanRef = useRef(false);
  const ledgerTokenRef = useRef(0);
  const loggedSlugRef = useRef<string | null>(null);
  const browseDetailTokenRef = useRef(0);
  const knownDefinitionsTokenRef = useRef(0);
  const knownPatternTokenRef = useRef(0);
  const phaseRef = useRef<Phase>('camera');
  const bulkQueueRef = useRef<string[]>([]);
  const bulkIndexRef = useRef<number | null>(null);
  const bulkGenerationRef = useRef(0);
  const bulkPrefetchRef = useRef<{
    index: number;
    generation: number;
    request: ReturnType<typeof identifySet>;
  } | null>(null);
  const bulkLastFiledRef = useRef<FiledBatch | null>(null);

  const [phase, setPhase] = useState<Phase>('camera');
  const [scanMode, setScanMode] = useState<'single' | 'set'>('single');
  const [cameraReady, setCameraReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [flashing, setFlashing] = useState(false);
  const [photoUris, setPhotoUris] = useState<string[]>([]);
  const [identifiedHasBaseShot, setIdentifiedHasBaseShot] = useState(false);
  const [guesses, setGuesses] = useState<ScanGuess[]>([]);
  const [guessRows, setGuessRows] = useState<CatalogRow[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [selectedPattern, setSelectedPattern] = useState<Pattern | null>(null);
  const [setGroups, setSetGroups] = useState<GroupedDetection[]>([]);
  const [removedSetSlugs, setRemovedSetSlugs] = useState<string[]>([]);
  const [correctingSlug, setCorrectingSlug] = useState<string | null>(null);
  const [contradicted, setContradicted] = useState(0);
  const [queuedCount, setQueuedCount] = useState(0);
  const [reviewedScan, setReviewedScan] = useState<QueuedScan | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waitCopy, setWaitCopy] = useState({ title: 'Reading the mark', caption: '' });
  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [shapeFilter, setShapeFilter] = useState<string | null>(null);
  const [huntingGuesses, setHuntingGuesses] = useState<ScanGuess[] | null>(null);
  const [huntingChip, setHuntingChip] = useState<HuntingChip | null>(null);
  const [browseDetail, setBrowseDetail] = useState<{
    row: CatalogRow;
    pattern: Pattern;
    form: Form | null;
    readOnly: boolean;
  } | null>(null);
  const [unknownPatternName, setUnknownPatternName] = useState('');
  const [knownPatternId, setKnownPatternId] = useState<string | null>(null);
  const [knownFormId, setKnownFormId] = useState<string | null>(null);
  const [knownCombinationQuery, setKnownCombinationQuery] = useState('');
  const [knownDefinitions, setKnownDefinitions] = useState<{
    patterns: Pattern[];
    forms: Form[];
  } | null>(null);
  const [knownPatternDetail, setKnownPatternDetail] = useState<Pattern | null>(null);
  const [owned, setOwned] = useState<{ row: CatalogRow; quantity: number; since: string | null } | null>(null);
  const [filedHeadline, setFiledHeadline] = useState('');
  const [ledger, setLedger] = useState<FiledLedger | null>(null);
  const [photoInvites, setPhotoInvites] = useState<ReturnType<typeof photoInvitesFor>>([]);
  const [bulkPhotoUris, setBulkPhotoUris] = useState<string[]>([]);
  const [bulkIndex, setBulkIndex] = useState<number | null>(null);

  const isOffline = netInfo.isConnected === false || netInfo.isInternetReachable === false;
  const canReviewSavedScans = netInfo.isConnected === true && netInfo.isInternetReachable !== false;
  const needsBaseShot = scanMode === 'single' && photoUris.length === 1;
  const cameraIdle = phase === 'camera' && photoUris.length === 0 && bulkPhotoUris.length === 0 && !capturing;
  const bulkProgress = bulkIndex === null
    ? null
    : bulkPhotoProgress(bulkIndex, bulkPhotoUris.length);
  phaseRef.current = phase;

  const savedScanBanner = savedScanBannerMessage(queuedCount, confirmingDiscard);
  // Both facts, not one or the other: a notice must not swallow the saved-scan count.
  const banner = confirmingDiscard
    ? savedScanBanner
    : [notice, savedScanBanner].filter(Boolean).join(' ') || null;

  const refreshQueuedCount = useCallback(async () => {
    const scans = await listQueuedScans();
    setQueuedCount(scans.filter(({ localId }) => localId !== reviewedScan?.localId).length);
  }, [reviewedScan?.localId]);

  /**
   * Always re-read rather than trusting a cached copy: the bundled catalog is seeded on
   * first launch and refreshed in the background, so the rows can appear between mount
   * and the moment a guess needs resolving.
   */
  const loadCatalog = useCallback(async () => {
    // CONTRACT: app bootstrap must seed or sync the local catalog before this screen mounts.
    const rows = await searchCatalog('', Number.MAX_SAFE_INTEGER);
    setCatalog(rows);
    return rows;
  }, []);

  const presentIdentifyResponse = useCallback(async (
    response: IdentifyResponse,
    queuedPhotoUris: string[],
    hasBaseShot: boolean,
  ) => {
    setPhotoUris(queuedPhotoUris);
    setIdentifiedHasBaseShot(hasBaseShot);
    setGuesses(response.guesses);
    setError(null);
    if (response.lowConfidence || response.guesses.length === 0) {
      setCatalogQuery('');
      setHuntingGuesses(null);
      setHuntingChip(null);
      setPhase('browse');
      return;
    }

    const rows = await loadCatalog();
    const resolved = response.guesses
      .slice(0, 3)
      .map((guess) => rows.find((row) => row.slug === guess.itemSlug))
      .filter((row): row is CatalogRow => Boolean(row));
    if (resolved.length === 0) {
      setCatalogQuery('');
      setHuntingGuesses(null);
      setHuntingChip(null);
      setPhase('browse');
      return;
    }
    setGuessRows(resolved);
    setSelectedSlug(resolved[0].slug);
    setPhase('results');
  }, [loadCatalog]);

  const handleSavedScanFailure = useCallback(async (
    scan: QueuedScan,
    code: ApiErrorCode,
  ) => {
    setReviewedScan(null);
    setPhotoUris([]);
    setPhase('camera');
    setError(null);
    if (shouldRetryQueueDrain(code, scan.attempts)) {
      await bumpScanAttempts(scan.localId);
      setNotice('Saved scan kept. Select Review to try again.');
    } else {
      await dequeueScan(scan.localId);
      deleteQueuedPhotos(scan.photos);
      setNotice('A saved scan could not be identified. Please photograph it again.');
    }
    await refreshQueuedCount();
  }, [refreshQueuedCount]);

  const reviewNextSavedScan = async () => {
    if (reviewingSavedScanRef.current) return;
    if (!canReviewSavedScans) {
      setNotice('Connect to review saved scans.');
      return;
    }

    reviewingSavedScanRef.current = true;
    setConfirmingDiscard(false);
    setWaitCopy({ title: 'Reading a saved scan', caption: 'Identifying the oldest saved scan.' });
    setPhase('identifying');
    setError(null);
    setNotice(null);
    try {
      const scans = await listQueuedScans();
      const scan = oldestSavedScan(scans);
      if (!scan) {
        setQueuedCount(0);
        setPhase('camera');
        return;
      }

      let result;
      try {
        result = await identify(scan.photos, scan.hasBaseShot);
      } catch {
        await handleSavedScanFailure(scan, 'internal');
        return;
      }
      if (!result.ok) {
        await handleSavedScanFailure(scan, result.code);
        return;
      }

      setReviewedScan(scan);
      setQueuedCount(Math.max(0, scans.length - 1));
      try {
        await presentIdentifyResponse(result.data, scan.photos, scan.hasBaseShot);
      } catch {
        setReviewedScan(null);
        await handleSavedScanFailure(scan, 'internal');
        return;
      }
      try {
        await dequeueScan(scan.localId);
      } catch {
        setNotice('Identified. The saved scan will finish cleaning up later.');
      }
    } catch {
      setPhase('camera');
      setError('Saved scans could not be opened.');
    } finally {
      reviewingSavedScanRef.current = false;
    }
  };

  const discardAllSavedScans = async () => {
    setError(null);
    try {
      const scans = await listQueuedScans();
      for (const scan of scans) {
        await dequeueScan(scan.localId);
        deleteQueuedPhotos(scan.photos);
      }
      setQueuedCount(0);
      setConfirmingDiscard(false);
      setNotice(`Discarded ${scans.length} saved scan${scans.length === 1 ? '' : 's'}.`);
    } catch {
      setConfirmingDiscard(false);
      setError('Some saved scans could not be discarded.');
      await refreshQueuedCount().catch(() => {});
    }
  };

  const bannerActions: readonly ScanBannerAction[] | undefined =
    queuedCount > 0 && cameraIdle
      ? confirmingDiscard
        ? [
            {
              label: 'Discard all',
              accessibilityLabel: `Discard all ${queuedCount} saved scans`,
              onPress: () => void discardAllSavedScans(),
            },
            {
              label: 'Keep',
              accessibilityLabel: 'Keep saved scans',
              onPress: () => setConfirmingDiscard(false),
            },
          ]
        : [
            {
              label: 'Review',
              accessibilityLabel: 'Review the oldest saved scan',
              onPress: () => void reviewNextSavedScan(),
            },
            {
              label: 'Discard all',
              accessibilityLabel: `Discard all ${queuedCount} saved scans`,
              onPress: () => setConfirmingDiscard(true),
            },
          ]
      : undefined;

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    void refreshQueuedCount();
  }, [canReviewSavedScans, refreshQueuedCount]);

  useEffect(() => {
    if (phase === 'browse') void loadCatalog().catch(() => setError('The saved catalog could not be opened.'));
  }, [loadCatalog, phase]);

  useEffect(() => {
    let current = true;
    const row = guessRows.find((candidate) => candidate.slug === selectedSlug);
    setSelectedPattern(null);
    if (!row) return () => { current = false; };

    void getPattern(row.patternId)
      .then((pattern) => {
        if (current) setSelectedPattern(pattern);
      })
      .catch(() => {
        if (current) setSelectedPattern(null);
      });
    return () => { current = false; };
  }, [guessRows, selectedSlug]);

  // The catalog is small enough to filter in memory, which keeps the field responsive
  // per keystroke and matches what `searchCatalog` matches on: pattern, form, model no.
  const huntingRows = useMemo(
    () => huntingGuesses ? rankHuntingRows(huntingGuesses, catalog) : catalog,
    [catalog, huntingGuesses],
  );
  const huntingChips = useMemo(
    () => huntingGuesses ? deriveHuntingChips(huntingGuesses, catalog) : [],
    [catalog, huntingGuesses],
  );
  const browseRows = useMemo(() => {
    const query = catalogQuery.trim().toLowerCase();
    return huntingRows.filter((row) =>
      (!shapeFilter || row.shape === shapeFilter) &&
      (!huntingChip || (
        huntingChip.kind === 'pattern'
          ? row.patternId === huntingChip.value
          : row.modelNo === huntingChip.value
      )) &&
      (!query ||
        row.patternName.toLowerCase().includes(query) ||
        row.shape.toLowerCase().includes(query) ||
        row.modelNo.toLowerCase().includes(query)),
    );
  }, [catalogQuery, huntingChip, huntingRows, shapeFilter]);

  const setResultItems = useMemo<SetResultItem[]>(() => {
    const removed = new Set(removedSetSlugs);
    return setGroups.flatMap((group) => {
      const row = catalog.find((candidate) => candidate.slug === group.itemSlug);
      return row && !removed.has(group.itemSlug) ? [{ group, row }] : [];
    });
  }, [catalog, removedSetSlugs, setGroups]);

  /** The forms the catalog actually holds most of, rather than a written-in list. */
  const shapes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of catalog) counts.set(row.shape, (counts.get(row.shape) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, CHIP_COUNT)
      .map(([shape]) => shape);
  }, [catalog]);

  // Full definitions add patterns with facts but no item rows; rows still say which
  // forms are already used by the selected pattern.
  const knownCombination = useMemo(
    () => knownCombinationOptions(
      catalog,
      knownPatternId,
      knownDefinitions ?? undefined,
    ),
    [catalog, knownDefinitions, knownPatternId],
  );

  const dropBulkQueue = useCallback(() => {
    bulkGenerationRef.current += 1;
    bulkQueueRef.current = [];
    bulkIndexRef.current = null;
    bulkPrefetchRef.current = null;
    bulkLastFiledRef.current = null;
    setBulkPhotoUris([]);
    setBulkIndex(null);
  }, []);

  const resetScan = useCallback(() => {
    browseDetailTokenRef.current += 1;
    knownDefinitionsTokenRef.current += 1;
    knownPatternTokenRef.current += 1;
    dropBulkQueue();
    phaseRef.current = 'camera';
    setPhase('camera');
    setScanMode('single');
    setCapturing(false);
    setFlashing(false);
    setPhotoUris([]);
    setIdentifiedHasBaseShot(false);
    setGuesses([]);
    setGuessRows([]);
    setSelectedSlug(null);
    setSelectedPattern(null);
    setSetGroups([]);
    setRemovedSetSlugs([]);
    setCorrectingSlug(null);
    setContradicted(0);
    setConfirmingDiscard(false);
    setNotice(null);
    setError(null);
    setCatalogQuery('');
    setShapeFilter(null);
    setHuntingGuesses(null);
    setHuntingChip(null);
    setBrowseDetail(null);
    setUnknownPatternName('');
    setKnownPatternId(null);
    setKnownFormId(null);
    setKnownCombinationQuery('');
    setKnownDefinitions(null);
    setKnownPatternDetail(null);
    setOwned(null);
    setFiledHeadline('');
    setLedger(null);
    setPhotoInvites([]);
    ledgerTokenRef.current += 1;
    loggedSlugRef.current = null;
  }, [dropBulkQueue]);

  const leaveScan = useCallback(async (keepPrimaryPhoto = false): Promise<boolean> => {
    if (reviewedScan) {
      try {
        await dequeueScan(reviewedScan.localId);
      } catch {
        setError('The saved scan could not be discarded.');
        return false;
      }
      const retainedPhoto = keepPrimaryPhoto ? photoUris[0] : null;
      deleteQueuedPhotos(reviewedScan.photos.filter((uri) => uri !== retainedPhoto));
      setReviewedScan(null);
    }
    resetScan();
    return true;
  }, [photoUris, resetScan, reviewedScan]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refreshPermission();
      } else if (bulkQueueRef.current.length > 0) {
        resetScan();
      }
    });
    return () => subscription.remove();
  }, [refreshPermission, resetScan]);

  const retakeSet = useCallback(() => {
    resetScan();
    setScanMode('set');
  }, [resetScan]);

  const chooseBulkPhotos = async () => {
    try {
      const { launchImageLibraryAsync } = await import('expo-image-picker');
      const result = await launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: 0,
      });
      const uris = result.assets?.map(({ uri }) => uri).filter(Boolean) ?? [];
      if (result.canceled || uris.length === 0) return;

      dropBulkQueue();
      bulkQueueRef.current = uris;
      setBulkPhotoUris(uris);
      setError(null);
      setNotice(null);
    } catch (pickerError) {
      setError(pickerError instanceof Error ? pickerError.message : 'Could not open your photos.');
    }
  };

  const queueBurst = async (uris: string[], hasBaseShot: boolean) => {
    setWaitCopy({ title: 'Saving the scan', caption: 'Keeping it on this phone until a connection comes back.' });
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
    setNotice('Saved offline. Review it from the banner when you are back online.');
  };

  const identifyBurst = async (uris: string[], hasBaseShot: boolean) => {
    if (isOffline) {
      await queueBurst(uris, hasBaseShot);
      return;
    }

    setWaitCopy({
      title: 'Reading the mark',
      // The model number cannot be named here: nothing has read it yet. `/identify`
      // returns item slugs, so the mock's "Matching 474-B" is a number we do not have
      // until the answer comes back, and naming a made-up one would be a false claim.
      caption: catalog.length
        ? `Matching ${hasBaseShot ? 'both shots' : 'the pattern'} against ${catalog.length} catalogued pieces.`
        : `Matching ${hasBaseShot ? 'both shots' : 'the pattern'} against the catalog.`,
    });
    setPhase('identifying');
    setError(null);
    try {
      const result = await identify(uris, hasBaseShot);
      if (result.ok) {
        await presentIdentifyResponse(result.data, uris, hasBaseShot);
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

  const presentSetResponse = async (
    response: IdentifySetResponse,
    photoUri: string,
    bulk: boolean,
    isCurrent: () => boolean,
  ): Promise<boolean> => {
    if (response.lowConfidence || response.detections.length === 0) {
      setPhotoUris(bulk ? [photoUri] : []);
      setSetGroups([]);
      setRemovedSetSlugs([]);
      setContradicted(response.contradicted);
      phaseRef.current = bulk ? 'set-results' : 'camera';
      setPhase(bulk ? 'set-results' : 'camera');
      setError(
        bulk
          ? 'This photo could not be read confidently.'
          : 'The set could not be read confidently. Switch to One piece and scan each dish separately.',
      );
      return false;
    }

    const rows = await loadCatalog();
    if (!isCurrent()) return false;
    const groups = groupDetections(response.detections);
    if (groups.some((group) => !rows.some((row) => row.slug === group.itemSlug))) {
      setPhotoUris(bulk ? [photoUri] : []);
      setSetGroups([]);
      setRemovedSetSlugs([]);
      setContradicted(response.contradicted);
      phaseRef.current = bulk ? 'set-results' : 'camera';
      setPhase(bulk ? 'set-results' : 'camera');
      setError(
        bulk
          ? 'Some pieces in this photo were not in the saved catalog.'
          : 'Some pieces were not in the saved catalog. Switch to One piece and scan each dish separately.',
      );
      return false;
    }

    setPhotoUris([photoUri]);
    setSetGroups(groups);
    setRemovedSetSlugs([]);
    setContradicted(response.contradicted);
    setError(null);
    phaseRef.current = 'set-results';
    setPhase('set-results');
    return true;
  };

  const identifyWholeSet = async (
    photoUri: string,
    bulkPosition: number | null = null,
    retry = false,
  ) => {
    const generation = bulkGenerationRef.current;
    const bulk = bulkPosition !== null;
    const isCurrent = () =>
      !bulk || (
        generation === bulkGenerationRef.current &&
        bulkIndexRef.current === bulkPosition
      );
    phaseRef.current = 'identifying';
    setWaitCopy({
      title: 'Reading the whole set',
      caption: catalog.length
        ? `Matching each visible piece against ${catalog.length} catalogued pieces.`
        : 'Matching each visible piece against the catalog.',
    });
    setPhase('identifying');
    setError(null);
    try {
      const prefetched = bulkPrefetchRef.current;
      const canUsePrefetch =
        bulk &&
        !retry &&
        prefetched?.index === bulkPosition &&
        prefetched.generation === generation;
      if (bulk && prefetched?.index === bulkPosition) bulkPrefetchRef.current = null;
      const result = await (canUsePrefetch ? prefetched.request : identifySet(photoUri));
      if (!isCurrent()) return;
      if (result.ok) {
        const presented = await presentSetResponse(result.data, photoUri, bulk, isCurrent);
        if (!presented || !bulk || !isCurrent()) return;

        const nextIndex = bulkPosition + 1;
        const nextUri = bulkQueueRef.current[nextIndex];
        if (nextUri) {
          bulkPrefetchRef.current = {
            index: nextIndex,
            generation,
            request: identifySet(nextUri).catch(() => ({
              ok: false,
              error: 'The photo could not be read. Please try again.',
              code: 'internal',
            })),
          };
        }
      } else {
        setPhotoUris(bulk ? [photoUri] : []);
        setSetGroups([]);
        setRemovedSetSlugs([]);
        setContradicted(0);
        phaseRef.current = bulk ? 'set-results' : 'camera';
        setPhase(bulk ? 'set-results' : 'camera');
        setError(result.error);
      }
    } catch {
      if (!isCurrent()) return;
      setPhotoUris(bulk ? [photoUri] : []);
      setSetGroups([]);
      setRemovedSetSlugs([]);
      setContradicted(0);
      phaseRef.current = bulk ? 'set-results' : 'camera';
      setPhase(bulk ? 'set-results' : 'camera');
      setError(
        bulk
          ? 'The photo could not be read. Please try again.'
          : 'The set photo could not be read. Please capture it again.',
      );
    }
  };

  const confirmBulkImport = () => {
    const firstPhoto = bulkQueueRef.current[0];
    if (!firstPhoto || phaseRef.current !== 'camera') return;
    bulkIndexRef.current = 0;
    setBulkIndex(0);
    setScanMode('set');
    setError(null);
    setNotice(null);
    void identifyWholeSet(firstPhoto, 0);
  };

  const captureFrame = async () => {
    if (!cameraRef.current || !cameraReady || capturing) return;
    if (scanMode === 'set' && isOffline) {
      // ponytail: set scans require a connection until the offline queue gains a set-shaped schema.
      setError(null);
      setNotice('Set scans need a connection. Single-piece scans still save offline.');
      return;
    }
    if (scanMode === 'set') setNotice(null);
    setCapturing(true);
    setError(null);
    setFlashing(true);
    setTimeout(() => setFlashing(false), FLASH_MS);
    try {
      const picture = await cameraRef.current.takePictureAsync({
        base64: false,
        exif: false,
        quality: CAPTURE_QUALITY,
        skipProcessing: false,
      });
      if (scanMode === 'set') {
        setPhotoUris([picture.uri]);
        await identifyWholeSet(picture.uri);
      } else if (needsBaseShot) {
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

  const presentFiled = async (
    filed: FiledPiece[],
    headline: (shelfPieces: number) => string,
  ) => {
    const items = await getCollection();
    const have = items.filter((item) => item.status === 'have');
    const pieces = have.reduce((total, item) => total + item.quantity, 0);
    const pieceWord = `${pieces} ${pieces === 1 ? 'piece' : 'pieces'} filed`;

    setFiledHeadline(headline(pieces));
    setLedger({
      itemFigure: null,
      itemSource: 'awaiting comparables',
      shelfFigure: null,
      shelfSource: 'awaiting comparables',
      pieceNote: pieceWord,
    });
    setOwned(null);
    setPhotoInvites([]);
    setPhase('saved');

    // A later scan, or a reset, invalidates these fills: the details and prices that
    // come back belong to the confirmation that asked for them and to no other.
    const token = (ledgerTokenRef.current += 1);
    void Promise.all(filed.map(({ itemSlug }) => fetchItem(itemSlug)))
      .then((results) => {
        if (token === ledgerTokenRef.current) setPhotoInvites(photoInvitesFor(results));
      })
      .catch(() => {});
    const quotes = await fetchPrices(items.map((item) => item.itemSlug));
    if (token !== ledgerTokenRef.current) return;

    if (!quotes.ok) {
      setLedger({
        itemFigure: null,
        itemSource: 'prices unavailable',
        shelfFigure: null,
        shelfSource: 'prices unavailable',
        pieceNote: pieceWord,
      });
      return;
    }

    const filedPrices = summarizeFiledPrices(filed, quotes.data);
    const values = calculateCollectionValues(have, quotes.data);
    const unpriced = values[0]?.itemsUnpriced ?? have.length;

    setLedger({
      itemFigure: filedPrices.low === null || filedPrices.high === null
        ? null
        : `${money.format(filedPrices.low)}–${money.format(filedPrices.high)}`,
      itemSource: filedPrices.sources.length
        ? `${filedPrices.sources.map(priceSourceLabel).join(' + ')}${filedPrices.unpriced ? ` · ${filedPrices.unpriced} without comps` : ''}`
        : 'no comparables yet',
      // A failed chunk already returned above, so this total is either complete or absent.
      shelfFigure: values.length
        ? money.format(values.reduce((total, value) => total + value.haveTotal, 0))
        : null,
      shelfSource: values.length
        ? values.map((value) => priceSourceLabel(value.source)).join(' + ')
        : 'no comparables yet',
      // Pieces with no comps never enter the total, and the exclusion is stated.
      pieceNote: unpriced > 0 ? `${pieceWord} \u00b7 ${unpriced} without comps` : pieceWord,
    });
  };

  const advanceBulkPhoto = async (filedBatch: FiledBatch | null = null) => {
    const index = bulkIndexRef.current;
    const queue = bulkQueueRef.current;
    if (index === null || queue.length === 0) return;

    const previousBatch = bulkLastFiledRef.current;
    const transition = advanceBulkQueue(
      index,
      queue.length,
      previousBatch !== null,
      filedBatch !== null,
    );
    if (filedBatch) bulkLastFiledRef.current = filedBatch;

    if (transition.nextIndex !== null) {
      const nextIndex = transition.nextIndex;
      bulkIndexRef.current = nextIndex;
      setBulkIndex(nextIndex);
      void identifyWholeSet(queue[nextIndex], nextIndex);
      return;
    }

    const lastFiled = filedBatch ?? previousBatch;
    dropBulkQueue();
    if (!transition.filedAny || !lastFiled) {
      resetScan();
      return;
    }

    // ponytail: the final ledger covers the last filed photo; add a queue total only if collectors ask for one.
    const pieceCount = lastFiled.pieces.reduce((total, piece) => total + piece.count, 0);
    try {
      await presentFiled(lastFiled.pieces, () => lastFiled.headline);
    } catch {
      setFiledHeadline(lastFiled.headline);
      setLedger({
        itemFigure: null,
        itemSource: 'prices unavailable',
        shelfFigure: null,
        shelfSource: 'collection total unavailable',
        pieceNote: `${pieceCount} ${pieceCount === 1 ? 'piece' : 'pieces'} filed`,
      });
      setPhase('saved');
    }
  };

  /**
   * Files it, then shows the confirmation immediately and fills the money in when it
   * lands. The counts are local and instant; the comparables are a network round trip,
   * and holding a saved piece behind one would put a spinner between the user and the
   * thing they just did. The pending state still names a source, because a figure with
   * no claim behind it is the one thing that must not appear.
   */
  const fileItem = async (row: CatalogRow, status: OwnershipStatus, quantity: number) => {
    try {
      await setOwnership(row.slug, status, quantity);
    } catch {
      setPhase(browseDetail ? 'browse-detail' : 'results');
      setError('This item could not be added to your collection.');
      return;
    }

    const repeat = status === 'have' && quantity > 1
      ? ` and your ${ordinalWord(quantity) ?? ordinal(quantity)} ${row.patternName}`
      : '';
    await presentFiled(
      [{ itemSlug: row.slug, count: 1 }],
      (pieces) => status === 'want'
        ? `${row.patternName}, ${row.shape}. On your want list.`
        : `${row.patternName}, ${row.shape}. Your ${ordinal(pieces)} piece${repeat}.`,
    );
  };

  const fileSet = async () => {
    const setPhotoUri = photoUris[0];
    const filingPieces = setFilingPieces(setGroups, removedSetSlugs);
    if (!setPhotoUri || filingPieces.length === 0 || phaseRef.current !== 'set-results') return;
    const bulkRun = bulkIndexRef.current === null
      ? null
      : { generation: bulkGenerationRef.current, index: bulkIndexRef.current };
    const bulkRunIsCurrent = () =>
      !bulkRun || (
        bulkRun.generation === bulkGenerationRef.current &&
        bulkRun.index === bulkIndexRef.current
      );
    browseDetailTokenRef.current += 1;

    const pieceCount = filingPieces.reduce((total, piece) => total + piece.count, 0);
    setWaitCopy({
      title: 'Filing the set',
      caption: `${pieceCount} ${pieceCount === 1 ? 'piece' : 'pieces'} going into your file.`,
    });
    phaseRef.current = 'confirming';
    setPhase('confirming');
    setError(null);

    const filed: FiledPiece[] = [];
    for (const piece of filingPieces) {
      try {
        const existing = await getUserItem(piece.itemSlug);
        await setOwnership(
          piece.itemSlug,
          'have',
          (existing?.quantity ?? 0) + piece.count,
        );
        filed.push(piece);
      } catch {
        if (!bulkRunIsCurrent()) return;
        // CONTRACT: db.ts needs a transaction helper before filing a set can be atomic.
        const filedCount = filed.reduce((total, filedPiece) => total + filedPiece.count, 0);
        if (bulkRun && filedCount > 0) {
          bulkLastFiledRef.current = {
            pieces: filed,
            headline: `${filedCount} ${filedCount === 1 ? 'piece' : 'pieces'} filed from this photo.`,
          };
        }
        setRemovedSetSlugs((current) => [
          ...new Set([...current, ...filed.map(({ itemSlug }) => itemSlug)]),
        ]);
        phaseRef.current = 'set-results';
        setPhase('set-results');
        setError(
          filedCount
            ? `${filedCount} ${filedCount === 1 ? 'piece was' : 'pieces were'} filed. The remaining pieces could not be added.`
            : 'This set could not be added to your collection.',
        );
        return;
      }
    }

    if (!bulkRunIsCurrent()) return;

    void getSettings()
      .then((settings) => {
        if (!settings.trainingOptIn) return;
        // ponytail: logScan owns URI encoding, so each set piece re-encodes the shared frame; batch when this is measurable.
        return Promise.all(
          setScanLogInputs(
            setGroups,
            removedSetSlugs,
            setPhotoUri,
            settings.trainingOptIn,
          ).map((input) => logScan(input)),
        );
      })
      .catch(() => {});

    const headline = `${pieceCount} ${pieceCount === 1 ? 'piece' : 'pieces'} filed from this set.`;
    if (bulkRun) {
      await advanceBulkPhoto({ pieces: filed, headline });
      return;
    }
    try {
      await presentFiled(
        filed,
        () => headline,
      );
    } catch {
      setFiledHeadline(headline);
      setLedger({
        itemFigure: null,
        itemSource: 'prices unavailable',
        shelfFigure: null,
        shelfSource: 'collection total unavailable',
        pieceNote: `${pieceCount} ${pieceCount === 1 ? 'piece' : 'pieces'} filed`,
      });
      setPhase('saved');
    }
  };

  /**
   * One path for every way an item gets confirmed, a guess, a catalog row, or a pattern
   * the user just named. `logScan` fires on all of them, because the user telling us
   * which piece it is is the training signal regardless of what they do with it next.
   */
  const confirmRow = async (row: CatalogRow, status: OwnershipStatus) => {
    setWaitCopy({ title: 'Filing it away', caption: `${row.patternName}, ${formOf(row)}.` });
    setPhase('confirming');
    setError(null);

    // Dismissing the already-owned sheet and confirming the same row again is one
    // identification, not two, so it must not log a second time.
    if (loggedSlugRef.current !== row.slug) {
      loggedSlugRef.current = row.slug;
      try {
        const settings = await getSettings();
        // CONTRACT: api.ts must encode consented photoUris, and db.ts needs a pending-log queue
        // so offline confirmations and their llmWasRight labels survive a failed request.
        const result = await logScan({
          photoUris,
          guesses,
          confirmedItemSlug: row.slug,
          llmWasRight: deriveLlmWasRight(guesses, row.slug),
          consentedToTraining: settings.trainingOptIn,
          hasBaseShot: identifiedHasBaseShot,
        });
        if (!result.ok) setNotice('Confirmed locally. The scan history could not sync.');
      } catch {
        setNotice('Confirmed locally. The scan history could not sync.');
      }
    }

    if (reviewedScan) {
      try {
        await dequeueScan(reviewedScan.localId);
        await refreshQueuedCount();
      } catch {
        setNotice('Confirmed locally. The saved scan will finish cleaning up later.');
      }
    }

    if (status === 'have') {
      const existing = await getUserItem(row.slug);
      if (existing && existing.status === 'have' && existing.quantity > 0) {
        setOwned({
          row,
          quantity: existing.quantity,
          since: monthOf(existing.updatedAt),
        });
        setPhase('owned');
        return;
      }
    }

    await fileItem(row, status, status === 'want' ? 0 : 1);
  };

  const applySetCorrection = (replacementSlug: string) => {
    if (!correctingSlug) return;
    setSetGroups((current) =>
      replaceOrMergeDetectionGroup(current, correctingSlug, replacementSlug),
    );
    setRemovedSetSlugs((current) => current.filter((slug) => slug !== replacementSlug));
    browseDetailTokenRef.current += 1;
    setCorrectingSlug(null);
    setCatalogQuery('');
    setShapeFilter(null);
    setHuntingGuesses(null);
    setHuntingChip(null);
    setBrowseDetail(null);
    setError(null);
    setPhase('set-results');
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

    setWaitCopy({ title: 'Adding the pattern', caption: `Creating a catalog entry for ${patternName}.` });
    browseDetailTokenRef.current += 1;
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
      const rows = await loadCatalog();
      const created = rows.find((row) => row.slug === result.data.slug);
      await confirmRow(
        created ?? {
          slug: result.data.slug,
          patternId: patternName,
          formId: '',
          rarity: 'common',
          ebayQuery: patternName,
          userSubmitted: true,
          provenance: 'collector-attested',
          patternName,
          shape: 'Form not yet catalogued',
          modelNo: 'Unknown',
          colorway: null,
        },
        'have',
      );
    } catch {
      setPhase('browse');
      setError('The new pattern could not be submitted.');
    }
  };

  const submitCombination = async () => {
    const pattern = knownCombination.patterns.find(({ id }) => id === knownPatternId);
    const form = knownCombination.forms.find(({ id }) => id === knownFormId);
    if (!pattern || !form) {
      setError('Choose a known pattern and an existing form.');
      return;
    }
    if (isOffline) {
      setError('Adding a form needs a connection. Catalog browsing still works offline.');
      return;
    }

    setWaitCopy({
      title: 'Adding the combination',
      caption: `${pattern.name}, ${formOf({ shape: form.shape, modelNo: form.modelNo })}.`,
    });
    setPhase('confirming');
    setError(null);

    try {
      const result = await submitKnownCombination(pattern.id, form.id);
      if (!result.ok) {
        setPhase('known-combination');
        setError(result.error);
        return;
      }

      let rows = catalog;
      try {
        const refreshed = await fetchCatalog(0);
        if (refreshed.ok) {
          await syncCatalog(refreshed.data);
          rows = await loadCatalog();
        } else {
          setNotice('Added to the shared catalog. This phone will refresh its saved copy later.');
        }
      } catch {
        setNotice('Added to the shared catalog. This phone will refresh its saved copy later.');
      }

      const patternRow = catalog.find((row) => row.patternId === pattern.id);
      const patternDefinition = knownDefinitions?.patterns.find(({ id }) => id === pattern.id);
      await confirmRow(
        rows.find((row) => row.slug === result.data.slug) ?? {
          ...result.data,
          patternName: pattern.name,
          shape: form.shape,
          modelNo: form.modelNo,
          colorway: patternDefinition?.colorway ?? patternRow?.colorway ?? null,
        },
        'have',
      );
    } catch {
      setPhase('known-combination');
      setError('The combination could not be added.');
    }
  };

  const openKnownCombination = async () => {
    const request = ++knownDefinitionsTokenRef.current;
    phaseRef.current = 'known-combination';
    setKnownPatternId(null);
    setKnownFormId(null);
    setKnownCombinationQuery('');
    setKnownDefinitions(null);
    setKnownPatternDetail(null);
    setError(null);
    setPhase('known-combination');
    if (isOffline) return;

    const result = await fetchCatalog(0);
    if (request !== knownDefinitionsTokenRef.current) return;
    if (result.ok) {
      setKnownDefinitions({ patterns: result.data.patterns, forms: result.data.forms });
    } else {
      setError('The full pattern file could not be refreshed. Showing patterns already paired with a form.');
    }
  };

  const openKnownPatternDetail = async (patternId: string) => {
    const request = ++knownPatternTokenRef.current;
    setError(null);
    try {
      const pattern = knownDefinitions?.patterns.find(({ id }) => id === patternId) ??
        await getPattern(patternId);
      if (
        request !== knownPatternTokenRef.current ||
        phaseRef.current !== 'known-combination'
      ) return;
      if (!pattern) {
        setError('The saved pattern facts could not be opened.');
        return;
      }
      setKnownPatternDetail(pattern);
    } catch {
      if (
        request === knownPatternTokenRef.current &&
        phaseRef.current === 'known-combination'
      ) setError('The saved pattern facts could not be opened.');
    }
  };

  const openBrowse = (
    correctionSlug: string | null = null,
    rejectedGuesses: ScanGuess[] | null = null,
  ) => {
    browseDetailTokenRef.current += 1;
    knownDefinitionsTokenRef.current += 1;
    knownPatternTokenRef.current += 1;
    phaseRef.current = 'browse';
    setCorrectingSlug(correctionSlug);
    setCatalogQuery('');
    setShapeFilter(null);
    setHuntingGuesses(rejectedGuesses);
    setHuntingChip(null);
    setBrowseDetail(null);
    setKnownPatternId(null);
    setKnownFormId(null);
    setKnownCombinationQuery('');
    setKnownDefinitions(null);
    setKnownPatternDetail(null);
    setError(null);
    setPhase('browse');
  };

  const openBrowseDetail = async (row: CatalogRow, readOnly = false) => {
    const request = ++browseDetailTokenRef.current;
    setError(null);
    try {
      const [pattern, form] = await Promise.all([
        getPattern(row.patternId),
        getForm(row.formId),
      ]);
      if (!shouldPresentBrowseDetail(request, browseDetailTokenRef.current, phaseRef.current)) return;
      if (!pattern) {
        setError('The saved pattern details could not be opened.');
        return;
      }
      setBrowseDetail({ row, pattern, form, readOnly });
      setPhase('browse-detail');
    } catch {
      if (!shouldPresentBrowseDetail(request, browseDetailTokenRef.current, phaseRef.current)) return;
      setError('The saved pattern details could not be opened.');
    }
  };

  // The scan flow runs full-bleed, so the tab bar hides for the whole of it. It is a
  // native tab bar owned by `components/app-tabs.tsx` and not reachable from a screen:
  // a caller wanting it hidden has to do it there, on the route, not here.
  const screen = renderPhase();

  function renderPhase() {
    const renderOwnedSheet = (dismissPhase: 'results' | 'browse-detail') =>
      phase === 'owned' && owned ? (
        <AlreadyOwnedSheet
          row={owned.row}
          quantity={owned.quantity}
          since={owned.since}
          addLabel={
            ordinalWord(owned.quantity + 1)
              ? `Add a ${ordinalWord(owned.quantity + 1)}`
              : 'Add another'
          }
          onAdd={() => void fileItem(owned.row, 'have', owned.quantity + 1)}
          onOpen={() => {
            const slug = owned.row.slug;
            void leaveScan().then((left) => {
              if (left) router.push({ pathname: '/item/[slug]', params: { slug } });
            });
          }}
          onDismiss={() => {
            setOwned(null);
            setPhase(dismissPhase);
          }}
        />
      ) : null;

    if (phase === 'set-results') {
      return (
        <SetResultsScreen
          photoUri={photoUris[0]}
          items={setResultItems}
          contradicted={contradicted}
          banner={banner}
          problem={error}
          {...(bulkIndex !== null
            ? {
                bulkProgress: bulkProgress ?? undefined,
                onSkip: () => {
                  if (phaseRef.current !== 'set-results') return;
                  phaseRef.current = 'identifying';
                  void advanceBulkPhoto();
                },
                ...(error && setResultItems.length === 0
                  ? {
                      onRetry: () => {
                        if (phaseRef.current !== 'set-results') return;
                        const current = bulkIndexRef.current;
                        const uri = current === null ? undefined : bulkQueueRef.current[current];
                        if (current !== null && uri) {
                          phaseRef.current = 'identifying';
                          void identifyWholeSet(uri, current, true);
                        }
                      },
                    }
                  : {}),
              }
            : {})}
          onDetails={(row) => void openBrowseDetail(row, true)}
          onAdjustCount={(slug, delta) => {
            setSetGroups((current) => adjustSetGroupCount(current, slug, delta));
            setError(null);
          }}
          onRemove={(slug) => {
            browseDetailTokenRef.current += 1;
            setRemovedSetSlugs((current) => [...current, slug]);
            setError(null);
          }}
          onWrong={(slug) => {
            const group = setGroups.find(({ itemSlug }) => itemSlug === slug);
            openBrowse(slug, [{
              itemSlug: slug,
              confidence: group?.maxConfidence ?? 0,
              reasoning: group?.evidence[0] ?? 'Set scan match',
            }]);
          }}
          onFile={() => void fileSet()}
          onRetake={retakeSet}
        />
      );
    }

    if (phase === 'browse') {
      return (
        <BrowseScreen
          rows={browseRows}
          total={huntingRows.length}
          query={catalogQuery}
          onQuery={setCatalogQuery}
          shapes={shapes}
          shapeFilter={shapeFilter}
          onShapeFilter={setShapeFilter}
          hunting={huntingGuesses !== null}
          huntingChips={huntingChips}
          activeHuntingChip={huntingChip}
          onHuntingChip={(chip) => {
            setHuntingChip(chip);
            setShapeFilter(null);
          }}
          {...(reviewedScan ? { savedScanRemaining: queuedCount } : {})}
          banner={banner}
          problem={error}
          offline={isOffline}
          unknownName={unknownPatternName}
          onUnknownName={setUnknownPatternName}
          onSubmitUnknown={() => void submitUnknown()}
          onAddKnownCombination={() => void openKnownCombination()}
          onBack={() => {
            if (!correctingSlug) {
              void leaveScan();
              return;
            }
            browseDetailTokenRef.current += 1;
            setCorrectingSlug(null);
            setCatalogQuery('');
            setShapeFilter(null);
            setHuntingGuesses(null);
            setHuntingChip(null);
            setBrowseDetail(null);
            setError(null);
            setPhase('set-results');
          }}
          onPick={(row) => void openBrowseDetail(row)}
        />
      );
    }

    if (phase === 'known-combination') {
      return (
        <KnownCombinationScreen
          patterns={knownCombination.patterns}
          forms={knownCombination.forms}
          selectedPatternId={knownPatternId}
          selectedFormId={knownFormId}
          patternDetail={knownPatternDetail}
          query={knownCombinationQuery}
          banner={banner}
          problem={error}
          offline={isOffline}
          onQuery={setKnownCombinationQuery}
          onPattern={(patternId) => void openKnownPatternDetail(patternId)}
          onConfirmPattern={() => {
            if (!knownPatternDetail) return;
            setKnownPatternId(knownPatternDetail.id);
            setKnownFormId(null);
            setKnownPatternDetail(null);
            setKnownCombinationQuery('');
            setError(null);
          }}
          onForm={(formId) => {
            setKnownFormId(formId);
            setKnownCombinationQuery('');
            setError(null);
          }}
          onBack={() => {
            browseDetailTokenRef.current += 1;
            knownPatternTokenRef.current += 1;
            if (knownPatternDetail) {
              setKnownPatternDetail(null);
              setError(null);
              return;
            }
            if (knownFormId) {
              setKnownFormId(null);
              setKnownCombinationQuery('');
              return;
            }
            if (knownPatternId) {
              setKnownPatternId(null);
              setKnownCombinationQuery('');
              return;
            }
            knownDefinitionsTokenRef.current += 1;
            phaseRef.current = 'browse';
            setError(null);
            setPhase('browse');
          }}
          onConfirm={() => void submitCombination()}
        />
      );
    }

    if ((phase === 'browse-detail' || phase === 'owned') && browseDetail) {
      return (
        <>
          <BrowseDetailScreen
            row={browseDetail.row}
            pattern={browseDetail.pattern}
            form={browseDetail.form}
            banner={banner}
            problem={error}
            {...(browseDetail.readOnly
              ? { readOnly: true as const }
              : {
                  actionLabel: 'It’s this one',
                  onAdd: () => correctingSlug
                    ? applySetCorrection(browseDetail.row.slug)
                    : void confirmRow(browseDetail.row, 'have'),
                })}
            onBack={() => {
              browseDetailTokenRef.current += 1;
              setBrowseDetail(null);
              setError(null);
              setPhase(browseDetail.readOnly ? 'set-results' : 'browse');
            }}
          />
          {renderOwnedSheet('browse-detail')}
        </>
      );
    }

    if (phase === 'saved' && ledger) {
      return (
        <FiledScreen
          headline={filedHeadline}
          ledger={ledger}
          photoInvites={photoInvites}
          onPhotoInvite={(slug) => {
            const sharePhotoUri = scanMode === 'single' ? photoUris[0] : undefined;
            void leaveScan(Boolean(sharePhotoUri)).then((left) => {
              if (!left) return;
              router.push({
                pathname: '/item/[slug]',
                params: sharePhotoUri ? { slug, sharePhotoUri } : { slug },
              });
            });
          }}
          onSeeFile={() => {
            void leaveScan().then((left) => {
              if (left) router.push('/collection');
            });
          }}
          onScanAnother={() => void leaveScan()}
        />
      );
    }

    if (phase === 'results' || phase === 'owned') {
      const candidates = guesses
        .slice(0, 3)
        .map((guess) => ({ guess, row: guessRows.find((row) => row.slug === guess.itemSlug) }))
        .filter((entry): entry is { guess: ScanGuess; row: CatalogRow } => Boolean(entry.row));
      const selected = candidates.find((entry) => entry.row.slug === selectedSlug)?.row ?? null;

      return (
        <>
          <ResultScreen
            photoUris={photoUris}
            candidates={candidates}
            selectedSlug={selectedSlug}
            selectedPattern={selectedPattern?.id === selected?.patternId ? selectedPattern : null}
            {...(reviewedScan ? { savedScanRemaining: queuedCount } : {})}
            banner={banner}
            problem={error}
            busy={phase === 'owned'}
            onSelect={setSelectedSlug}
            onConfirm={() => selected && void confirmRow(selected, 'have')}
            onWant={() => selected && void confirmRow(selected, 'want')}
            onNone={() => openBrowse(null, guesses)}
            onRetake={() => void leaveScan()}
          />
          {renderOwnedSheet('results')}
        </>
      );
    }

    if (phase === 'identifying' || phase === 'confirming') {
      return (
        <IdentifyingScreen title={waitCopy.title} caption={waitCopy.caption} banner={banner} />
      );
    }

    if (!permission) {
      return <PermissionScreen mode="checking" onRequest={() => {}} onBrowse={() => openBrowse()} />;
    }
    if (permission.status === PermissionStatus.UNDETERMINED) {
      return (
        <PermissionScreen
          mode="undetermined"
          onRequest={() => void requestPermission()}
          onBrowse={() => openBrowse()}
        />
      );
    }
    if (!permission.granted) {
      return (
        <PermissionScreen
          mode="denied"
          onRequest={() => void Linking.openSettings()}
          onBrowse={() => openBrowse()}
        />
      );
    }

    return (
      <ViewfinderScreen
        mode={scanMode}
        showModeToggle={photoUris.length === 0}
        pendingImportCount={bulkIndex === null ? bulkPhotoUris.length : 0}
        step={needsBaseShot ? 2 : 1}
        banner={banner}
        bannerActions={bannerActions}
        problem={error}
        busy={capturing || confirmingDiscard || !cameraReady || bulkPhotoUris.length > 0}
        cameraRef={cameraRef}
        onCameraReady={() => setCameraReady(true)}
        onMountError={setError}
        onCapture={() => void captureFrame()}
        onImport={() => void chooseBulkPhotos()}
        onConfirmImport={confirmBulkImport}
        onCancelImport={dropBulkQueue}
        onBack={() => setPhotoUris([])}
        onSkip={() => void identifyBurst(photoUris, false)}
        onModeChange={(mode) => {
          setScanMode(mode);
          setNotice(null);
          setError(null);
        }}
      />
    );
  }

  return (
    <View style={styles.root}>
      {screen}
      <ShutterFlash visible={flashing} />
    </View>
  );
}

function formOf(row: Pick<CatalogRow, 'shape' | 'modelNo'>): string {
  return `${row.shape} ${row.modelNo}`;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
