import { readFileSync } from 'node:fs';

import type { CatalogResponse } from '@shared/types.js';

export function loadCatalog(path: string): CatalogResponse {
  const value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid catalog');
  const catalog = value as Partial<CatalogResponse>;
  if (
    !Array.isArray(catalog.patterns) ||
    !Array.isArray(catalog.forms) ||
    !Array.isArray(catalog.items) ||
    !Number.isSafeInteger(catalog.version) ||
    (catalog.version as number) < 1
  ) {
    throw new Error('Invalid catalog');
  }
  return catalog as CatalogResponse;
}
