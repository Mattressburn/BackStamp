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
 * so a burst captured with no connection is written to SQLite as file URIs and drained
 * later; the queue is never base64, and a queued burst that comes back while the user is
 * still holding the camera does not yank them off it.
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

import { fetchPrices, identify, identifySet, logScan, submitUnknownPattern } from '@/api';
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
  type CatalogRow,
} from '@/db';
import { calculateCollectionValues } from '@/features/collection/collection-total';
import { priceSourceLabel } from '@/features/collection/collection-ui';
import type {
  IdentifyResponse,
  IdentifySetResponse,
  Form,
  OwnershipStatus,
  Pattern,
  ScanGuess,
  SetDetection,
} from '@shared/types';
import {
  IdentifyingScreen,
  PermissionScreen,
  ShutterFlash,
  ViewfinderScreen,
} from './scan-camera';
import {
  AlreadyOwnedSheet,
  BrowseDetailScreen,
  BrowseScreen,
  FiledScreen,
  ResultScreen,
  SetResultsScreen,
  money,
  type FiledLedger,
  type SetResultItem,
} from './scan-results';
import {
  deriveLlmWasRight,
  groupDetections,
  ordinal,
  ordinalWord,
  shouldPresentBrowseDetail,
  shouldRetryQueueDrain,
  summarizeFiledPrices,
} from './logic';

type Phase =
  | 'camera'
  | 'identifying'
  | 'results'
  | 'set-results'
  | 'browse'
  | 'browse-detail'
  | 'confirming'
  | 'owned'
  | 'saved';

interface FiledPiece {
  itemSlug: string;
  count: number;
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

function queueLabel(count: number): string {
  return `${count} scan${count === 1 ? '' : 's'} waiting to upload.`;
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
  const drainingRef = useRef(false);
  const presentedQueuedIdRef = useRef<string | null>(null);
  const cameraIdleRef = useRef(true);
  const ledgerTokenRef = useRef(0);
  const loggedSlugRef = useRef<string | null>(null);
  const browseDetailTokenRef = useRef(0);
  const phaseRef = useRef<Phase>('camera');

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
  const [setDetections, setSetDetections] = useState<SetDetection[]>([]);
  const [removedSetSlugs, setRemovedSetSlugs] = useState<string[]>([]);
  const [contradicted, setContradicted] = useState(0);
  const [queuedCount, setQueuedCount] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waitCopy, setWaitCopy] = useState({ title: 'Reading the mark', caption: '' });
  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [shapeFilter, setShapeFilter] = useState<string | null>(null);
  const [browseDetail, setBrowseDetail] = useState<{
    row: CatalogRow;
    pattern: Pattern;
    form: Form | null;
  } | null>(null);
  const [unknownPatternName, setUnknownPatternName] = useState('');
  const [owned, setOwned] = useState<{ row: CatalogRow; quantity: number; since: string | null } | null>(null);
  const [filedHeadline, setFiledHeadline] = useState('');
  const [ledger, setLedger] = useState<FiledLedger | null>(null);

  const isOffline = netInfo.isConnected === false || netInfo.isInternetReachable === false;
  const canDrainQueue = netInfo.isConnected === true && netInfo.isInternetReachable !== false;
  const needsBaseShot = scanMode === 'single' && photoUris.length === 1;
  const cameraIdle = phase === 'camera' && photoUris.length === 0 && !capturing;
  cameraIdleRef.current = cameraIdle;
  phaseRef.current = phase;

  // Both facts, not one or the other: a notice must not swallow the queue count.
  const banner =
    [notice, queuedCount > 0 ? queueLabel(queuedCount) : null].filter(Boolean).join(' ') || null;

  const refreshQueuedCount = useCallback(async () => {
    const count = (await listQueuedScans()).length;
    setQueuedCount(Math.max(0, count - (presentedQueuedIdRef.current ? 1 : 0)));
  }, []);

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
      setPhase('browse');
      return;
    }
    setGuessRows(resolved);
    setSelectedSlug(resolved[0].slug);
    setPhase('results');
  }, [loadCatalog]);

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
            await presentIdentifyResponse(result.data, scan.photos, scan.hasBaseShot);
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
    void loadCatalog();
  }, [loadCatalog, refreshQueuedCount]);

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
    if (phase === 'browse') void loadCatalog().catch(() => setError('The saved catalog could not be opened.'));
  }, [loadCatalog, phase]);

  // The catalog is small enough to filter in memory, which keeps the field responsive
  // per keystroke and matches what `searchCatalog` matches on: pattern, form, model no.
  const browseRows = useMemo(() => {
    const query = catalogQuery.trim().toLowerCase();
    return catalog.filter((row) =>
      (!shapeFilter || row.shape === shapeFilter) &&
      (!query ||
        row.patternName.toLowerCase().includes(query) ||
        row.shape.toLowerCase().includes(query) ||
        row.modelNo.toLowerCase().includes(query)),
    );
  }, [catalog, catalogQuery, shapeFilter]);

  const setResultItems = useMemo<SetResultItem[]>(() => {
    const removed = new Set(removedSetSlugs);
    return groupDetections(setDetections).flatMap((group) => {
      const row = catalog.find((candidate) => candidate.slug === group.itemSlug);
      return row && !removed.has(group.itemSlug) ? [{ group, row }] : [];
    });
  }, [catalog, removedSetSlugs, setDetections]);

  /** The forms the catalog actually holds most of, rather than a written-in list. */
  const shapes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of catalog) counts.set(row.shape, (counts.get(row.shape) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, CHIP_COUNT)
      .map(([shape]) => shape);
  }, [catalog]);

  const resetScan = useCallback(() => {
    browseDetailTokenRef.current += 1;
    setPhase('camera');
    setScanMode('single');
    setCapturing(false);
    setFlashing(false);
    setPhotoUris([]);
    setIdentifiedHasBaseShot(false);
    setGuesses([]);
    setGuessRows([]);
    setSelectedSlug(null);
    setSetDetections([]);
    setRemovedSetSlugs([]);
    setContradicted(0);
    setNotice(null);
    setError(null);
    setCatalogQuery('');
    setShapeFilter(null);
    setBrowseDetail(null);
    setUnknownPatternName('');
    setOwned(null);
    setFiledHeadline('');
    setLedger(null);
    ledgerTokenRef.current += 1;
    loggedSlugRef.current = null;
  }, []);

  const retakeSet = useCallback(() => {
    resetScan();
    setScanMode('set');
  }, [resetScan]);

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
    setNotice('Saved offline. It will identify when your connection returns.');
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

  const presentSetResponse = async (response: IdentifySetResponse, photoUri: string) => {
    if (response.lowConfidence || response.detections.length === 0) {
      setPhotoUris([]);
      setPhase('camera');
      setError(
        'The set could not be read confidently. Switch to One piece and scan each dish separately.',
      );
      return;
    }

    const rows = await loadCatalog();
    const groups = groupDetections(response.detections);
    if (groups.some((group) => !rows.some((row) => row.slug === group.itemSlug))) {
      setPhotoUris([]);
      setPhase('camera');
      setError(
        'Some pieces were not in the saved catalog. Switch to One piece and scan each dish separately.',
      );
      return;
    }

    setPhotoUris([photoUri]);
    setSetDetections(response.detections);
    setRemovedSetSlugs([]);
    setContradicted(response.contradicted);
    setError(null);
    setPhase('set-results');
  };

  const identifyWholeSet = async (photoUri: string) => {
    setWaitCopy({
      title: 'Reading the whole set',
      caption: catalog.length
        ? `Matching each visible piece against ${catalog.length} catalogued pieces.`
        : 'Matching each visible piece against the catalog.',
    });
    setPhase('identifying');
    setError(null);
    try {
      const result = await identifySet(photoUri);
      if (result.ok) {
        await presentSetResponse(result.data, photoUri);
      } else {
        setPhotoUris([]);
        setPhase('camera');
        setError(result.error);
      }
    } catch {
      setPhotoUris([]);
      setPhase('camera');
      setError('The set photo could not be read. Please capture it again.');
    }
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
    cameraIdleRef.current = false;
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
    setPhase('saved');

    // A later scan, or a reset, invalidates this fill: the prices that come back belong
    // to the confirmation that asked for them and to no other.
    const token = (ledgerTokenRef.current += 1);
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
    if (setResultItems.length === 0) return;

    const pieceCount = setResultItems.reduce((total, item) => total + item.group.count, 0);
    setWaitCopy({
      title: 'Filing the set',
      caption: `${pieceCount} ${pieceCount === 1 ? 'piece' : 'pieces'} going into your file.`,
    });
    setPhase('confirming');
    setError(null);

    const filed: SetResultItem[] = [];
    for (const item of setResultItems) {
      try {
        const existing = await getUserItem(item.group.itemSlug);
        await setOwnership(
          item.group.itemSlug,
          'have',
          (existing?.quantity ?? 0) + item.group.count,
        );
        filed.push(item);
      } catch {
        // CONTRACT: db.ts needs a transaction helper before filing a set can be atomic.
        const filedCount = filed.reduce((total, filedItem) => total + filedItem.group.count, 0);
        setRemovedSetSlugs((current) => [
          ...new Set([...current, ...filed.map(({ group }) => group.itemSlug)]),
        ]);
        setPhase('set-results');
        setError(
          filedCount
            ? `${filedCount} ${filedCount === 1 ? 'piece was' : 'pieces were'} filed. The remaining pieces could not be added.`
            : 'This set could not be added to your collection.',
        );
        return;
      }
    }

    // ponytail: set scans skip logScan until the scans schema can store multiple confirmed slugs.
    const headline = `${pieceCount} ${pieceCount === 1 ? 'piece' : 'pieces'} filed from this set.`;
    try {
      await presentFiled(
        filed.map(({ group }) => ({ itemSlug: group.itemSlug, count: group.count })),
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

    const queuedId = presentedQueuedIdRef.current;
    if (queuedId) {
      try {
        await dequeueScan(queuedId);
        deleteQueuedPhotos(photoUris);
        presentedQueuedIdRef.current = null;
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
          patternName,
          shape: 'Form not yet catalogued',
          modelNo: '—',
          colorway: null,
        },
        'have',
      );
    } catch {
      setPhase('browse');
      setError('The new pattern could not be submitted.');
    }
  };

  const openBrowse = () => {
    browseDetailTokenRef.current += 1;
    setCatalogQuery('');
    setShapeFilter(null);
    setBrowseDetail(null);
    setError(null);
    setPhase('browse');
  };

  const openBrowseDetail = async (row: CatalogRow) => {
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
      setBrowseDetail({ row, pattern, form });
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
            resetScan();
            router.push({ pathname: '/item/[slug]', params: { slug } });
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
          onRemove={(slug) => {
            setRemovedSetSlugs((current) => [...current, slug]);
            setError(null);
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
          total={catalog.length}
          query={catalogQuery}
          onQuery={setCatalogQuery}
          shapes={shapes}
          shapeFilter={shapeFilter}
          onShapeFilter={setShapeFilter}
          banner={banner}
          problem={error}
          offline={isOffline}
          unknownName={unknownPatternName}
          onUnknownName={setUnknownPatternName}
          onSubmitUnknown={() => void submitUnknown()}
          onBack={resetScan}
          onPick={(row) => void openBrowseDetail(row)}
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
            onAdd={() => void confirmRow(browseDetail.row, 'have')}
            onBack={() => {
              browseDetailTokenRef.current += 1;
              setBrowseDetail(null);
              setError(null);
              setPhase('browse');
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
          onSeeFile={() => {
            resetScan();
            router.push('/collection');
          }}
          onScanAnother={resetScan}
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
            banner={banner}
            problem={error}
            busy={phase === 'owned'}
            onSelect={setSelectedSlug}
            onConfirm={() => selected && void confirmRow(selected, 'have')}
            onWant={() => selected && void confirmRow(selected, 'want')}
            onNone={openBrowse}
            onRetake={resetScan}
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
      return <PermissionScreen mode="checking" onRequest={() => {}} onBrowse={openBrowse} />;
    }
    if (permission.status === PermissionStatus.UNDETERMINED) {
      return (
        <PermissionScreen
          mode="undetermined"
          onRequest={() => void requestPermission()}
          onBrowse={openBrowse}
        />
      );
    }
    if (!permission.granted) {
      return (
        <PermissionScreen
          mode="denied"
          onRequest={() => void Linking.openSettings()}
          onBrowse={openBrowse}
        />
      );
    }

    return (
      <ViewfinderScreen
        mode={scanMode}
        showModeToggle={photoUris.length === 0}
        step={needsBaseShot ? 2 : 1}
        banner={banner}
        problem={error}
        busy={capturing || !cameraReady}
        cameraRef={cameraRef}
        onCameraReady={() => setCameraReady(true)}
        onMountError={setError}
        onCapture={() => void captureFrame()}
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

function formOf(row: CatalogRow): string {
  return `${row.shape} ${row.modelNo}`;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
