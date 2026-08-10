#!/usr/bin/env node

import { readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { Anthropic } from '@anthropic-ai/sdk';
import type { Form, FormFamily, Item, Pattern, Rarity } from '@shared/types';

export type ReviewPattern = Omit<Pattern, 'rarity'> & {
  rarity: Rarity | null;
  sourcePage: string;
  confidence: number;
};

export type ReviewForm = Omit<Form, 'id' | 'modelNo'> & {
  id: string | null;
  modelNo: string | null;
  sourcePage: string;
  confidence: number;
};

export type ReviewItem = Omit<Item, 'slug' | 'formId' | 'rarity'> & {
  slug: string | null;
  formId: string | null;
  rarity: Rarity | null;
  sourcePage: string;
  confidence: number;
};

export interface ReviewConflict {
  recordType: 'pattern' | 'form' | 'item';
  key: string;
  fields: string[];
  sourcePages: string[];
}

export interface ReviewOutput {
  patterns: ReviewPattern[];
  forms: ReviewForm[];
  items: ReviewItem[];
  conflicts: ReviewConflict[];
  processedPages: string[];
}

type RawPattern = Pick<Pattern, 'name' | 'yearsStart' | 'yearsEnd' | 'colorway'> & {
  confidence: number;
};

type RawForm = Omit<Form, 'id' | 'modelNo'> & {
  modelNo: Form['modelNo'] | null;
  confidence: number;
};

interface RawItem {
  patternName: Pattern['name'];
  modelNo: Form['modelNo'] | null;
  formFamily: FormFamily;
  confidence: number;
}

interface RawPage {
  sourcePage: string;
  patterns: RawPattern[];
  forms: RawForm[];
  items: RawItem[];
}

interface RawExtraction {
  pages: RawPage[];
}

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

const MODEL = 'claude-opus-5';
const MAX_TOKENS = 32_000;
const BATCH_SIZE = 3;
const FORM_FAMILIES: FormFamily[] = [
  'mixing-bowl',
  'cinderella-bowl',
  'refrigerator-dish',
  'casserole',
  'divided-dish',
  'baking-dish',
  'carafe',
  'mug',
  'other',
];
const FORM_SUFFIX: Record<FormFamily, string> = {
  'mixing-bowl': 'mixing',
  'cinderella-bowl': 'cinderella',
  'refrigerator-dish': 'refrigerator',
  casserole: 'casserole',
  'divided-dish': 'divided',
  'baking-dish': 'baking',
  carafe: 'carafe',
  mug: 'mug',
  other: 'other',
};
const FORM_QUERY: Record<FormFamily, string> = {
  'mixing-bowl': 'mixing bowl',
  'cinderella-bowl': 'Cinderella bowl',
  'refrigerator-dish': 'refrigerator dish',
  casserole: 'casserole',
  'divided-dish': 'divided dish',
  'baking-dish': 'baking dish',
  carafe: 'carafe',
  mug: 'mug',
  other: '',
};
const IMAGE_TYPES = new Map<string, ImageMediaType>([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
]);
const EXTRACTION_PROMPT = `Extract only factual catalog data about manufactured glassware from the supplied reference-book page photos.

FACTS ARE EXTRACTABLE; EXPRESSION IS NOT. Return pattern names, production years, model numbers, colorways, form categories, dimensions, capacities, and explicit pattern/form associations. Do not quote, paraphrase, summarize, or store the book's prose, captions, descriptions, photographs, phrasing, rarity ratings, or page organization. Do not reproduce the guide's selection or arrangement. The JSON schema and field names supplied by the caller are the only organization to use.

Never invent or infer a production year or model number. Use null whenever either is absent, obscured, or not legible. Do not guess a partially visible digit. Only emit a pattern when its name is legible, a form when its shape/category is supported by the page, and an item association when the page explicitly connects that pattern and form. Confidence is 0..1 and measures legibility and certainty that the page explicitly supports the record. Model numbers omit printed labels such as "No." or "#" but preserve the model characters themselves.`;

export function emptyReviewOutput(): ReviewOutput {
  return { patterns: [], forms: [], items: [], conflicts: [], processedPages: [] };
}

export function itemSlug(patternId: string, modelNo: string): string {
  return `${patternId}-${modelNo}`;
}

export function filterPendingPages(
  pageNames: string[],
  processedPages: string[],
  resume: boolean,
): string[] {
  const completed = new Set(resume ? processedPages : []);
  return pageNames.filter((page) => !completed.has(page)).sort((a, b) => a.localeCompare(b));
}

const PROVENANCE_FIELDS = new Set(['sourcePage', 'confidence']);

function differingFactFields(left: object, right: object): string[] {
  return Object.keys(left)
    .filter((field) => !PROVENANCE_FIELDS.has(field))
    .filter((field) => {
      const leftValue = Reflect.get(left, field);
      const rightValue = Reflect.get(right, field);
      return leftValue != null && rightValue != null && leftValue !== rightValue;
    })
    .sort();
}

function findConflicts<T extends { sourcePage: string }>(
  recordType: ReviewConflict['recordType'],
  records: T[],
  keyOf: (record: T) => string | null,
): ReviewConflict[] {
  const conflicts: ReviewConflict[] = [];

  // ponytail: quadratic comparison is fine for one book; index by key if review files become large.
  for (let leftIndex = 0; leftIndex < records.length; leftIndex += 1) {
    const left = records[leftIndex];
    if (!left) continue;
    const key = keyOf(left);
    if (key == null) continue;

    for (let rightIndex = leftIndex + 1; rightIndex < records.length; rightIndex += 1) {
      const right = records[rightIndex];
      if (!right || keyOf(right) !== key) continue;
      const fields = differingFactFields(left, right);
      if (fields.length === 0) continue;
      conflicts.push({
        recordType,
        key,
        fields,
        sourcePages: [left.sourcePage, right.sourcePage].sort(),
      });
    }
  }

  return conflicts;
}

function unique<T>(records: T[]): T[] {
  return [...new Map(records.map((record) => [JSON.stringify(record), record])).values()];
}

function strongestCandidates<T extends { confidence: number }>(records: T[]): T[] {
  const byFacts = new Map<string, T>();
  for (const record of records) {
    const facts = Object.entries(record)
      .filter(([field]) => !PROVENANCE_FIELDS.has(field))
      .sort(([left], [right]) => left.localeCompare(right));
    const key = JSON.stringify(facts);
    const current = byFacts.get(key);
    if (!current || record.confidence > current.confidence) byFacts.set(key, record);
  }
  return [...byFacts.values()];
}

export function mergeReviewOutput(existing: ReviewOutput, incoming: ReviewOutput): ReviewOutput {
  const patterns = strongestCandidates([...existing.patterns, ...incoming.patterns]);
  const forms = strongestCandidates([...existing.forms, ...incoming.forms]);
  const items = strongestCandidates([...existing.items, ...incoming.items]);
  const detected = [
    ...findConflicts('pattern', patterns, (record) => record.id),
    ...findConflicts('form', forms, (record) => record.id),
    ...findConflicts('item', items, (record) => record.slug),
  ];

  return {
    patterns,
    forms,
    items,
    conflicts: unique(detected),
    processedPages: [...new Set([...existing.processedPages, ...incoming.processedPages])].sort(),
  };
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function formId(modelNo: string, family: FormFamily): string {
  return `${modelNo}-${FORM_SUFFIX[family]}`;
}

function cleanNullable(value: string | null): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function toReviewOutput(extraction: RawExtraction): ReviewOutput {
  const output = emptyReviewOutput();

  for (const page of extraction.pages) {
    for (const pattern of page.patterns) {
      const name = pattern.name.trim();
      output.patterns.push({
        id: slugify(name),
        name,
        yearsStart: pattern.yearsStart,
        yearsEnd: pattern.yearsEnd,
        colorway: cleanNullable(pattern.colorway),
        rarity: null,
        notes: null,
        sourcePage: page.sourcePage,
        confidence: pattern.confidence,
      });
    }

    for (const form of page.forms) {
      const modelNo = cleanNullable(form.modelNo);
      output.forms.push({
        id: modelNo == null ? null : formId(modelNo, form.family),
        modelNo,
        family: form.family,
        shape: form.shape.trim(),
        capacityQt: form.capacityQt,
        dimensions: cleanNullable(form.dimensions),
        sourcePage: page.sourcePage,
        confidence: form.confidence,
      });
    }

    for (const item of page.items) {
      const patternName = item.patternName.trim();
      const patternId = slugify(patternName);
      const modelNo = cleanNullable(item.modelNo);
      output.items.push({
        slug: modelNo == null ? null : itemSlug(patternId, modelNo),
        patternId,
        formId: modelNo == null ? null : formId(modelNo, item.formFamily),
        rarity: null,
        ebayQuery: ['Vintage Pyrex', patternName, modelNo, FORM_QUERY[item.formFamily]]
          .filter(Boolean)
          .join(' '),
        userSubmitted: false,
        sourcePage: page.sourcePage,
        confidence: item.confidence,
      });
    }

    output.processedPages.push(page.sourcePage);
  }

  return output;
}

function extractionSchema(pageNames: string[]): Record<string, unknown> {
  const nullableString = { type: ['string', 'null'] };
  const nullableNumber = { type: ['number', 'null'] };
  const confidence = { type: 'number', minimum: 0, maximum: 1 };

  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      pages: {
        type: 'array',
        minItems: pageNames.length,
        maxItems: pageNames.length,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            sourcePage: { type: 'string', enum: pageNames },
            patterns: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  name: { type: 'string', minLength: 1 },
                  yearsStart: { type: ['integer', 'null'] },
                  yearsEnd: { type: ['integer', 'null'] },
                  colorway: nullableString,
                  confidence,
                },
                required: ['name', 'yearsStart', 'yearsEnd', 'colorway', 'confidence'],
              },
            },
            forms: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  modelNo: nullableString,
                  family: { type: 'string', enum: FORM_FAMILIES },
                  shape: { type: 'string', minLength: 1 },
                  capacityQt: nullableNumber,
                  dimensions: nullableString,
                  confidence,
                },
                required: [
                  'modelNo',
                  'family',
                  'shape',
                  'capacityQt',
                  'dimensions',
                  'confidence',
                ],
              },
            },
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  patternName: { type: 'string', minLength: 1 },
                  modelNo: nullableString,
                  formFamily: { type: 'string', enum: FORM_FAMILIES },
                  confidence,
                },
                required: ['patternName', 'modelNo', 'formFamily', 'confidence'],
              },
            },
          },
          required: ['sourcePage', 'patterns', 'forms', 'items'],
        },
      },
    },
    required: ['pages'],
  };
}

async function pageContent(pagesDir: string, pageNames: string[]) {
  const content: Array<
    | { type: 'text'; text: string }
    | {
        type: 'image';
        source: { type: 'base64'; media_type: ImageMediaType; data: string };
      }
  > = [];

  for (const pageName of pageNames) {
    const mediaType = IMAGE_TYPES.get(path.extname(pageName).toLowerCase());
    if (!mediaType) throw new Error(`Unsupported image type: ${pageName}`);
    content.push({ type: 'text', text: `SOURCE_PAGE: ${pageName}` });
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType,
        data: (await readFile(path.join(pagesDir, pageName))).toString('base64'),
      },
    });
  }

  return content;
}

async function extractBatch(
  client: Anthropic,
  pagesDir: string,
  pageNames: string[],
): Promise<RawExtraction> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: EXTRACTION_PROMPT,
    messages: [{ role: 'user', content: await pageContent(pagesDir, pageNames) }],
    output_config: {
      format: { type: 'json_schema', schema: extractionSchema(pageNames) },
    },
  });

  if (response.stop_reason !== 'end_turn') {
    throw new Error(`Extraction stopped early: ${response.stop_reason ?? 'unknown reason'}`);
  }
  const text = response.content.find((block) => block.type === 'text');
  if (!text) throw new Error('Claude returned no structured text output');
  const extraction = JSON.parse(text.text) as RawExtraction;
  const returnedPages = extraction.pages.map((page) => page.sourcePage).sort();
  const expectedPages = [...pageNames].sort();
  if (JSON.stringify(returnedPages) !== JSON.stringify(expectedPages)) {
    throw new Error('Claude did not return exactly one result for every supplied page');
  }
  return extraction;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRecordArray(value: unknown, name: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw new Error(`Resume file has an invalid ${name} array`);
  }
  return value;
}

function parseReviewOutput(value: unknown): ReviewOutput {
  if (!isRecord(value)) throw new Error('Resume file must contain a JSON object');
  const patterns = readRecordArray(value.patterns, 'patterns');
  const forms = readRecordArray(value.forms, 'forms');
  const items = readRecordArray(value.items, 'items');
  const conflicts = readRecordArray(value.conflicts, 'conflicts');
  if (!Array.isArray(value.processedPages) || !value.processedPages.every((page) => typeof page === 'string')) {
    throw new Error('Resume file has an invalid processedPages array');
  }
  for (const record of [...patterns, ...forms, ...items]) {
    if (typeof record.sourcePage !== 'string' || typeof record.confidence !== 'number') {
      throw new Error('Resume records require sourcePage and numeric confidence fields');
    }
  }
  return value as unknown as ReviewOutput;
}

async function loadReviewOutput(outputPath: string, resume: boolean): Promise<ReviewOutput> {
  if (!resume) return emptyReviewOutput();
  try {
    return parseReviewOutput(JSON.parse(await readFile(outputPath, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyReviewOutput();
    throw error;
  }
}

async function saveReviewOutput(outputPath: string, output: ReviewOutput): Promise<void> {
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(output, null, 2)}\n`);
  await rename(temporaryPath, outputPath);
}

function parseArgs(args: string[]): { pagesDir: string; outputPath: string; resume: boolean } {
  const pagesDir = args[0];
  let outputPath: string | undefined;
  let resume = false;

  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--resume') {
      resume = true;
    } else if (argument === '--out') {
      outputPath = args[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!pagesDir || !outputPath) {
    throw new Error('Usage: tsx scripts/digitize-book.ts <pages-dir> --out extracted.json [--resume]');
  }
  return { pagesDir: path.resolve(pagesDir), outputPath: path.resolve(outputPath), resume };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required');
  if (!(await stat(options.pagesDir)).isDirectory()) throw new Error('pages-dir must be a directory');

  const catalogPath = fileURLToPath(new URL('../data/catalog.json', import.meta.url));
  if (options.outputPath === catalogPath) {
    throw new Error('Write to a separate review file; data/catalog.json cannot be an extraction target');
  }

  const pageNames = (await readdir(options.pagesDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && IMAGE_TYPES.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name);
  if (pageNames.length === 0) throw new Error('pages-dir contains no supported page images');

  let output = await loadReviewOutput(options.outputPath, options.resume);
  const pending = filterPendingPages(pageNames, output.processedPages, options.resume);
  if (pending.length === 0) {
    console.log('No pages to process.');
    return;
  }

  const { default: AnthropicClient } = await import('@anthropic-ai/sdk');
  const client = new AnthropicClient({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 5 });

  for (let start = 0; start < pending.length; start += BATCH_SIZE) {
    const batch = pending.slice(start, start + BATCH_SIZE);
    for (const [offset, pageName] of batch.entries()) {
      console.log(`[${start + offset + 1}/${pending.length}] ${pageName}: sending`);
    }

    const extracted = toReviewOutput(await extractBatch(client, options.pagesDir, batch));
    output = mergeReviewOutput(output, extracted);
    await saveReviewOutput(options.outputPath, output);

    for (const [offset, pageName] of batch.entries()) {
      const count =
        extracted.patterns.filter((record) => record.sourcePage === pageName).length +
        extracted.forms.filter((record) => record.sourcePage === pageName).length +
        extracted.items.filter((record) => record.sourcePage === pageName).length;
      console.log(`[${start + offset + 1}/${pending.length}] ${pageName}: saved ${count} records`);
    }
  }

  console.log(`Review file: ${options.outputPath} (${output.conflicts.length} conflicts)`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
