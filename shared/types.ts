/**
 * Single source of truth for data shapes across app/ and backend/.
 * Both sides import from here. Do not redeclare these anywhere else.
 *
 * The load-bearing idea: a pattern is not an item. Butterprint-on-a-444 and
 * Butterprint-on-a-501 are different collectibles at different prices.
 * `Item` is pattern x form, and `Item.slug` is the join key for everything:
 * catalog records, LLM guesses, eBay queries, collections, photos, prices.
 */

// ---------------------------------------------------------------- catalog

export interface Pattern {
  id: string;              // slug, e.g. "butterprint"
  name: string;            // "Butterprint"
  yearsStart: number | null;
  yearsEnd: number | null;
  colorway: string | null; // "turquoise on white"
  rarity: Rarity;
  notes: string | null;    // our own words, never a book's prose
}

export interface Form {
  id: string;              // slug, e.g. "444-cinderella"
  modelNo: string;         // "444"
  family: FormFamily;
  shape: string;           // "Cinderella bowl"
  capacityQt: number | null;
  dimensions: string | null;
}

export type FormFamily =
  | 'mixing-bowl'
  | 'cinderella-bowl'
  | 'refrigerator-dish'
  | 'casserole'
  | 'divided-dish'
  | 'baking-dish'
  | 'carafe'
  | 'mug'
  | 'other';

export type Rarity = 'common' | 'uncommon' | 'hard-to-find' | 'rare' | 'grail';

/**
 * pattern x form. Only combinations that actually exist in production records,
 * plus user-created entries. Never a cross-product.
 */
export interface Item {
  slug: string;            // `${patternId}-${form.modelNo}` e.g. "butterprint-444"
  patternId: string;
  formId: string;
  rarity: Rarity;          // may differ from the pattern's baseline rarity
  ebayQuery: string;       // "Vintage Pyrex Butterprint 444 Cinderella"
  /** True when a user created this at scan time rather than it coming from the catalog seed. */
  userSubmitted: boolean;
}

/** Item joined with its pattern and form. What the app actually renders. */
export interface ItemDetail extends Item {
  pattern: Pattern;
  form: Form;
  photos: Photo[];
  price: PriceQuote | null;
}

// ---------------------------------------------------------------- collection

export type OwnershipStatus = 'have' | 'want';
export type Condition = 'mint' | 'excellent' | 'good' | 'fair' | 'damaged';

export interface UserItem {
  itemSlug: string;
  status: OwnershipStatus;
  quantity: number;        // 0 for want-list entries
  condition: Condition | null;
  notes: string | null;
  updatedAt: string;       // ISO 8601
}

export interface CollectionValue {
  haveTotal: number;       // sum(median * quantity) across status === 'have'
  wantTotal: number;
  source: PriceSourceKind; // which price source produced these numbers
  itemsPriced: number;
  itemsUnpriced: number;   // no comps found; excluded from the totals
}

// ---------------------------------------------------------------- pricing

/**
 * 'sold' and 'active' are different claims and the UI must always say which.
 * Sold = what pieces actually went for. Active = what sellers are asking.
 */
export type PriceSourceKind = 'sold' | 'active';

export interface PriceQuote {
  itemSlug: string;
  source: PriceSourceKind;
  low: number;
  median: number;
  high: number;
  sampleSize: number;
  currency: 'USD';
  fetchedAt: string;       // ISO 8601
}

// ---------------------------------------------------------------- scanning

export interface ScanGuess {
  itemSlug: string;        // must resolve to a known Item; unresolvable guesses are dropped
  confidence: number;      // 0..1
  reasoning: string;       // short, shown on tap
}

export interface IdentifyRequest {
  /** Base64 JPEGs. First frame is the pattern, second (when present) is the base. */
  photos: string[];
  /** Set when the user grabbed a base shot; the model weights the model number heavily. */
  hasBaseShot: boolean;
}

export interface IdentifyResponse {
  guesses: ScanGuess[];    // up to 3, descending confidence
  /** True when nothing cleared the confidence floor. App goes straight to catalog browse. */
  lowConfidence: boolean;
}

export interface Scan {
  id: string;
  photoRefs: string[];          // empty when the user did not consent to storage
  hasBaseShot: boolean;
  guesses: ScanGuess[];
  confirmedItemSlug: string | null;
  llmWasRight: boolean | null;  // null while unconfirmed
  consentedToTraining: boolean;
  createdAt: string;
}

/** A scan captured offline, waiting on connectivity. Lives only in the app's SQLite. */
export interface QueuedScan {
  localId: string;
  photos: string[];
  hasBaseShot: boolean;
  createdAt: string;
  attempts: number;
}

// ---------------------------------------------------------------- set scanning

/** One physical piece the model matched in a single set photo. */
export interface SetDetection {
  itemSlug: string;        // must resolve to a known Item; unresolvable rows are dropped
  confidence: number;      // 0..1
  location: string;        // where in the frame, e.g. "second bowl from the top of the stack"
  visibleEvidence: string; // what is actually visible; the colorway check reads this
}

export interface IdentifySetRequest {
  /** One base64 JPEG. One nested set or small group filling the frame, no base shot. */
  photo: string;
}

export interface IdentifySetResponse {
  detections: SetDetection[];
  /** Rows dropped because visibleEvidence named colors that contradict the slug's colorway. */
  contradicted: number;
  /** True when nothing survived. App falls back to single-piece scan or browse. */
  lowConfidence: boolean;
}

// ---------------------------------------------------------------- photos

/**
 * 'private' means never published. Some of these pieces are worth four figures and
 * owners reasonably do not want it known they have one.
 */
export type PhotoVisibility = 'attributed' | 'anonymous' | 'private';

export interface Photo {
  id: string;
  itemSlug: string;
  url: string;
  visibility: PhotoVisibility;
  approved: boolean;
  /** Placeholder generated from a written description. Badged in the UI. Never image-to-image. */
  isAiPlaceholder: boolean;
  uploaderHandle: string | null;  // only set when visibility === 'attributed'
  createdAt: string;
}

// ---------------------------------------------------------------- auth

export type AuthProvider = 'google' | 'apple';

/** We store the provider subject and nothing else. No email, no name, no profile. */
export interface Session {
  userId: string;
  provider: AuthProvider;
  token: string;
}

// ---------------------------------------------------------------- transport

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: ApiErrorCode };

export type ApiErrorCode =
  | 'unauthorized'
  | 'not_found'
  | 'rate_limited'
  | 'upstream_failed'
  | 'bad_request'
  | 'internal';

export interface CatalogResponse {
  patterns: Pattern[];
  forms: Form[];
  items: Item[];
  /** Bump to invalidate the app's cached copy. */
  version: number;
}
