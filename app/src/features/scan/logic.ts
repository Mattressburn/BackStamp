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
