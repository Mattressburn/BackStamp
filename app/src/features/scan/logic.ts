import type {
  ApiErrorCode,
  Form,
  Pattern,
  PriceQuote,
  PriceSourceKind,
  ScanGuess,
  SetDetection,
} from '@shared/types';

const MAX_QUEUE_ATTEMPTS = 3;

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

export interface GroupedDetection {
  itemSlug: string;
  count: number;
  maxConfidence: number;
  evidence: string[];
}

export function groupDetections(detections: SetDetection[]): GroupedDetection[] {
  const grouped = new Map<string, GroupedDetection>();

  for (const detection of detections) {
    const row = grouped.get(detection.itemSlug);
    if (row) {
      row.count += 1;
      row.maxConfidence = Math.max(row.maxConfidence, detection.confidence);
      row.evidence.push(detection.visibleEvidence);
    } else {
      grouped.set(detection.itemSlug, {
        itemSlug: detection.itemSlug,
        count: 1,
        maxConfidence: detection.confidence,
        evidence: [detection.visibleEvidence],
      });
    }
  }

  return [...grouped.values()];
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
  const merged: GroupedDetection = {
    itemSlug: replacementSlug,
    count: corrected.count + replacement.count,
    maxConfidence: Math.max(corrected.maxConfidence, replacement.maxConfidence),
    evidence,
  };

  return groups.flatMap((group, index) => {
    if (index === firstIndex) return [merged];
    return index === correctedIndex || index === replacementIndex ? [] : [group];
  });
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
