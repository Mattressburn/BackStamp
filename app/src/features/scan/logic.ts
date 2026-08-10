import type { ApiErrorCode, ScanGuess } from '@shared/types';

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
