/**
 * First-run seeding.
 *
 * The catalog ships inside the app bundle rather than being fetched on first launch.
 * The whole point of this app is working in a thrift store basement with one bar of
 * signal, and a first run that needs a network round trip before it can identify
 * anything fails exactly where it matters most. 108KB of JSON is a cheap price for
 * that.
 *
 * After seeding, a background refresh picks up anything added server-side. A failed
 * refresh is not an error, the bundled copy is already a working catalog.
 */

import catalog from '@data/catalog.json';
import type { CatalogResponse } from '@shared/types';

import { fetchCatalog } from '@/api';
import { getCatalogVersion, syncCatalog } from '@/db';

const bundled = catalog as CatalogResponse;

let started: Promise<void> | null = null;

async function run(): Promise<void> {
  if ((await getCatalogVersion()) === 0) {
    await syncCatalog(bundled);
  }

  // Best effort. Offline is the expected state, not a failure worth surfacing.
  const remote = await fetchCatalog(await getCatalogVersion());
  if (remote.ok && remote.data.items.length > 0) {
    await syncCatalog(remote.data);
  }
}

/** Idempotent, safe to call from every screen that needs a populated catalog. */
export function bootstrap(): Promise<void> {
  started ??= run().catch(() => {
    // A failed refresh leaves the bundled catalog in place; let the next call retry.
    started = null;
  });
  return started;
}
