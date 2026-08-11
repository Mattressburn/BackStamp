import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import type { ScanGuess } from '../shared/types.ts';
import { BackendDatabase } from '../backend/src/db.ts';
import { Identifier } from '../backend/src/identify.ts';

export interface ScoreRow {
  scanId: string;
  confirmedItemSlug: string;
  freshGuesses: ScanGuess[];
  storedGuesses: ScanGuess[];
}

interface RateMetric {
  count: number;
  sampleSize: number;
  rate: number | null;
}

interface MeanMetric {
  mean: number | null;
  sampleSize: number;
}

interface ScoredScan {
  scanId: string;
  confirmedItemSlug: string;
  freshTopGuess: string | null;
  confidence: number | null;
  result: 'hit' | 'miss';
}

export interface ScoreResult {
  evaluated: number;
  top1Accuracy: RateMetric;
  top3Accuracy: RateMetric;
  missRate: RateMetric;
  meanConfidenceOnHits: MeanMetric;
  meanConfidenceOnMisses: MeanMetric;
  agreementWithStoredTopGuess: RateMetric;
  scans: ScoredScan[];
}

const rate = (count: number, sampleSize: number): RateMetric => ({
  count,
  sampleSize,
  rate: sampleSize === 0 ? null : count / sampleSize,
});

const mean = (values: number[]): MeanMetric => ({
  mean: values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length,
  sampleSize: values.length,
});

export function score(rows: ScoreRow[]): ScoreResult {
  let top1Hits = 0;
  let top3Hits = 0;
  let misses = 0;
  let agreements = 0;
  const hitConfidences: number[] = [];
  const missConfidences: number[] = [];
  const scans: ScoredScan[] = [];

  for (const row of rows) {
    const freshTop = row.freshGuesses[0] ?? null;
    const storedTop = row.storedGuesses[0] ?? null;
    const hit = freshTop?.itemSlug === row.confirmedItemSlug;

    if (hit) {
      top1Hits += 1;
      hitConfidences.push(freshTop.confidence);
    } else if (freshTop) {
      missConfidences.push(freshTop.confidence);
    }
    if (row.freshGuesses.some((guess) => guess.itemSlug === row.confirmedItemSlug)) top3Hits += 1;
    if (!freshTop) misses += 1;
    if ((freshTop?.itemSlug ?? null) === (storedTop?.itemSlug ?? null)) agreements += 1;

    scans.push({
      scanId: row.scanId,
      confirmedItemSlug: row.confirmedItemSlug,
      freshTopGuess: freshTop?.itemSlug ?? null,
      confidence: freshTop?.confidence ?? null,
      result: hit ? 'hit' : 'miss',
    });
  }

  return {
    evaluated: rows.length,
    top1Accuracy: rate(top1Hits, rows.length),
    top3Accuracy: rate(top3Hits, rows.length),
    missRate: rate(misses, rows.length),
    meanConfidenceOnHits: mean(hitConfidences),
    meanConfidenceOnMisses: mean(missConfidences),
    agreementWithStoredTopGuess: rate(agreements, rows.length),
    scans,
  };
}

interface Options {
  limit: number | null;
  json: boolean;
}

interface EvaluationReport extends ScoreResult {
  skipped: {
    count: number;
    reasons: Record<string, number>;
  };
}

const databasePath = process.env.DATABASE_PATH
  ?? fileURLToPath(new URL('../backend/data/catalog.sqlite', import.meta.url));
const photoDir = process.env.PHOTO_DIR
  ?? fileURLToPath(new URL('../backend/data/photos/', import.meta.url));
const delayMs = 250;

function parseOptions(args: string[]): Options {
  let limit: number | null = null;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--json') {
      json = true;
    } else if (argument === '--limit') {
      const value = args[index + 1];
      if (!value || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
        throw new Error('--limit requires a positive integer');
      }
      limit = Number(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return { limit, json };
}

function catalogDatabase(sqlite: DatabaseSync): BackendDatabase {
  const database = Object.create(BackendDatabase.prototype) as BackendDatabase;
  Object.defineProperty(database, 'sqlite', { value: sqlite });
  return database;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

async function evaluate(
  sqlite: DatabaseSync,
  identifier: Identifier,
  options: Options,
): Promise<EvaluationReport> {
  const database = catalogDatabase(sqlite);
  const newestFirst = database.listTrainingScans().toReversed();
  const scans = options.limit === null ? newestFirst : newestFirst.slice(0, options.limit);
  const catalog = database.getCatalog();
  const scoredRows: ScoreRow[] = [];
  const skippedReasons = new Map<string, number>();
  let apiCalls = 0;

  const skip = (reason: string): void => {
    skippedReasons.set(reason, (skippedReasons.get(reason) ?? 0) + 1);
  };

  for (const [index, scan] of scans.entries()) {
    console.error(`[${index + 1}/${scans.length}] ${scan.id}`);
    if (scan.confirmedItemSlug === null) {
      skip('unconfirmed scan');
      console.error('  skipped: unconfirmed scan');
      continue;
    }

    const photos: string[] = [];
    let unreadable = false;
    for (const fileRef of scan.photoRefs) {
      try {
        photos.push((await readFile(join(photoDir, fileRef))).toString('base64'));
      } catch (error) {
        const reason = errorCode(error) === 'ENOENT' ? 'missing photo file' : 'photo read failed';
        skip(reason);
        console.error(`  skipped: ${reason}: ${fileRef}`);
        unreadable = true;
        break;
      }
    }
    if (unreadable) continue;

    if (apiCalls > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    apiCalls += 1;
    try {
      const fresh = await identifier.identify(
        { photos, hasBaseShot: scan.hasBaseShot },
        catalog,
      );
      scoredRows.push({
        scanId: scan.id,
        confirmedItemSlug: scan.confirmedItemSlug,
        freshGuesses: fresh.guesses,
        storedGuesses: scan.guesses,
      });
      console.error(`  ${fresh.guesses[0]?.itemSlug === scan.confirmedItemSlug ? 'hit' : 'miss'}`);
    } catch (error) {
      skip('identification failed');
      console.error(`  skipped: identification failed: ${errorMessage(error)}`);
    }
  }

  return {
    ...score(scoredRows),
    skipped: {
      count: [...skippedReasons.values()].reduce((sum, value) => sum + value, 0),
      reasons: Object.fromEntries(skippedReasons),
    },
  };
}

function formatRate(metric: RateMetric): string {
  const percent = metric.rate === null ? 'n/a' : `${(metric.rate * 100).toFixed(1)}%`;
  return `${metric.count}/${metric.sampleSize} (${percent}, n=${metric.sampleSize})`;
}

function formatMean(metric: MeanMetric): string {
  return `${metric.mean === null ? 'n/a' : metric.mean.toFixed(3)} (n=${metric.sampleSize})`;
}

function printReport(report: EvaluationReport): void {
  console.log(`evaluated: ${report.evaluated}`);
  console.log(`skipped: ${report.skipped.count}`);
  for (const [reason, count] of Object.entries(report.skipped.reasons)) {
    console.log(`skipped, ${reason}: ${count}`);
  }
  console.log(`top-1 accuracy: ${formatRate(report.top1Accuracy)}`);
  console.log(`top-3 accuracy: ${formatRate(report.top3Accuracy)}`);
  console.log(`no-guesses miss rate: ${formatRate(report.missRate)}`);
  console.log(`mean confidence on top-1 hits: ${formatMean(report.meanConfidenceOnHits)}`);
  console.log(`mean confidence on wrong top guesses: ${formatMean(report.meanConfidenceOnMisses)}`);
  console.log(`agreement with stored top guess: ${formatRate(report.agreementWithStoredTopGuess)}`);
  console.table(report.scans.map((scan) => ({
    'scan id': scan.scanId,
    'confirmed slug': scan.confirmedItemSlug,
    'fresh top guess': scan.freshTopGuess ?? 'none',
    confidence: scan.confidence === null ? 'n/a' : scan.confidence.toFixed(3),
    result: scan.result,
  })));
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function main(): Promise<number> {
  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY is required');
    return 1;
  }

  let options: Options;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    console.error(errorMessage(error));
    console.error('Usage: node --import tsx eval-scans.ts [--limit N] [--json]');
    return 1;
  }

  if (!(await isFile(databasePath))) {
    console.error(`Database is missing: ${databasePath}`);
    return 1;
  }
  if (!(await isDirectory(photoDir))) {
    console.error(`Photo directory is missing: ${photoDir}`);
    return 1;
  }

  const sqlite = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const report = await evaluate(sqlite, new Identifier(process.env.GEMINI_API_KEY), options);
    if (options.json) console.log(JSON.stringify(report));
    else printReport(report);
    return 0;
  } finally {
    sqlite.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error) => {
      console.error(errorMessage(error));
      process.exitCode = 1;
    },
  );
}
