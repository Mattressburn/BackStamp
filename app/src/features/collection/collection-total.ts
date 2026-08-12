import type { CollectionValue, PriceQuote, PriceSourceKind, UserItem } from '@shared/types';

const SOURCES: PriceSourceKind[] = ['sold', 'active'];

export function countOwnedPieces(items: readonly UserItem[]): number {
  return items.reduce(
    (total, item) => item.status === 'have' ? total + item.quantity : total,
    0,
  );
}

export function calculateCollectionValues(
  items: readonly UserItem[],
  quotes: readonly PriceQuote[],
): CollectionValue[] {
  const quoteBySlug = new Map(quotes.map((quote) => [quote.itemSlug, quote]));
  const itemsUnpriced = items.filter((item) => !quoteBySlug.has(item.itemSlug)).length;

  return SOURCES.flatMap((source) => {
    const priced = items.flatMap((item) => {
      const quote = quoteBySlug.get(item.itemSlug);
      return quote?.source === source ? [{ item, quote }] : [];
    });

    if (priced.length === 0) return [];

    return [{
      haveTotal: priced.reduce(
        (total, { item, quote }) =>
          item.status === 'have' ? total + quote.median * item.quantity : total,
        0,
      ),
      wantTotal: priced.reduce(
        (total, { item, quote }) => item.status === 'want' ? total + quote.median : total,
        0,
      ),
      source,
      itemsPriced: priced.length,
      itemsUnpriced,
    }];
  });
}
