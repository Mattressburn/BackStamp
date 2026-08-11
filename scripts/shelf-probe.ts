import { execFile as execFileCallback, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { CatalogResponse } from '../shared/types.ts';
import { loadCatalog } from '../backend/src/catalog-file.ts';

const GEMINI_MODEL = 'gemini-3.1-flash-lite';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const DEFAULT_WIDTHS = [4032, 2048, 1024] as const;
const MAX_OUTPUT_TOKENS = 8192;
const INPUT_USD_PER_MILLION_TOKENS = 0.25;
const OUTPUT_USD_PER_MILLION_TOKENS = 1.5;
const CONFIRMATION_THRESHOLD_USD = 0.1;
const PRICING_SOURCE = 'https://ai.google.dev/gemini-api/docs/pricing';
const PRICING_CHECKED_DATE = '2026-08-10';
const execFile = promisify(execFileCallback);

type Width = number | 'native';
type ResizeTool = 'magick' | 'convert' | 'ffmpeg';

export interface ShelfDetection {
  itemSlug: string;
  confidence: number;
  location: string;
  visibleEvidence: string;
}

export interface WidthDetections {
  width: Width;
  detections: ShelfDetection[];
}

interface UsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  thoughtsTokenCount: number;
  imageTokenCount: number | null;
}

interface WidthReport extends WidthDetections {
  usage: UsageMetadata;
  estimatedCostUsd: number;
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
  usageMetadata?: {
    promptTokenCount?: unknown;
    candidatesTokenCount?: unknown;
    thoughtsTokenCount?: unknown;
    promptTokensDetails?: Array<{ modality?: unknown; tokenCount?: unknown }>;
  };
}

export interface Options {
  photoPath: string;
  widths: number[];
  json: boolean;
  yes: boolean;
}

export function parseWidths(value: string | undefined): number[] {
  if (value === undefined) return [...DEFAULT_WIDTHS];
  const parts = value.split(',');
  if (parts.length > 5) throw new Error('--widths accepts at most 5 entries');
  if (
    parts.length === 0
    || parts.some((part) => !/^[1-9]\d*$/.test(part) || !Number.isSafeInteger(Number(part)))
  ) {
    throw new Error('--widths requires comma-separated positive integers');
  }
  return parts.map(Number);
}

export function estimateCost(inputTokens: number, outputTokens: number): number {
  return (
    inputTokens * INPUT_USD_PER_MILLION_TOKENS
    + outputTokens * OUTPUT_USD_PER_MILLION_TOKENS
  ) / 1_000_000;
}

export function compareWidths(results: WidthDetections[]): {
  commonSlugs: string[];
  partialSlugs: Array<{ itemSlug: string; widths: Width[] }>;
} {
  if (results.length === 0) return { commonSlugs: [], partialSlugs: [] };
  const sets = results.map((result) => new Set(result.detections.map((entry) => entry.itemSlug)));
  const allSlugs = [...new Set(sets.flatMap((set) => [...set]))].sort();
  const commonSlugs = allSlugs.filter((slug) => sets.every((set) => set.has(slug)));
  const common = new Set(commonSlugs);
  return {
    commonSlugs,
    partialSlugs: allSlugs
      .filter((slug) => !common.has(slug))
      .map((itemSlug) => ({
        itemSlug,
        widths: results
          .filter((_, index) => sets[index]!.has(itemSlug))
          .map((result) => result.width),
      })),
  };
}

export function detectionRows(
  detections: ShelfDetection[],
  catalog: CatalogResponse,
): Array<Record<string, string>> {
  const patterns = new Map(catalog.patterns.map((pattern) => [pattern.id, pattern]));
  const forms = new Map(catalog.forms.map((form) => [form.id, form]));
  const items = new Map(catalog.items.map((item) => [item.slug, item]));

  return detections.toSorted((a, b) => a.location.localeCompare(b.location)).map((detection) => {
    const item = items.get(detection.itemSlug);
    const pattern = item ? patterns.get(item.patternId) : undefined;
    const form = item ? forms.get(item.formId) : undefined;
    if (!item || !pattern || !form) throw new Error(`Catalog lookup failed: ${detection.itemSlug}`);
    return {
      location: detection.location,
      slug: detection.itemSlug,
      pattern: pattern.name,
      form: form.shape,
      'model confidence': detection.confidence.toFixed(3),
      'visible evidence': detection.visibleEvidence,
    };
  });
}

export function parseOptions(args: string[]): Options {
  let photoPath: string | null = null;
  let widths: number[] | null = null;
  let json = false;
  let yes = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === '--json') json = true;
    else if (argument === '--yes') yes = true;
    else if (argument === '--widths') {
      const value = args[index + 1];
      if (value === undefined) throw new Error('--widths requires comma-separated positive integers');
      widths = parseWidths(value);
      index += 1;
    } else if (argument.startsWith('--')) throw new Error(`Unknown argument: ${argument}`);
    else if (photoPath === null) photoPath = argument;
    else throw new Error(`Unexpected argument: ${argument}`);
  }

  if (photoPath === null) throw new Error('A shelf photo path is required');
  return { photoPath, widths: widths ?? parseWidths(undefined), json, yes };
}

function shelfPrompt(catalog: CatalogResponse): string {
  const patterns = new Map(catalog.patterns.map((pattern) => [pattern.id, pattern]));
  const forms = new Map(catalog.forms.map((form) => [form.id, form]));
  const choices = catalog.items.map((item) => {
    const pattern = patterns.get(item.patternId);
    const form = forms.get(item.formId);
    return {
      slug: item.slug,
      pattern: pattern?.name,
      colorway: pattern?.colorway,
      modelNo: form?.modelNo,
      form: form?.shape,
      dimensions: form?.dimensions,
    };
  });

  return [
    'Identify every vintage Pyrex piece that is visibly matchable in this shelf photo using only the supplied catalog.',
    'A catalog item is pattern AND form. Match both. Relative size within a nested stack is legitimate form evidence, and visibleEvidence must say when you use it.',
    'Return one detection per physical piece you can actually match. Never invent a slug and never return a free-text item name.',
    'Abstention matters more than recall. Emit an entry only when visible evidence supports both the catalog pattern and the catalog form. Pattern evidence can be print and color. Form evidence can be rim shape, vessel shape, or relative size. If either cannot be matched, emit nothing. Emit nothing for non-Pyrex objects. Do not infer hidden pieces or assume how many pieces are present.',
    'For location, describe where a person can find the piece, such as "second shelf from top, third column, middle bowl in the stack". For visibleEvidence, state only what is visible in this photo.',
    `Catalog:\n${JSON.stringify(choices)}`,
    'One shelf photo follows. No base photo is present and no model number is visible. Do not claim a base mark or model number as evidence.',
  ].join('\n\n');
}

export function responseSchema(slugs: string[]) {
  return {
    type: 'OBJECT',
    properties: {
      detections: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            itemSlug: { type: 'STRING', enum: slugs },
            confidence: { type: 'NUMBER' },
            location: { type: 'STRING' },
            visibleEvidence: { type: 'STRING' },
          },
          required: ['itemSlug', 'confidence', 'location', 'visibleEvidence'],
        },
      },
    },
    required: ['detections'],
  };
}

export function parseDetections(text: string, knownSlugs: ReadonlySet<string>): ShelfDetection[] {
  const parsed = JSON.parse(text) as { detections?: unknown };
  if (!Array.isArray(parsed.detections)) throw new Error('Vision model returned invalid detections');
  return parsed.detections.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Vision model returned an invalid detection');
    }
    const entry = value as Record<string, unknown>;
    if (
      typeof entry.itemSlug !== 'string'
      || !knownSlugs.has(entry.itemSlug)
      || typeof entry.confidence !== 'number'
      || !Number.isFinite(entry.confidence)
      || entry.confidence < 0
      || entry.confidence > 1
      || typeof entry.location !== 'string'
      || !entry.location.trim()
      || typeof entry.visibleEvidence !== 'string'
      || !entry.visibleEvidence.trim()
    ) {
      throw new Error('Vision model returned an invalid detection');
    }
    return {
      itemSlug: entry.itemSlug,
      confidence: entry.confidence,
      location: entry.location.trim(),
      visibleEvidence: entry.visibleEvidence.trim(),
    };
  });
}

function tokenCount(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Vision model returned invalid ${field}`);
  }
  return value as number;
}

function usageMetadata(value: GeminiResponse['usageMetadata']): UsageMetadata {
  if (!value) throw new Error('Vision model returned no token usage metadata');
  const image = value.promptTokensDetails?.find((detail) => detail.modality === 'IMAGE');
  return {
    promptTokenCount: tokenCount(value.promptTokenCount, 'prompt token count'),
    candidatesTokenCount: tokenCount(value.candidatesTokenCount, 'output token count'),
    thoughtsTokenCount: value.thoughtsTokenCount === undefined
      ? 0
      : tokenCount(value.thoughtsTokenCount, 'thinking token count'),
    imageTokenCount: image === undefined ? null : tokenCount(image.tokenCount, 'image token count'),
  };
}

async function detect(
  photoPath: string,
  mimeType: string,
  prompt: string,
  slugs: string[],
  apiKey: string,
): Promise<Omit<WidthReport, 'width' | 'estimatedCostUsd'>> {
  const response = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { mimeType, data: (await readFile(photoPath)).toString('base64') } },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: responseSchema(slugs),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Shelf identification failed (${response.status})`);

  const body = (await response.json()) as GeminiResponse;
  const text = body.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === 'string')?.text;
  if (typeof text !== 'string') throw new Error('Vision model returned no text');
  return {
    detections: parseDetections(text, new Set(slugs)).toSorted((a, b) => a.location.localeCompare(b.location)),
    usage: usageMetadata(body.usageMetadata),
  };
}

function findResizeTool(): ResizeTool | null {
  for (const command of ['magick', 'convert', 'ffmpeg'] as const) {
    if (spawnSync(command, ['-version'], { stdio: 'ignore' }).status === 0) return command;
  }
  return null;
}

async function resize(tool: ResizeTool, source: string, width: number, output: string): Promise<void> {
  if (tool === 'ffmpeg') {
    await execFile(tool, [
      '-loglevel', 'error', '-y', '-i', source,
      '-vf', `scale=${width}:-2`, '-map_metadata', '-1', '-frames:v', '1', '-q:v', '2', output,
    ]);
    return;
  }
  await execFile(tool, [source, '-auto-orient', '-resize', `${width}x`, '-strip', output]);
}

function nativeMimeType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    default:
      throw new Error('Photo must be JPEG, PNG, or WebP');
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function preflightCost(prompt: string, slugs: string[], widths: number[]): number {
  const schema = JSON.stringify(responseSchema(slugs));
  const textAndSchemaTokens = Math.ceil(Buffer.byteLength(prompt + schema, 'utf8') / 4);
  return widths.reduce((total, width) => {
    const tilesPerSide = Math.ceil(width / 768);
    const estimatedImageTokens = tilesPerSide * tilesPerSide * 258;
    return total + estimateCost(textAndSchemaTokens + estimatedImageTokens, MAX_OUTPUT_TOKENS);
  }, 0);
}

function formatUsd(value: number): string {
  return `$${value.toFixed(6)} USD`;
}

function printHumanReport(
  reports: WidthReport[],
  catalog: CatalogResponse,
  resizeTool: ResizeTool | null,
): void {
  console.log(resizeTool === null
    ? 'Resize sweep: not run. magick, convert, and ffmpeg were not found; native resolution was used once.'
    : `Resize tool found: ${resizeTool}`);

  for (const report of reports) {
    const outputTokens = report.usage.candidatesTokenCount + report.usage.thoughtsTokenCount;
    console.log(`\nWidth claim: ${report.width === 'native' ? 'native resolution' : `${report.width}px requested width`}`);
    console.log(`Model-returned detections: ${report.detections.length}`);
    console.log(`API-reported prompt tokens: ${report.usage.promptTokenCount}`);
    console.log(`API-reported image input tokens: ${report.usage.imageTokenCount ?? 'not reported separately'}`);
    console.log(`API-reported output tokens, including thinking: ${outputTokens}`);
    console.log(`Estimated call cost from API-reported token counts: ${formatUsd(report.estimatedCostUsd)}; not a billed figure`);
    console.table(detectionRows(report.detections, catalog));
  }

  const comparison = compareWidths(reports);
  console.log(`\nCatalog slugs found at every tested width: ${comparison.commonSlugs.length}`);
  console.log(comparison.commonSlugs.length === 0 ? 'none' : comparison.commonSlugs.join(', '));
  console.log(`Catalog slugs found at only some tested widths: ${comparison.partialSlugs.length}`);
  for (const entry of comparison.partialSlugs) {
    console.log(`${entry.itemSlug}: ${entry.widths.map((width) => width === 'native' ? 'native' : `${width}px`).join(', ')}`);
  }
  const totalCost = reports.reduce((sum, report) => sum + report.estimatedCostUsd, 0);
  console.log(`Total estimated run cost from API-reported token counts: ${formatUsd(totalCost)}; not a billed figure`);
  console.log(`Published standard rates checked ${PRICING_CHECKED_DATE}: $${INPUT_USD_PER_MILLION_TOKENS}/1M input tokens and $${OUTPUT_USD_PER_MILLION_TOKENS}/1M output tokens; ${PRICING_SOURCE}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<number> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY is required');
    return 1;
  }

  let options: Options;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    console.error(errorMessage(error));
    console.error('Usage: node --import tsx shelf-probe.ts <path-to-photo> [--widths 4032,2048,1024] [--json] [--yes]');
    return 1;
  }

  if (!(await isFile(options.photoPath))) {
    console.error(`Photo is missing: ${options.photoPath}`);
    return 1;
  }

  const catalogPath = process.env.CATALOG_PATH
    ?? fileURLToPath(new URL('../data/catalog.json', import.meta.url));
  const catalog = loadCatalog(catalogPath);
  if (catalog.items.length === 0) {
    console.error('Catalog has no items');
    return 1;
  }

  const slugs = catalog.items.map((item) => item.slug);
  const prompt = shelfPrompt(catalog);
  const resizeTool = findResizeTool();
  const plannedWidths = resizeTool === null ? [Math.max(...options.widths)] : options.widths;
  const preflightEstimatedCostUsd = preflightCost(prompt, slugs, plannedWidths);
  const progress = options.json ? console.error : console.log;
  progress(`Preflight total estimated cost: ${formatUsd(preflightEstimatedCostUsd)} for ${plannedWidths.length} planned model call${plannedWidths.length === 1 ? '' : 's'}; token heuristic at published standard rates, not a billed figure`);
  if (preflightEstimatedCostUsd > CONFIRMATION_THRESHOLD_USD && !options.yes) {
    console.error(`Preflight estimated cost exceeds the $${CONFIRMATION_THRESHOLD_USD.toFixed(2)} USD confirmation threshold. Re-run with --yes to authorize the calls.`);
    return 1;
  }

  const directory = await mkdtemp(join(tmpdir(), 'shelf-probe-'));
  const reports: WidthReport[] = [];
  try {
    const runs: Array<{ width: Width; path: string; mimeType: string }> = [];
    if (resizeTool === null) {
      progress('Resize sweep status: not run; no supported resize tool was found. Running native resolution once.');
      runs.push({ width: 'native', path: options.photoPath, mimeType: nativeMimeType(options.photoPath) });
    } else {
      progress(`Resize tool found: ${resizeTool}`);
      for (const width of options.widths) {
        const path = join(directory, `shelf-${width}.jpg`);
        await resize(resizeTool, options.photoPath, width, path);
        runs.push({ width, path, mimeType: 'image/jpeg' });
      }
    }

    for (const [index, run] of runs.entries()) {
      progress(`Model call progress: ${index + 1}/${runs.length}, ${run.width === 'native' ? 'native resolution' : `${run.width}px requested width`}`);
      const result = await detect(run.path, run.mimeType, prompt, slugs, apiKey);
      const outputTokens = result.usage.candidatesTokenCount + result.usage.thoughtsTokenCount;
      reports.push({
        width: run.width,
        ...result,
        estimatedCostUsd: estimateCost(result.usage.promptTokenCount, outputTokens),
      });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  if (options.json) {
    const totalEstimatedCostUsd = reports.reduce((sum, report) => sum + report.estimatedCostUsd, 0);
    console.log(JSON.stringify({
      model: GEMINI_MODEL,
      resizeTool,
      sweepRun: resizeTool !== null,
      pricing: {
        claim: 'estimated from API-reported token counts at published standard rates, not billed',
        checkedDate: PRICING_CHECKED_DATE,
        source: PRICING_SOURCE,
        inputUsdPerMillionTokens: INPUT_USD_PER_MILLION_TOKENS,
        outputUsdPerMillionTokens: OUTPUT_USD_PER_MILLION_TOKENS,
      },
      preflight: {
        claim: 'estimated cost from token heuristics and the configured output ceiling, not billed',
        estimatedCostUsd: preflightEstimatedCostUsd,
        plannedModelCalls: plannedWidths.length,
      },
      widths: reports.map((report) => ({
        widthClaim: report.width,
        modelReturnedDetectionCount: report.detections.length,
        apiReportedPromptTokens: report.usage.promptTokenCount,
        apiReportedImageInputTokens: report.usage.imageTokenCount,
        apiReportedOutputTokensIncludingThinking: report.usage.candidatesTokenCount + report.usage.thoughtsTokenCount,
        estimatedCallCostUsd: report.estimatedCostUsd,
        detections: report.detections,
      })),
      comparison: compareWidths(reports),
      totalEstimatedCostUsd,
    }));
  } else {
    printHumanReport(reports, catalog, resizeTool);
  }
  return 0;
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
