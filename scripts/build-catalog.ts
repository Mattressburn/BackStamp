import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CatalogResponse, FormFamily, Rarity } from '../shared/types.ts';

const rarities = new Set<Rarity>([
  'common',
  'uncommon',
  'hard-to-find',
  'rare',
  'grail',
]);
const formFamilies = new Set<FormFamily>([
  'mixing-bowl',
  'cinderella-bowl',
  'refrigerator-dish',
  'casserole',
  'divided-dish',
  'baking-dish',
  'carafe',
  'mug',
  'other',
]);
const catalogPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../data/catalog.json',
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
  errors: string[],
): void {
  const actual = Object.keys(value);
  for (const key of expected) {
    if (!actual.includes(key)) errors.push(`${label} is missing field "${key}"`);
  }
  for (const key of actual) {
    if (!expected.includes(key)) errors.push(`${label} has unknown field "${key}"`);
  }
}

function checkNullableString(
  value: unknown,
  label: string,
  errors: string[],
): void {
  if (value !== null && typeof value !== 'string') {
    errors.push(`${label} must be a string or null`);
  }
}

function checkNullableNumber(
  value: unknown,
  label: string,
  errors: string[],
): void {
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
    errors.push(`${label} must be a finite number or null`);
  }
}

function validateCatalog(value: unknown): CatalogResponse {
  const errors: string[] = [];
  if (!isRecord(value)) throw new Error('Catalog must be a JSON object');

  checkKeys(value, ['patterns', 'forms', 'items', 'version'], 'catalog', errors);
  const patterns = Array.isArray(value.patterns) ? value.patterns : [];
  const forms = Array.isArray(value.forms) ? value.forms : [];
  const items = Array.isArray(value.items) ? value.items : [];
  if (!Array.isArray(value.patterns)) errors.push('catalog.patterns must be an array');
  if (!Array.isArray(value.forms)) errors.push('catalog.forms must be an array');
  if (!Array.isArray(value.items)) errors.push('catalog.items must be an array');
  if (!Number.isInteger(value.version) || (value.version as number) < 1) {
    errors.push('catalog.version must be a positive integer');
  }

  const patternIds = new Set<string>();
  for (const [index, pattern] of patterns.entries()) {
    const label = `patterns[${index}]`;
    if (!isRecord(pattern)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    checkKeys(
      pattern,
      ['id', 'name', 'yearsStart', 'yearsEnd', 'colorway', 'rarity', 'notes'],
      label,
      errors,
    );
    if (typeof pattern.id !== 'string' || pattern.id.trim() === '') {
      errors.push(`${label}.id must be a non-empty string`);
    } else if (patternIds.has(pattern.id)) {
      errors.push(`duplicate pattern id "${pattern.id}"`);
    } else {
      patternIds.add(pattern.id);
    }
    if (typeof pattern.name !== 'string' || pattern.name.trim() === '') {
      errors.push(`${label}.name must be a non-empty string`);
    }
    for (const field of ['yearsStart', 'yearsEnd'] as const) {
      const year = pattern[field];
      if (year !== null && !Number.isInteger(year)) {
        errors.push(`${label}.${field} must be an integer or null`);
      }
    }
    if (
      typeof pattern.yearsStart === 'number' &&
      typeof pattern.yearsEnd === 'number' &&
      pattern.yearsStart > pattern.yearsEnd
    ) {
      errors.push(`${label} has yearsStart after yearsEnd`);
    }
    checkNullableString(pattern.colorway, `${label}.colorway`, errors);
    checkNullableString(pattern.notes, `${label}.notes`, errors);
    if (!rarities.has(pattern.rarity as Rarity)) {
      errors.push(`${label}.rarity "${String(pattern.rarity)}" is outside the enum`);
    }
  }

  const formIds = new Set<string>();
  const formsById = new Map<string, Record<string, unknown>>();
  for (const [index, form] of forms.entries()) {
    const label = `forms[${index}]`;
    if (!isRecord(form)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    checkKeys(
      form,
      ['id', 'modelNo', 'family', 'shape', 'capacityQt', 'dimensions'],
      label,
      errors,
    );
    if (typeof form.id !== 'string' || form.id.trim() === '') {
      errors.push(`${label}.id must be a non-empty string`);
    } else if (formIds.has(form.id)) {
      errors.push(`duplicate form id "${form.id}"`);
    } else {
      formIds.add(form.id);
      formsById.set(form.id, form);
    }
    if (typeof form.modelNo !== 'string' || form.modelNo.trim() === '') {
      errors.push(`${label}.modelNo must be a non-empty string`);
    }
    if (!formFamilies.has(form.family as FormFamily)) {
      errors.push(`${label}.family "${String(form.family)}" is outside the enum`);
    }
    if (typeof form.shape !== 'string' || form.shape.trim() === '') {
      errors.push(`${label}.shape must be a non-empty string`);
    }
    checkNullableNumber(form.capacityQt, `${label}.capacityQt`, errors);
    checkNullableString(form.dimensions, `${label}.dimensions`, errors);
  }

  const itemSlugs = new Set<string>();
  for (const [index, item] of items.entries()) {
    const label = `items[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    checkKeys(
      item,
      ['slug', 'patternId', 'formId', 'rarity', 'ebayQuery', 'userSubmitted'],
      label,
      errors,
    );
    if (typeof item.slug !== 'string' || item.slug.trim() === '') {
      errors.push(`${label}.slug must be a non-empty string`);
    } else if (itemSlugs.has(item.slug)) {
      errors.push(`duplicate item slug "${item.slug}"`);
    } else {
      itemSlugs.add(item.slug);
    }
    if (typeof item.patternId !== 'string' || !patternIds.has(item.patternId)) {
      errors.push(`${label} references missing pattern "${String(item.patternId)}"`);
    }
    const form = typeof item.formId === 'string' ? formsById.get(item.formId) : undefined;
    if (!form) {
      errors.push(`${label} references missing form "${String(item.formId)}"`);
    } else if (
      typeof item.slug === 'string' &&
      typeof item.patternId === 'string' &&
      item.slug !== `${item.patternId}-${String(form.modelNo)}`
    ) {
      errors.push(
        `${label}.slug "${item.slug}" must equal "${item.patternId}-${String(form.modelNo)}"`,
      );
    }
    if (!rarities.has(item.rarity as Rarity)) {
      errors.push(`${label}.rarity "${String(item.rarity)}" is outside the enum`);
    }
    if (typeof item.ebayQuery !== 'string' || item.ebayQuery.trim() === '') {
      errors.push(`${label}.ebayQuery must be a non-empty string`);
    }
    if (item.userSubmitted !== false) {
      errors.push(`${label}.userSubmitted must be false for seed data`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Catalog validation failed:\n- ${errors.join('\n- ')}`);
  }
  return value as unknown as CatalogResponse;
}

async function main(): Promise<void> {
  const catalog = validateCatalog(JSON.parse(await readFile(catalogPath, 'utf8')));
  const counts = new Map(catalog.patterns.map((pattern) => [pattern.id, 0]));
  for (const item of catalog.items) counts.set(item.patternId, counts.get(item.patternId)! + 1);

  console.log(
    `Catalog v${catalog.version}: ${catalog.patterns.length} patterns, ` +
      `${catalog.forms.length} forms, ${catalog.items.length} items`,
  );
  console.log('Items per pattern:');
  const width = Math.max(0, ...catalog.patterns.map((pattern) => pattern.id.length));
  for (const pattern of catalog.patterns) {
    console.log(`  ${pattern.id.padEnd(width)}  ${counts.get(pattern.id)}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
