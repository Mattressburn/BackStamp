/**
 * Two strings the item card prints about things outside itself: where this piece sits
 * in the file, and what the offline banner says about the upload queue.
 *
 * They live here rather than inside the screen because both are arithmetic that goes
 * quietly wrong, the position is stale the moment `setOwnership` bumps `updated_at`,
 * and the banner is a lie at a queue of zero, and the test glob only reaches `.ts`.
 */

import type { UserItem } from '@shared/types';

export interface CardPosition {
  /** 1-based, as printed. */
  index: number;
  total: number;
}

/**
 * Where the piece sits in the tab it is filed under.
 *
 * The ordering is whatever `getCollection()` returned, which `collection.tsx` then
 * filters by tab, so counting within the same-status subsequence of that list is the
 * position the user actually sees. A piece in neither list has no card number, and
 * `cardLabel` says so rather than inventing one.
 */
export function cardPosition(
  collection: readonly UserItem[],
  slug: string,
): CardPosition | null {
  const entry = collection.find((item) => item.itemSlug === slug);
  if (!entry) return null;

  const tab = collection.filter((item) => item.status === entry.status);
  return { index: tab.findIndex((item) => item.itemSlug === slug) + 1, total: tab.length };
}

/** The label above the card. Uppercased by `Type.label`, so this is sentence case. */
export function cardLabel(position: CardPosition | null): string {
  return position ? `Card ${position.index} of ${position.total}` : 'Not in your file';
}

/**
 * The offline banner. The queue clause is dropped entirely at zero rather than printed
 * as "0 scans waiting", which would read as a fault instead of an empty queue.
 */
export function offlineNotice(queued: number): string {
  const base = 'No connection. Showing the copy on this phone';
  if (queued <= 0) return `${base}.`;
  return `${base}. ${queued} scan${queued === 1 ? '' : 's'} waiting to upload.`;
}
