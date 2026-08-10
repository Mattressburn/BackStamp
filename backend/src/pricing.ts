import type { Item, PriceQuote, PriceSourceKind } from '@shared/types.js';

import type { BackendDatabase } from './db.js';

export interface PriceSource {
  fetch(item: Item): Promise<PriceQuote | null>;
}

interface SoldCompsResponse {
  items?: Array<{
    bestOfferAccepted?: unknown;
    endedAt?: unknown;
    soldCurrency?: unknown;
    soldPrice?: unknown;
  }>;
}

interface EbayBrowseResponse {
  itemSummaries?: Array<{ price?: { currency?: unknown; value?: unknown } }>;
}

interface EbayTokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
}

export function quoteFromPrices(
  itemSlug: string,
  source: PriceSourceKind,
  prices: number[],
  fetchedAt = new Date().toISOString(),
): PriceQuote | null {
  const sorted = prices.filter((price) => Number.isFinite(price) && price > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
      : (sorted[middle] as number);
  return {
    itemSlug,
    source,
    low: sorted[0] as number,
    median: Math.round(median * 100) / 100,
    high: sorted.at(-1) as number,
    sampleSize: sorted.length,
    currency: 'USD',
    fetchedAt,
  };
}

export class SoldCompsSource implements PriceSource {
  constructor(
    private readonly apiKey = process.env.SOLDCOMPS_API_KEY,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async fetch(item: Item): Promise<PriceQuote | null> {
    if (!this.apiKey) return null;
    const url = new URL('https://api.sold-comps.com/v1/scrape');
    url.search = new URLSearchParams({
      keyword: item.ebayQuery,
      count: '240',
      itemCondition: 'used',
    }).toString();
    const response = await this.fetcher(url, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`SoldComps failed (${response.status})`);
    const body = (await response.json()) as SoldCompsResponse;
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const prices = Array.isArray(body.items)
      ? body.items.flatMap((entry) =>
          entry.soldCurrency === 'USD' &&
          typeof entry.soldPrice === 'string' &&
          typeof entry.endedAt === 'string' &&
          Number.isFinite(Date.parse(entry.endedAt)) &&
          Date.parse(entry.endedAt) >= cutoff &&
          entry.bestOfferAccepted !== true
            ? [Number(entry.soldPrice)]
            : [],
        )
      : [];
    return quoteFromPrices(item.slug, 'sold', prices);
  }
}

export class EbayBrowseSource implements PriceSource {
  private token: { expiresAt: number; value: string } | null = null;
  private tokenRequest: Promise<string> | null = null;

  constructor(
    private readonly appId = process.env.EBAY_APP_ID,
    private readonly certId = process.env.EBAY_CERT_ID,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async fetch(item: Item): Promise<PriceQuote | null> {
    if (!this.appId || !this.certId) return null;
    const url = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
    url.search = new URLSearchParams({ q: item.ebayQuery, limit: '50' }).toString();
    const response = await this.fetcher(url, {
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`eBay Browse failed (${response.status})`);
    const body = (await response.json()) as EbayBrowseResponse;
    const prices = Array.isArray(body.itemSummaries)
      ? body.itemSummaries.flatMap((entry) =>
          entry.price?.currency === 'USD' && typeof entry.price.value === 'string'
            ? [Number(entry.price.value)]
            : [],
        )
      : [];
    return quoteFromPrices(item.slug, 'active', prices);
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    if (this.tokenRequest) return this.tokenRequest;
    this.tokenRequest = this.requestAccessToken().finally(() => {
      this.tokenRequest = null;
    });
    return this.tokenRequest;
  }

  private async requestAccessToken(): Promise<string> {
    const response = await this.fetcher('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.appId}:${this.certId}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'https://api.ebay.com/oauth/api_scope',
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`eBay OAuth failed (${response.status})`);
    const body = (await response.json()) as EbayTokenResponse;
    if (typeof body.access_token !== 'string' || typeof body.expires_in !== 'number') {
      throw new Error('eBay OAuth returned an invalid token');
    }
    this.token = {
      value: body.access_token,
      expiresAt: Date.now() + Math.max(body.expires_in - 60, 1) * 1000,
    };
    return this.token.value;
  }
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export class PriceService {
  private readonly inFlight = new Map<string, Promise<PriceQuote | null>>();

  constructor(
    private readonly db: BackendDatabase,
    private readonly soldComps: PriceSource = new SoldCompsSource(),
    private readonly ebayBrowse: PriceSource = new EbayBrowseSource(),
  ) {}

  async fetch(item: Item): Promise<PriceQuote | null> {
    const cached = this.db.cachedPrice(item.slug, new Date(Date.now() - WEEK_MS).toISOString());
    if (cached) return cached.quote;
    const pending = this.inFlight.get(item.slug);
    if (pending) return pending;
    const request = this.fetchFresh(item).finally(() => this.inFlight.delete(item.slug));
    this.inFlight.set(item.slug, request);
    return request;
  }

  private async fetchFresh(item: Item): Promise<PriceQuote | null> {
    let quote: PriceQuote | null = null;
    let soldAnswered = false;
    let browseAnswered = false;
    try {
      quote = await this.soldComps.fetch(item);
      soldAnswered = true;
    } catch {
      // SoldComps quota and transient failures use the active-listing fallback.
    }
    if (!quote) {
      try {
        quote = await this.ebayBrowse.fetch(item);
        browseAnswered = true;
      } catch {
        // Transient failures are retried instead of cached as a week-long miss.
      }
    }
    if (quote || (soldAnswered && browseAnswered)) {
      this.db.savePrice(item.slug, quote, quote?.fetchedAt ?? new Date().toISOString());
    }
    return quote;
  }
}
