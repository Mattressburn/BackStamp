/**
 * One polite pass over pyrexlove.com, permission granted by the owners on
 * 2026-08-12 via the user's Facebook thread: facts are fine to restate with a
 * link credited (docs/2026-08-12-source-survey.md, section 8). Same standard as
 * the CMoG pass: sequential, spaced, text pages only, no image requests, cached
 * into gitignored data/pyrexlove-cache/ because their prose is copyrighted and
 * must never ship or be committed. Facts restated in our own words leave the
 * cache; nothing else does.
 *
 * Two-level walk: the pattern guide index links pattern subpages (/in/...) and
 * piece pages (/<slug>/glassware/); pattern subpages link more piece pages.
 * Resume-safe: already-cached URLs are skipped, so a rerun only fills gaps.
 * There is no reason to run this twice once the cache is complete.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = 'https://www.pyrexlove.com';
const GUIDE = `${ROOT}/vintage-pyrex-pattern-guide/`;
const CACHE_DIR = fileURLToPath(new URL('../data/pyrexlove-cache/', import.meta.url));
const CACHE_FILE = `${CACHE_DIR}pages.json`;
const DELAY_MS = 1300;

interface CachedPage {
  url: string;
  fetchedAt: string;
  status: number;
  html: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function links(html: string): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(/href="(?:https:\/\/www\.pyrexlove\.com)?(\/[^"]*)"/g)) {
    const path = match[1];
    if (/^\/in\/[^"]+\/$/.test(path) || /^\/[^"/]+\/glassware\/$/.test(path)) {
      found.add(`${ROOT}${path}`);
    }
  }
  return [...found];
}

async function fetchPage(url: string): Promise<CachedPage> {
  const response = await fetch(url, {
    headers: { 'user-agent': 'Backstamp catalog research (facts-with-credit, by owner permission)' },
  });
  return { url, fetchedAt: new Date().toISOString(), status: response.status, html: await response.text() };
}

const pages: CachedPage[] = await readFile(CACHE_FILE, 'utf8')
  .then((raw) => JSON.parse(raw) as CachedPage[])
  .catch(() => []);
const have = new Set(pages.map((page) => page.url));

async function take(url: string): Promise<CachedPage | null> {
  if (have.has(url)) return pages.find((page) => page.url === url) ?? null;
  const page = await fetchPage(url);
  pages.push(page);
  have.add(url);
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(pages));
  await sleep(DELAY_MS);
  return page;
}

const guide = await take(GUIDE);
if (!guide || guide.status !== 200) throw new Error(`Guide page failed: ${guide?.status}`);

const level1 = links(guide.html);
console.log(`guide links: ${level1.length}`);
const level2 = new Set<string>(level1);
for (const [index, url] of level1.entries()) {
  const page = await take(url);
  if (page && page.status === 200) for (const next of links(page.html)) level2.add(next);
  if ((index + 1) % 25 === 0) console.log(`level 1: ${index + 1}/${level1.length}, discovered ${level2.size}`);
}

const remaining = [...level2].filter((url) => !have.has(url));
console.log(`level 2 remaining: ${remaining.length}`);
for (const [index, url] of remaining.entries()) {
  await take(url);
  if ((index + 1) % 25 === 0) console.log(`level 2: ${index + 1}/${remaining.length}`);
}

const ok = pages.filter((page) => page.status === 200).length;
console.log(`cached ${pages.length} pages (${ok} ok, ${pages.length - ok} non-200) to ${CACHE_FILE}`);
