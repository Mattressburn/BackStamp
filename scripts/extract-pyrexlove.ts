import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  CatalogResponse,
  Form,
  FormFamily,
  Item,
  Pattern,
} from '../shared/types.ts';

interface CachedPage {
  url: string;
  html: string;
}

export interface ExtractedModel {
  modelNo: string;
  capacityQt: number | null;
}

export interface ManufacturePeriod {
  raw: string;
  start: number | null;
  end: number | null;
  season: string | null;
}

export interface ExtractedPiece {
  sourceUrl: string;
  pieceName: string | null;
  patternName: string | null;
  itemType: string | null;
  models: ExtractedModel[] | null;
  years: ManufacturePeriod | null;
  boxNumbers: string[] | null;
  accessories: string[] | null;
}

interface EvidenceCounts {
  newForms: number;
  newItems: number;
  newPatterns: number;
  patternsEnriched: number;
}

interface CapacityConflict {
  modelNo: string;
  readings: Array<{ capacityQt: number; count: number }>;
  chosen: number | null;
}

const patternAliases: Record<string, string> = {
  'blue barcode': 'blue-stripe-barcode',
  'blue floral': 'willow-or-blue-floral',
  bluebird: 'bluebird-casserole',
  'bride s': 'brides-casserole',
  'brown onion': 'raffia-or-brown-onion',
  'buffet twins': 'cinderella-buffet-twins',
  'celtic floral': 'celtic-floral-or-hearts-scroll',
  constellation: 'cinderella-divided-casserole-or-constellation',
  'crazy daisy': 'spring-blossom-green',
  designs: 'arches-or-designs-mixer-set',
  'empire scroll filligree': 'empire-scroll-or-filigree',
  'gold acorn': 'golden-acorn',
  'golden hearts': 'deluxe-cinderella-casserole-or-golden-hearts',
  'golden scroll': 'deluxe-chip-and-dip-set-gold-ivory-or-golden-scroll',
  'golden tulip': 'golden-tulip-casserole',
  'green dot squares': 'green-salad-or-green-dot-squares',
  homestead: 'homestead-blue',
  medallion: 'medallion-casserole',
  'midnight bloom': 'midnight-bloom-or-floral',
  'new dots': 'dots',
  'new holland 1': 'new-holland',
  'old town': 'old-town-blue',
  'snack server compass': 'snack-server-or-compass',
  'speckle lines': 'stack-n-snack-or-speckled-lines',
  spices: 'spices-designer-collection',
  starburst: 'cinderella-serving-casserole-or-starburst',
  'town country': 'town-and-country',
  'twin server set': 'cinderella-twin-server-set',
  'vintage grapes': 'vintage-or-vintage-grapes',
  wicker: 'wicker-or-basket-weave',
};

type PatternTarget = string | string[];

const patternTargetsByPath: Record<string, PatternTarget | Record<string, PatternTarget>> = {
  '/blue-americana-mixing-bowls-400-series/glassware/': 'americana-blue-or-multitone-blue',
  '/butterprint-pink-cinderella-bake-serve-store-casseroles-470/glassware/': 'butterprint-pink',
  '/butterprint-turquoise-cinderella-bake-serve-store-casseroles-470/glassware/': {
    '471': ['butterprint-white-turquoise', 'butterprint-turquoise-white'],
    '472': 'butterprint-white-turquoise',
    '473': ['butterprint-white-turquoise', 'butterprint-turquoise-white'],
  },
  '/desert-dawn-baking-dish-brownie-pan-series-222/glassware/': ['desert-dawn-yellow', 'desert-dawn-pink'],
  '/desert-dawn-cake-dish-series-221/glassware/': ['desert-dawn-yellow', 'desert-dawn-pink'],
  '/desert-dawn-loaf-pan-series-213/glassware/': ['desert-dawn-yellow', 'desert-dawn-pink'],
  '/desert-dawn-pie-plate-series-209/glassware/': ['desert-dawn-yellow', 'desert-dawn-pink'],
  '/desert-dawn-round-casserole-series-024/glassware/': ['desert-dawn-yellow', 'desert-dawn-pink'],
  '/desert-dawn-yellow-oblong-baker-roaster-lasagna-pan-series-231-232/glassware/': ['desert-dawn-yellow', 'desert-dawn-pink'],
  '/fall-colors-brown-americana-mixing-bowl-400-series/glassware/': 'americana-brown',
  '/gourmet-1961-cinderella-round-casserole-475/glassware/': ['gourmet-black', 'gourmet-gold'],
  '/gooseberry-yellow-cinderella-mixing-bowls/glassware/': {
    '441': 'gooseberry-black-white',
    '442': 'gooseberry-black-yellow',
    '443': 'gooseberry-black-white',
    '444': 'gooseberry-black-yellow',
  },
  '/gooseberry-pink-cinderella-mixing-bowls/glassware/': {
    '441': 'gooseberry-pink-white',
    '443': 'gooseberry-pink-white',
  },
  '/new-dot-bowls-400-series/glassware/': {
    '402': 'dots-yellow',
    '403': 'dots-blue',
    '404': 'dots-green',
  },
  '/orange-butterprint-cinderella-bowls-440-series/glassware/': 'butterprint-orange',
  '/black-snowflake-oblong-space-saver-casserole-series-548-575/glassware/': 'snowflake-black',
  '/snowflake-divided-dish-casserole-series-963/glassware/': 'snowflake-turquoise-white',
  '/square-flowers-green-divided-dish-963-series/glassware/': 'autumn-floral-verde',
  '/green-square-flowers-cinderella-round-casseroles-480/glassware/': 'autumn-floral-verde',
  '/trailing-flowers-cinderella-round-casseroles-series-480/glassware/': {
    '474': 'trailing-flowers-or-sprig-hospitality-collection',
    '475': 'sprig-or-trailing-flowers-hospitality-collection',
  },
};

const patternNamesByPath: Record<string, string> = {
  '/american-bicentennial-1976-diagonal-handle-mug-1410-series/glassware/': 'American Bicentennial',
  '/black-d-handle-coffee-mug/glassware/': 'Black',
  '/blue-chip-week-family-day-promotional-casserole-series-473/glassware/': 'Blue Chip Week',
  '/blue-trains-childrens-dinnerware-set/glassware/': 'Blue Trains',
  '/burnt-orange-d-handle-coffee-mug/glassware/': 'Burnt Orange',
  '/celtic-floral-promotional-round-casserole-w-trivet/glassware/': 'Celtic Floral',
  '/charleroi-plant-individual-casserole-700-series/glassware/': 'Charleroi Plant',
  '/chartreuse-honeysuckle-oval-casserole-series-943/glassware/': 'Chartreuse Honeysuckle',
  '/citrus-orange-d-handle-coffee-mug/glassware/': 'Citrus Orange',
  '/clear-pyrex-refrigerator-dishes-500-series/glassware/': 'Clear',
  '/clear-pyrex-tall-custard-cups-6oz-426-series/glassware/': 'Clear',
  '/clear-pyrex-custard-cups-scalloped-10oz-464-series/glassware/': 'Clear',
  '/clear-pyrex-measuring-cups-508-516-532/glassware/': 'Clear',
  '/clear-wide-rim-pie-plate-5-inch-205/glassware/': 'Clear',
  '/compass-star-4-cup-carafe/glassware/': 'Compass Star',
  '/crazy-quilt-promotional-round-casserole-w-trivet/glassware/': 'Crazy Quilt',
  '/crosshatch-dinnerware-set-series-1410/glassware/': 'Cross-Stitch',
  '/delphite-bluebelle-cinderella-oval-divided-dishes-1063-series/glassware/': 'Delphite Bluebelle',
  '/delphite-bluebelle-mixing-bowls-400-series/glassware/': 'Delphite Bluebelle',
  '/delphite-pyrex-oven-refrigerator-dishes-500-series/glassware/': 'Delphite Bluebelle',
  '/ellsworth-pennsylvania-1976-diagonal-handle-mug-1410-series/glassware/': 'Ellsworth Pennsylvania',
  '/flameware-pyrex-coffee-percolator-7754-7756-7759/glassware/': 'Flameware',
  '/flamingo-pink-individual-casserole-series-080/glassware/': 'Flamingo Pink',
  '/flamingo-pink-round-cinderella-casserole-series-024/glassware/': 'Flamingo Pink',
  '/flamingo-pink-square-8-inch-baking-dish-series-222/glassware/': 'Flamingo Pink',
  '/fluted-individual-pie-plate-series-206/glassware/': 'Clear',
  '/flower-power-diagonal-mouth-juice-carafe/glassware/': 'Flower Power',
  '/gold-band-livingware-salt-pepper-shaker/glassware/': 'Gold Band',
  '/green-blue-gray-oblong-baker-roaster-lasagna-pan-series-507/glassware/': 'Green Blue',
  '/lime-green-oblong-baker-roaster-lasagna-pan-series-231-232/glassware/': 'Lime Green',
  '/lime-green-round-cinderella-casserole-series-024/glassware/': 'Lime Green',
  '/lime-green-square-8-inch-baking-dish-series-222/glassware/': 'Lime Green',
  '/lincoln-center-promotional-casserole-1962/glassware/': 'Lincoln Center',
  '/mod-kitchen-decorator-1958-cinderella-oval-casserole-series-043/glassware/': 'Mod Kitchen',
  '/opal-white-coffee-tea-mugs/glassware/': 'Opal White',
  '/opal-white-loaf-baking-dish-series-213/glassware/': 'Opal White',
  '/opal-white-pie-plate-series-209/glassware/': 'Opal White',
  '/opal-white-pyrex-bowls-400-series/glassware/': 'Opal White',
  '/opal-white-pyrex-oven-refrigerator-dishes-500-series/glassware/': 'Opal White',
  '/opal-white-soup-bowls/glassware/': 'Opal White',
  '/pink-pyrex-bowls-400-series/glassware/': 'Pink',
  '/primary-color-pyrex-bowls-400-series/glassware/': 'Primary Colors',
  '/primary-color-pyrex-oven-refrigerator-dishes-500-series/glassware/': 'Primary Colors',
  '/pyrex-at-home-lab-diagonal-handle-mug-1410-series/glassware/': 'At Home in Your Lab',
  '/pyrex-charleroi-1972-diagonal-handle-mug-1410-series/glassware/': 'Charleroi',
  '/pyrex-charleroi-1984-standard-d-handle-mug/glassware/': 'Charleroi Family Day',
  '/pyrex-charleroi-red-brown-standard-d-handle-mug/glassware/': 'Charleroi Total Quality',
  '/pyrex-eyes-chip-and-dip/glassware/': 'Eyes',
  '/pyrex-labware-diagonal-handle-mug-1410-series/glassware/': 'Pyrex Labware',
  '/red-hostess-casserole-and-table-set-515/glassware/': 'Red Hostess',
  '/red-hostess-oven-and-table-set-525/glassware/': 'Red Hostess',
  '/rose-pink-square-bowl-chip-dip-set/glassware/': 'Rose Pink',
  '/safety-and-health-promotional-mug-series-723/glassware/': 'Safety and Health',
  '/seasons-greetings-d-handle-coffee-mug/glassware/': "Season's Greetings",
  '/souffle-dishes-pyrex-red-yellow-white/glassware/': 'Red, White, and Yellow',
  '/steel-blue-d-handle-coffee-mug/glassware/': 'Steel Blue',
  '/turquoise-cinderella-bowl-chip-dip-set/glassware/': 'Turquoise',
  '/turquoise-pyrex-oven-refrigerator-dishes-500-series/glassware/': 'Turquoise',
  '/turquoise-solid-mixing-bowls/glassware/': 'Turquoise',
  '/turquoise-square-8-inch-baking-dish-series-222/glassware/': 'Turquoise',
  '/vintage-bicycles-diagonal-handle-coffee-mug/glassware/': 'Vintage Bicycles',
  '/westinghouse-pyrex-clear-mixer-bowls/glassware/': 'Clear',
  '/whiskey-rebellion-1976-diagonal-handle-mug-1410-series/glassware/': 'Whiskey Rebellion',
  '/yellow-pyrex-bowls-400-series/glassware/': 'Yellow',
  '/yellow-round-cinderella-casserole-series-024/glassware/': 'Yellow',
};

const formDescriptionsByModel: Record<string, { family: FormFamily; shape: string }> = {
  '025': { family: 'other', shape: 'Square serving bowl' },
  '32': { family: 'other', shape: 'Butter dish' },
  '033': { family: 'casserole', shape: 'Oblong casserole' },
  '035': { family: 'casserole', shape: 'Oblong casserole' },
  '055': { family: 'casserole', shape: 'Oblong casserole' },
  '058': { family: 'casserole', shape: 'Oblong casserole' },
  '72': { family: 'other', shape: 'Butter dish' },
  '080': { family: 'casserole', shape: 'Individual round casserole' },
  '201': { family: 'baking-dish', shape: 'Pie plate' },
  '205': { family: 'baking-dish', shape: 'Pie plate' },
  '206': { family: 'baking-dish', shape: 'Pie plate' },
  '207': { family: 'baking-dish', shape: 'Pie plate' },
  '208': { family: 'baking-dish', shape: 'Pie plate' },
  '209': { family: 'baking-dish', shape: 'Pie plate' },
  '210': { family: 'baking-dish', shape: 'Pie plate' },
  '211': { family: 'baking-dish', shape: 'Pie plate' },
  '213': { family: 'baking-dish', shape: 'Loaf pan' },
  '221': { family: 'baking-dish', shape: 'Round cake dish' },
  '222': { family: 'baking-dish', shape: 'Square baking dish' },
  '231': { family: 'baking-dish', shape: 'Oblong baking dish' },
  '232': { family: 'baking-dish', shape: 'Oblong baking dish' },
  '326': { family: 'mixing-bowl', shape: 'Round mixing bowl' },
  '343': { family: 'casserole', shape: 'Round casserole' },
  '344': { family: 'casserole', shape: 'Round casserole' },
  '357': { family: 'other', shape: 'Dinner plate' },
  '407': { family: 'other', shape: 'Hostess serving bowl' },
  '410': { family: 'other', shape: 'Square serving bowl' },
  '426': { family: 'other', shape: 'Custard cup' },
  '464': { family: 'other', shape: 'Custard cup' },
  '478': { family: 'mixing-bowl', shape: 'Round mixing bowl' },
  '479': { family: 'mixing-bowl', shape: 'Round mixing bowl' },
  '483': { family: 'casserole', shape: 'Round casserole' },
  '484': { family: 'baking-dish', shape: 'Round tart pan' },
  '485': { family: 'casserole', shape: 'Round casserole' },
  '486': { family: 'baking-dish', shape: 'Round tart pan' },
  '489': { family: 'mug', shape: 'Hearth mug' },
  '507': { family: 'baking-dish', shape: 'Oblong baking dish' },
  '508': { family: 'other', shape: 'Measuring cup' },
  '515': { family: 'casserole', shape: 'Hostess casserole' },
  '516': { family: 'other', shape: 'Measuring cup' },
  '525': { family: 'casserole', shape: 'Hostess casserole' },
  '532': { family: 'other', shape: 'Measuring cup' },
  '706': { family: 'other', shape: 'Sauce dish' },
  '708': { family: 'other', shape: 'Tableware bowl' },
  '709': { family: 'mug', shape: 'Tableware mug' },
  '711': { family: 'other', shape: 'Small plate' },
  '722': { family: 'other', shape: 'Creamer' },
  '723': { family: 'mug', shape: 'Tableware mug' },
  '795': { family: 'other', shape: 'Dinner plate' },
  '943': { family: 'casserole', shape: 'Oval covered casserole' },
  '945': { family: 'casserole', shape: 'Oval covered casserole' },
  '963': { family: 'divided-dish', shape: 'Oval divided serving dish' },
  '1063': { family: 'divided-dish', shape: 'Oval divided serving dish' },
  '1416': { family: 'other', shape: 'Cereal bowl' },
  '7754': { family: 'carafe', shape: 'Coffee percolator' },
  '7756': { family: 'carafe', shape: 'Coffee percolator' },
  '7759': { family: 'carafe', shape: 'Coffee percolator' },
};

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;|&#34;|&#8220;|&#8221;/gi, '"')
    .replace(/&apos;|&#39;|&#8216;|&#8217;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

function labeledField(html: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(
    new RegExp(`<b>\\s*${escaped}\\s*:?\\s*<\\/b>([\\s\\S]*?)<br\\s*\\/?\\s*>`, 'i'),
  );
  const value = match ? decodeHtml(match[1]) : '';
  return value || null;
}

function parseAmount(value: string): number | null {
  const mixed = value.match(/(\d+)\s+(\d+)\s*\/\s*(\d+)/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = value.match(/(\d+)\s*\/\s*(\d+)/);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  const decimal = value.match(/\d+(?:\.\d+)?/);
  return decimal ? Number(decimal[0]) : null;
}

function parseCapacity(value: string): number | null {
  const match = value.match(
    /(\d+(?:\.\d+)?|\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+)\s*(quarts?|qt\.?|pints?|pt\.?|cups?|ounces?|oz\.?|millilit(?:er|re)s?|ml|lit(?:er|re)s?|l)\b/i,
  );
  if (!match) return null;
  const amount = parseAmount(match[1]);
  if (amount === null) return null;
  const unit = match[2].toLowerCase().replace('.', '');
  if (unit.startsWith('pint') || unit === 'pt') return amount / 2;
  if (unit.startsWith('cup')) return amount / 4;
  if (unit.startsWith('ounce') || unit === 'oz') return amount / 32;
  if (unit.startsWith('millilit') || unit === 'ml') {
    return Number(((amount / 1000) * 1.056688).toFixed(4));
  }
  if (unit.startsWith('lit') || unit === 'l') {
    return Number((amount * 1.056688).toFixed(4));
  }
  return amount;
}

function parseModels(value: string | null): ExtractedModel[] | null {
  if (!value || /^(?:no markings?|no number)$/i.test(value.trim())) return null;
  const matches = [
    ...value.matchAll(
      /#([A-Z]?\d+[A-Z]*)(?:\/([A-Z]?\d+[A-Z]*))?|(?:^|[\s,;])([A-Z]?\d{2,4}[A-Z]*)(?=\s*\()/gi,
    ),
  ];
  const models: ExtractedModel[] = [];
  for (const [index, match] of matches.entries()) {
    const end = matches[index + 1]?.index ?? value.length;
    const segment = value.slice(match.index! + match[0].length, end);
    const capacityQt = parseCapacity(segment);
    if (
      capacityQt === null &&
      /^\s*(?:\(\s*)?(?:lid|(?:glass\s+|metal\s+)?cover|box number)\b/i.test(segment)
    ) continue;
    for (const modelNo of [match[1] ?? match[3], match[2]].filter(
      (candidate): candidate is string => Boolean(candidate),
    )) {
      if (modelNo === '550') continue;
      models.push({ modelNo: modelNo.toUpperCase(), capacityQt });
    }
  }
  const byModel = new Map<string, ExtractedModel>();
  for (const model of models) {
    const existing = byModel.get(model.modelNo);
    if (!existing || (existing.capacityQt === null && model.capacityQt !== null)) {
      byModel.set(model.modelNo, model);
    }
  }
  const unique = [...byModel.values()];
  return unique.length > 0 ? unique : null;
}

function parseYears(value: string | null): ManufacturePeriod | null {
  if (!value || value.includes('?')) return null;
  const season = value.match(/\b(Spring|Summer|Fall|Winter|Christmas|Holidays?|Holiday)\b/i)?.[1] ?? null;
  const years = [...value.matchAll(/\b(19|20)\d{2}s?\b/g)].map((match) => ({
    year: Number(match[0].slice(0, 4)),
    decade: match[0].endsWith('s'),
  }));
  if (years.length === 0) return null;
  return {
    raw: value,
    start: years[0].year,
    end: /\b(?:later|modern|present)\b/i.test(value)
      ? null
      : years.at(-1)!.year + (years.at(-1)!.decade ? 9 : 0),
    season,
  };
}

function parseBoxNumbers(value: string | null): string[] | null {
  if (!value || value.includes('?')) return null;
  const numbers = value.split(',').map((part) => part.trim()).filter(Boolean);
  return numbers.length > 0 ? numbers : null;
}

function parseAccessories(html: string): string[] | null {
  const content = decodeHtml(html.split(/<div\s+id=["']sidebar/i)[0]);
  const sentences = content.split(/(?<=[.!?])\s+|\s*\|\s*/);
  const uncertain = /\b(?:believe|guess|maybe|may|might|no|not|sure|think|uncertain|unknown|without)\b|don't know|do not know/i;
  const included = (term: RegExp): boolean => {
    if (sentences.some((sentence) => term.test(sentence) && uncertain.test(sentence))) return false;
    return sentences.some((sentence) => {
    if (!term.test(sentence)) return false;
    return /\bw\s*\/|\bwith\b|\b(?:accompanied|came|comes|has|have|include[ds]?|package[ds]?|paired|sold)\b/i.test(sentence);
    });
  };
  const accessories = [
    included(/\bcandle warmer\b/i) ? 'candle warmer' : null,
    included(/\bcradle\b/i) ? 'cradle' : null,
    included(/\btrivet\b/i) ? 'trivet' : null,
  ].filter((value): value is string => value !== null);
  return accessories.length > 0 ? accessories : null;
}

export function parsePiecePage(page: CachedPage): ExtractedPiece {
  const pieceName = page.html.match(/<h2\b[^>]*id=["']post-[^"']+["'][^>]*>[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1];
  return {
    sourceUrl: page.url,
    pieceName: pieceName ? decodeHtml(pieceName) : null,
    patternName: null,
    itemType: labeledField(page.html, 'Item Type'),
    models: parseModels(labeledField(page.html, 'Sizes and ID#s')),
    years: parseYears(labeledField(page.html, 'Years Manufactured')),
    boxNumbers: parseBoxNumbers(labeledField(page.html, 'Original Box#s')),
    accessories: parseAccessories(page.html),
  };
}

function absoluteSourceUrl(href: string): string {
  return new URL(href, 'https://www.pyrexlove.com').href;
}

export function extractPieceRecords(pages: CachedPage[]): ExtractedPiece[] {
  const patternNames = new Map<string, string>();
  const index = pages.find((page) => page.url.endsWith('/vintage-pyrex-pattern-guide/'));
  for (const match of index?.html.matchAll(
    /<a href="([^"]+\/glassware\/)">[\s\S]*?<div class="pattern"><b>([^<]+)<\/b>/gi,
  ) ?? []) {
    patternNames.set(
      absoluteSourceUrl(match[1]),
      decodeHtml(match[2]).replace(/\s+[#*&%]+$/, ''),
    );
  }

  const genericPatternPages = new Set([
    'advertising-specialty',
    'promotional',
    'solid-colors',
    'vintage-color-patterns',
  ]);
  for (const page of pages.filter((candidate) => candidate.url.includes('/in/vintage-color-patterns/'))) {
    const slug = new URL(page.url).pathname.split('/').filter(Boolean).at(-1);
    if (!slug || genericPatternPages.has(slug)) continue;
    const title = page.html.match(/<title>(.*?)\s*:\s*Pyrex Love<\/title>/i)?.[1];
    if (!title) continue;
    for (const match of page.html.matchAll(/href="([^"]+\/glassware\/)"/gi)) {
      const sourceUrl = absoluteSourceUrl(match[1]);
      if (!patternNames.has(sourceUrl)) patternNames.set(sourceUrl, decodeHtml(title));
    }
  }

  for (const page of pages.filter((candidate) => candidate.url.includes('/in/clear-pyrex-ovenware/'))) {
    for (const match of page.html.matchAll(/href="([^"]+\/glassware\/)"/gi)) {
      const sourceUrl = absoluteSourceUrl(match[1]);
      if (!patternNames.has(sourceUrl)) patternNames.set(sourceUrl, 'Clear');
    }
  }

  for (const [path, name] of Object.entries(patternNamesByPath)) {
    patternNames.set(absoluteSourceUrl(path), name);
  }

  return pages
    .filter((page) => page.url.endsWith('/glassware/'))
    .map((page) => ({
      ...parsePiecePage(page),
      patternName: patternNames.get(page.url) ?? null,
    }));
}

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function slugify(value: string): string {
  return normalize(value.replace(/['’]/g, '')).replace(/\s+/g, '-');
}

function sentenceList(values: string[]): string {
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;
}

function evidenceNote(record: ExtractedPiece): string | null {
  const sentences: string[] = [];
  if (record.years && record.models) {
    const date = record.years.season && record.years.start
      ? `for ${record.years.season} ${record.years.start}`
      : record.years.start !== null && record.years.end === null
        ? `from ${record.years.start} onward`
      : record.years.start === record.years.end
        ? `for ${record.years.start}`
        : `from ${record.years.start} through ${record.years.end}`;
    sentences.push(
      `Documented ${date} on model${record.models.length === 1 ? '' : 's'} ${sentenceList(record.models.map((model) => model.modelNo))}.`,
    );
  }
  if (record.accessories) {
    sentences.push(`The package included ${record.accessories.length === 1 ? 'a ' : ''}${sentenceList(record.accessories)}.`);
  }
  return sentences.length > 0 ? sentences.join(' ') : null;
}

function formDescription(itemType: string | null): { family: FormFamily; shape: string } {
  const cleaned = (itemType ?? 'Other piece')
    .replace(/^Promotional\s+/i, '')
    .replace(/\s+Series\s+[A-Z0-9 /-]+$/i, '')
    .replace(/Casseroles$/i, 'Casserole')
    .trim();
  const lower = cleaned.toLowerCase();
  let family: FormFamily = 'other';
  if (lower.includes('cinderella bowl')) family = 'cinderella-bowl';
  else if (lower.includes('mixing bowl')) family = 'mixing-bowl';
  else if (lower.includes('refrigerator')) family = 'refrigerator-dish';
  else if (lower.includes('divided')) family = 'divided-dish';
  else if (lower.includes('casserole')) family = 'casserole';
  else if (/\b(?:baking|baker|loaf|pie|utility)\b/.test(lower)) family = 'baking-dish';
  else if (/\b(?:carafe|pitcher)\b/.test(lower)) family = 'carafe';
  else if (lower.includes('mug')) family = 'mug';
  return { family, shape: cleaned[0].toUpperCase() + cleaned.slice(1).toLowerCase() };
}

function majorityCapacities(records: ExtractedPiece[]): {
  capacities: Map<string, number | null>;
  conflicts: CapacityConflict[];
} {
  const readings = new Map<string, Map<number, number>>();
  for (const record of records) {
    for (const model of record.models ?? []) {
      if (model.capacityQt === null) continue;
      const counts = readings.get(model.modelNo) ?? new Map<number, number>();
      counts.set(model.capacityQt, (counts.get(model.capacityQt) ?? 0) + 1);
      readings.set(model.modelNo, counts);
    }
  }
  const capacities = new Map<string, number | null>();
  const conflicts: CapacityConflict[] = [];
  for (const [modelNo, counts] of readings) {
    const values = [...counts].sort((a, b) => a[0] - b[0]);
    const groups: Array<{ values: Array<[number, number]>; count: number }> = [];
    for (const reading of values) {
      // ponytail: 7% groups rounded metric and imperial labels; use unit-aware source values if closer products appear.
      const group = groups.find(
        (candidate) => Math.abs(candidate.values[0][0] - reading[0]) / candidate.values[0][0] <= 0.07,
      );
      if (group) {
        group.values.push(reading);
        group.count += reading[1];
      } else {
        groups.push({ values: [reading], count: reading[1] });
      }
    }
    const rankedGroups = groups.sort((a, b) => b.count - a.count || a.values[0][0] - b.values[0][0]);
    const winningGroup =
      rankedGroups.length === 1 || rankedGroups[0].count > rankedGroups[1].count
        ? rankedGroups[0]
        : null;
    const chosen = winningGroup
      ? [...winningGroup.values].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]
      : null;
    capacities.set(modelNo, chosen);
    if (rankedGroups.length > 1) {
      conflicts.push({
        modelNo,
        readings: [...counts]
          .sort((a, b) => b[1] - a[1] || a[0] - b[0])
          .map(([capacityQt, count]) => ({ capacityQt, count })),
        chosen,
      });
    }
  }
  return { capacities, conflicts };
}

function findPattern(catalog: CatalogResponse, name: string): Pattern | undefined {
  const alias = patternAliases[normalize(name)];
  if (alias) return catalog.patterns.find((pattern) => pattern.id === alias);
  const wanted = normalize(name);
  return catalog.patterns.find(
    (pattern) => normalize(pattern.id) === wanted || normalize(pattern.name) === wanted,
  );
}

function configuredPatterns(
  catalog: CatalogResponse,
  record: ExtractedPiece,
  modelNo: string,
): Pattern[] | null {
  const configured = patternTargetsByPath[new URL(record.sourceUrl).pathname];
  if (!configured) return null;
  const target = typeof configured === 'string' || Array.isArray(configured)
    ? configured
    : configured[modelNo];
  if (!target) return null;
  return (Array.isArray(target) ? target : [target]).map((id) => {
    const pattern = catalog.patterns.find((candidate) => candidate.id === id);
    if (!pattern) throw new Error(`Pattern override references missing pattern "${id}"`);
    return pattern;
  });
}

function queryName(name: string): string {
  return name.replace(/^Pyrex\s+/i, '').replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
}

export function applyEvidence(
  source: CatalogResponse,
  records: ExtractedPiece[],
): { catalog: CatalogResponse; counts: EvidenceCounts; conflicts: CapacityConflict[] } {
  const catalog = structuredClone(source);
  const counts: EvidenceCounts = {
    newForms: 0,
    newItems: 0,
    newPatterns: 0,
    patternsEnriched: 0,
  };
  const enriched = new Set<string>();
  const openEndedPatterns = new Set<string>();
  const initialPatternIds = new Set(source.patterns.map((pattern) => pattern.id));
  const { capacities, conflicts } = majorityCapacities(records);
  const formsByModel = new Map(catalog.forms.map((form) => [form.modelNo, form]));
  const itemSlugs = new Set(catalog.items.map((item) => item.slug));

  for (const record of records) {
    if (!record.patternName || !record.years || record.years.end !== null) continue;
    let configured = false;
    for (const modelNo of record.models?.map((model) => model.modelNo) ?? ['']) {
      const patterns = configuredPatterns(catalog, record, modelNo);
      if (!patterns) continue;
      configured = true;
      for (const pattern of patterns) openEndedPatterns.add(pattern.id);
    }
    if (!configured) {
      const pattern = findPattern(catalog, record.patternName);
      if (pattern) openEndedPatterns.add(pattern.id);
    }
  }

  for (const record of records) {
    if (!record.patternName) continue;
    let defaultPattern: Pattern | undefined;
    const patternsFor = (modelNo: string): Pattern[] => {
      const configured = configuredPatterns(catalog, record, modelNo);
      if (configured) return configured;
      if (!defaultPattern) {
        defaultPattern = findPattern(catalog, record.patternName!);
        if (!defaultPattern) {
          defaultPattern = {
            id: slugify(record.patternName!),
            name: record.patternName!,
            yearsStart: record.years?.start ?? null,
            yearsEnd: record.years?.end ?? null,
            colorway: null,
            rarity: null,
            notes: evidenceNote(record),
          };
          catalog.patterns.push(defaultPattern);
          if (record.years?.end === null) openEndedPatterns.add(defaultPattern.id);
          counts.newPatterns += 1;
        }
      }
      return [defaultPattern];
    };
    const recordPatterns = new Map<string, Pattern>();
    for (const model of record.models ?? []) {
      for (const pattern of patternsFor(model.modelNo)) recordPatterns.set(pattern.id, pattern);
    }
    if (recordPatterns.size === 0 && !patternTargetsByPath[new URL(record.sourceUrl).pathname]) {
      for (const pattern of patternsFor('')) recordPatterns.set(pattern.id, pattern);
    }
    for (const pattern of recordPatterns.values()) {
      let changed = false;
      if (initialPatternIds.has(pattern.id)) {
        if (pattern.yearsStart === null && record.years?.start !== null && record.years?.start !== undefined) {
          pattern.yearsStart = record.years.start;
          changed = true;
        }
        if (
          !openEndedPatterns.has(pattern.id) &&
          pattern.yearsEnd === null &&
          record.years?.end !== null &&
          record.years?.end !== undefined
        ) {
          pattern.yearsEnd = record.years.end;
          changed = true;
        }
      } else if (record.years) {
        const start = record.years.start;
        const end = record.years.end;
        if (start !== null && (pattern.yearsStart === null || start < pattern.yearsStart)) {
          pattern.yearsStart = start;
          changed = true;
        }
        if (end === null) {
          pattern.yearsEnd = null;
          openEndedPatterns.add(pattern.id);
        } else if (
          !openEndedPatterns.has(pattern.id) &&
          (pattern.yearsEnd === null || end > pattern.yearsEnd)
        ) {
          pattern.yearsEnd = end;
          changed = true;
        }
      }
      const note = evidenceNote(record);
      if (pattern.notes === null && note) {
        pattern.notes = note;
        changed = true;
      }
      if (changed && initialPatternIds.has(pattern.id) && !enriched.has(pattern.id)) {
        enriched.add(pattern.id);
        counts.patternsEnriched += 1;
      }
    }

    for (const model of record.models ?? []) {
      let form = formsByModel.get(model.modelNo);
      if (!form) {
        const description = formDescriptionsByModel[model.modelNo] ?? formDescription(record.itemType);
        form = {
          id: `${model.modelNo}-${slugify(description.shape)}`,
          modelNo: model.modelNo,
          family: description.family,
          shape: description.shape,
          capacityQt: capacities.get(model.modelNo) ?? null,
          dimensions: null,
        } satisfies Form;
        catalog.forms.push(form);
        formsByModel.set(model.modelNo, form);
        counts.newForms += 1;
      }
      for (const pattern of patternsFor(model.modelNo)) {
        const slug = `${pattern.id}-${model.modelNo}`;
        if (itemSlugs.has(slug)) continue;
        catalog.items.push({
          slug,
          patternId: pattern.id,
          formId: form.id,
          rarity: null,
          ebayQuery: `Vintage Pyrex ${queryName(pattern.name)} ${model.modelNo} ${form.shape.replace(/\b\w/g, (letter) => letter.toUpperCase())}`,
          userSubmitted: false,
          provenance: 'published-reference',
        } satisfies Item);
        itemSlugs.add(slug);
        counts.newItems += 1;
      }
    }
  }
  if (counts.newForms + counts.newItems + counts.newPatterns + counts.patternsEnriched > 0) {
    catalog.version += 1;
  }
  return { catalog, counts, conflicts };
}

async function main(): Promise<void> {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const cachePath = resolve(scriptDir, '../data/pyrexlove-cache/pages.json');
  const catalogPath = resolve(scriptDir, '../data/catalog.json');
  const pages = JSON.parse(await readFile(cachePath, 'utf8')) as CachedPage[];
  const records = extractPieceRecords(pages);
  const catalogRaw = await readFile(catalogPath, 'utf8');
  const catalog = JSON.parse(catalogRaw) as CatalogResponse;
  const result = applyEvidence(catalog, records);
  const nextCatalog = `${JSON.stringify(result.catalog, null, 2)}\n`;
  if (nextCatalog !== catalogRaw) await writeFile(catalogPath, nextCatalog);
  const missing = Object.fromEntries(
    (['pieceName', 'patternName', 'itemType', 'models', 'years', 'boxNumbers', 'accessories'] as const)
      .map((field) => [field, records.filter((record) => record[field] === null).length]),
  );
  const unparseable = records.filter((record) => record.itemType === null && record.models === null);
  console.log(`Piece pages parsed: ${records.length}`);
  console.log(`Records extracted: ${records.length}`);
  console.log(
    `Fields missing: ${Object.entries(missing).map(([field, count]) => `${field}=${count}`).join(', ')}`,
  );
  console.log(
    `Catalog changes: forms=${result.counts.newForms}, items=${result.counts.newItems}, ` +
      `patterns=${result.counts.newPatterns}, patterns enriched=${result.counts.patternsEnriched}`,
  );
  console.log(`Capacity conflicts: ${result.conflicts.length}`);
  for (const conflict of result.conflicts) {
    const readings = conflict.readings
      .map((reading) => `${reading.capacityQt} qt (${reading.count})`)
      .join(', ');
    console.log(`  ${conflict.modelNo}: ${readings}; kept ${conflict.chosen ?? 'null'}`);
  }
  console.log(`Unparseable pages: ${unparseable.length}`);
  for (const record of unparseable) console.log(`  ${record.sourceUrl}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
