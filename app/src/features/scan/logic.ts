import type {
  ApiErrorCode,
  ApiResult,
  Form,
  ItemDetail,
  Pattern,
  PriceQuote,
  PriceSourceKind,
  QueuedScan,
  ScanGuess,
  SetDetection,
} from '@shared/types';
import type { CatalogRow } from '@/db';

const MAX_QUEUE_ATTEMPTS = 3;
const MAX_SET_GROUP_COUNT = 9;

type HuntingRow = Pick<
  CatalogRow,
  'slug' | 'patternId' | 'formId' | 'patternName' | 'modelNo'
>;

export type HuntingChip = {
  kind: 'pattern' | 'model';
  value: string;
  label: string;
};

export function rankHuntingRows<T extends HuntingRow>(
  guesses: readonly ScanGuess[],
  rows: readonly T[],
): T[] {
  const rejected = new Set(guesses.map(({ itemSlug }) => itemSlug));
  const guessedRows = guesses.map(({ itemSlug }) =>
    rows.find(({ slug }) => slug === itemSlug),
  );

  return rows
    .flatMap((row, catalogIndex) => rejected.has(row.slug) ? [] : [{
      row,
      catalogIndex,
      score: guessedRows.reduce((score, guess, guessIndex) => {
        if (!guess) return score;
        const patternWeight = 2 ** ((guesses.length - guessIndex) * 2);
        return score +
          (row.patternId === guess.patternId ? patternWeight : 0) +
          (row.formId === guess.formId ? patternWeight / 2 : 0);
      }, 0),
    }])
    .sort((a, b) => b.score - a.score || a.catalogIndex - b.catalogIndex)
    .map(({ row }) => row);
}

export function deriveHuntingChips(
  guesses: readonly ScanGuess[],
  rows: readonly HuntingRow[],
): HuntingChip[] {
  const guessedRows = guesses.flatMap(({ itemSlug }) => {
    const row = rows.find(({ slug }) => slug === itemSlug);
    return row ? [row] : [];
  });
  const patternIds = new Set<string>();
  const modelNumbers = new Set<string>();

  return [
    ...guessedRows.flatMap((row): HuntingChip[] => {
      if (patternIds.has(row.patternId)) return [];
      patternIds.add(row.patternId);
      return [{ kind: 'pattern', value: row.patternId, label: `All ${row.patternName} pieces` }];
    }),
    ...guessedRows.flatMap((row): HuntingChip[] => {
      if (modelNumbers.has(row.modelNo)) return [];
      modelNumbers.add(row.modelNo);
      return [{ kind: 'model', value: row.modelNo, label: `All ${row.modelNo}s` }];
    }),
  ];
}

export function bulkPhotoProgress(index: number, total: number): string {
  return `Photo ${index + 1} of ${total}`;
}

export function advanceBulkQueue(
  index: number,
  total: number,
  filedAny: boolean,
  filedCurrent: boolean,
): { nextIndex: number | null; filedAny: boolean } {
  return {
    nextIndex: index + 1 < total ? index + 1 : null,
    filedAny: filedAny || filedCurrent,
  };
}

export function deriveLlmWasRight(
  guesses: ScanGuess[],
  confirmedItemSlug: string,
): boolean {
  return guesses[0]?.itemSlug === confirmedItemSlug;
}

export function shouldRetryQueueDrain(
  code: ApiErrorCode,
  previousAttempts: number,
): boolean {
  return (
    previousAttempts < MAX_QUEUE_ATTEMPTS - 1 &&
    (code === 'upstream_failed' || code === 'rate_limited' || code === 'internal')
  );
}

export function savedScanBannerMessage(
  count: number,
  confirmingDiscard: boolean,
): string | null {
  if (count < 1) return null;
  const scans = `${count} saved scan${count === 1 ? '' : 's'}`;
  return confirmingDiscard ? `Discard ${scans}?` : `${scans} ready to review.`;
}

export function oldestSavedScan(scans: readonly QueuedScan[]): QueuedScan | null {
  let oldest = scans[0] ?? null;
  for (const scan of scans) {
    if (oldest && scan.createdAt < oldest.createdAt) oldest = scan;
  }
  return oldest;
}

/** "25th". The 11/12/13 exception is the only reason this is not a lookup. */
export function ordinal(n: number): string {
  const teens = n % 100;
  const suffix =
    teens >= 11 && teens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}

const ORDINAL_WORDS = [
  'zeroth', 'first', 'second', 'third', 'fourth', 'fifth',
  'sixth', 'seventh', 'eighth', 'ninth', 'tenth',
] as const;

/**
 * "third", for the places the design writes the count into a sentence ("Add a third",
 * "your third Spring Blossom"). Null past ten, where "a" stops being the right article
 * and the caller should fall back to a numeral or to generic wording.
 */
export function ordinalWord(n: number): string | null {
  return ORDINAL_WORDS[n] ?? null;
}

export function browseDetailFacts(
  pattern: Pick<Pattern, 'yearsStart' | 'yearsEnd'>,
  form: Pick<Form, 'capacityQt' | 'dimensions'> | null,
): { productionYears: string | null; measurements: string | null } {
  const productionYears = pattern.yearsStart !== null && pattern.yearsEnd !== null
    ? `${pattern.yearsStart}–${pattern.yearsEnd}`
    : pattern.yearsStart !== null
      ? `${pattern.yearsStart} onward`
      : pattern.yearsEnd !== null
        ? `Through ${pattern.yearsEnd}`
        : null;
  const measurements = [
    form?.capacityQt !== null && form?.capacityQt !== undefined ? `${form.capacityQt} qt` : null,
    form?.dimensions,
  ].filter(Boolean).join(' · ') || null;

  return { productionYears, measurements };
}

export function shouldPresentBrowseDetail(
  request: number,
  currentRequest: number,
  phase: string,
): boolean {
  return request === currentRequest && (phase === 'browse' || phase === 'set-results');
}

export function knownCombinationOptions(
  rows: readonly {
    patternId: Pattern['id'];
    patternName: Pattern['name'];
    formId: Form['id'];
    shape: Form['shape'];
    modelNo: Form['modelNo'];
  }[],
  selectedPatternId: Pattern['id'] | null,
  definitions?: {
    patterns: readonly Pick<Pattern, 'id' | 'name'>[];
    forms: readonly Pick<Form, 'id' | 'shape' | 'modelNo'>[];
  },
): {
  patterns: Pick<Pattern, 'id' | 'name'>[];
  forms: Pick<Form, 'id' | 'shape' | 'modelNo'>[];
} {
  const patterns = new Map<Pattern['id'], Pick<Pattern, 'id' | 'name'>>();
  const forms = new Map<Form['id'], Pick<Form, 'id' | 'shape' | 'modelNo'>>();
  const usedForms = new Set<Form['id']>();

  for (const pattern of definitions?.patterns ?? []) {
    patterns.set(pattern.id, { id: pattern.id, name: pattern.name });
  }
  for (const form of definitions?.forms ?? []) {
    forms.set(form.id, { id: form.id, shape: form.shape, modelNo: form.modelNo });
  }

  for (const row of rows) {
    patterns.set(row.patternId, { id: row.patternId, name: row.patternName });
    forms.set(row.formId, { id: row.formId, shape: row.shape, modelNo: row.modelNo });
    if (row.patternId === selectedPatternId) usedForms.add(row.formId);
  }

  return {
    patterns: [...patterns.values()],
    forms: selectedPatternId
      ? [...forms.values()].filter((form) => !usedForms.has(form.id))
      : [],
  };
}

export interface GroupedDetection {
  itemSlug: string;
  count: number;
  maxConfidence: number;
  evidence: string[];
  detections: SetDetection[];
}

export function groupDetections(detections: SetDetection[]): GroupedDetection[] {
  const grouped = new Map<string, GroupedDetection>();

  for (const detection of detections) {
    const row = grouped.get(detection.itemSlug);
    if (row) {
      row.count += 1;
      row.maxConfidence = Math.max(row.maxConfidence, detection.confidence);
      row.evidence.push(detection.visibleEvidence);
      row.detections.push(detection);
    } else {
      grouped.set(detection.itemSlug, {
        itemSlug: detection.itemSlug,
        count: 1,
        maxConfidence: detection.confidence,
        evidence: [detection.visibleEvidence],
        detections: [detection],
      });
    }
  }

  return [...grouped.values()];
}

export function adjustSetGroupCount(
  groups: GroupedDetection[],
  itemSlug: string,
  delta: number,
): GroupedDetection[] {
  const index = groups.findIndex((group) => group.itemSlug === itemSlug);
  if (index < 0) return groups;

  const count = Math.min(MAX_SET_GROUP_COUNT, Math.max(1, groups[index].count + delta));
  if (count === groups[index].count) return groups;
  return groups.map((group, groupIndex) =>
    groupIndex === index ? { ...group, count } : group,
  );
}

export function setFilingPieces(
  groups: readonly GroupedDetection[],
  removedSlugs: readonly string[],
) {
  const removed = new Set(removedSlugs);
  return groups.flatMap((group) =>
    removed.has(group.itemSlug) ? [] : [{ itemSlug: group.itemSlug, count: group.count }],
  );
}

export function replaceOrMergeDetectionGroup(
  groups: GroupedDetection[],
  correctedSlug: string,
  replacementSlug: string,
): GroupedDetection[] {
  const correctedIndex = groups.findIndex((group) => group.itemSlug === correctedSlug);
  if (correctedIndex < 0 || correctedSlug === replacementSlug) return groups;

  const replacementIndex = groups.findIndex((group) => group.itemSlug === replacementSlug);
  if (replacementIndex < 0) {
    return groups.map((group, index) =>
      index === correctedIndex ? { ...group, itemSlug: replacementSlug } : group,
    );
  }

  const firstIndex = Math.min(correctedIndex, replacementIndex);
  const corrected = groups[correctedIndex];
  const replacement = groups[replacementIndex];
  const evidence = correctedIndex < replacementIndex
    ? [...corrected.evidence, ...replacement.evidence]
    : [...replacement.evidence, ...corrected.evidence];
  const detections = correctedIndex < replacementIndex
    ? [...corrected.detections, ...replacement.detections]
    : [...replacement.detections, ...corrected.detections];
  const merged: GroupedDetection = {
    itemSlug: replacementSlug,
    count: corrected.count + replacement.count,
    maxConfidence: Math.max(corrected.maxConfidence, replacement.maxConfidence),
    evidence,
    detections,
  };

  return groups.flatMap((group, index) => {
    if (index === firstIndex) return [merged];
    return index === correctedIndex || index === replacementIndex ? [] : [group];
  });
}

export function setScanLogInputs(
  groups: readonly GroupedDetection[],
  removedSlugs: readonly string[],
  photoUri: string,
  consentedToTraining: boolean,
) {
  const removed = new Set(removedSlugs);
  return groups.flatMap((group) => {
    if (removed.has(group.itemSlug)) return [];
    // Manual count changes have no detection evidence, so training stays one row per detection.
    return group.detections.map((detection) => ({
      photoUris: [photoUri],
      guesses: [{
        itemSlug: detection.itemSlug,
        confidence: detection.confidence,
        reasoning: detection.visibleEvidence,
      }],
      confirmedItemSlug: group.itemSlug,
      llmWasRight: detection.itemSlug === group.itemSlug,
      consentedToTraining,
      hasBaseShot: false,
      source: 'set' as const,
    }));
  });
}

export function photoInvitesFor(
  results: readonly ApiResult<ItemDetail>[],
): { slug: string; label: string }[] {
  return results.flatMap((result) =>
    result.ok && !result.data.photos.some((photo) => photo.isAiPlaceholder === false)
      ? [{
          slug: result.data.slug,
          label: `${result.data.pattern.name} ${result.data.form.modelNo}`,
        }]
      : [],
  );
}

export function summarizeFiledPrices(
  pieces: readonly { itemSlug: string; count: number }[],
  quotes: readonly PriceQuote[],
): {
  low: number | null;
  high: number | null;
  sources: PriceSourceKind[];
  unpriced: number;
} {
  const quoteBySlug = new Map(quotes.map((quote) => [quote.itemSlug, quote]));
  const sources = new Set<PriceSourceKind>();
  let low = 0;
  let high = 0;
  let priced = 0;
  let unpriced = 0;

  for (const piece of pieces) {
    const quote = quoteBySlug.get(piece.itemSlug);
    if (!quote) {
      unpriced += piece.count;
      continue;
    }
    low += quote.low * piece.count;
    high += quote.high * piece.count;
    priced += piece.count;
    sources.add(quote.source);
  }

  return {
    low: priced ? low : null,
    high: priced ? high : null,
    sources: [...sources],
    unpriced,
  };
}
