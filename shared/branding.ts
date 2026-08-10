/**
 * The app name lives here and nowhere else, so a rename stays a one-line change.
 *
 * **Backstamp**, chosen 2026-08-10. A backstamp is the mark on the underside of a
 * piece that identifies it, which is literally what this app reads: the scan flow
 * prompts for a base shot because the embossed model number beats pattern vision.
 * The term is collector-universal rather than Pyrex-specific, so it still fits if the
 * catalog ever grows past Pyrex.
 *
 * It replaces the codename `PyDex`, which could not ship: "Pyrex" is a live trademark
 * (Instant Brands, US) and this app is directly about their product, and "-Dex" draws
 * Nintendo independently. Backstamp names neither.
 *
 * Searched before adopting: no App Store or Play collision found in this category.
 * Ruled out along the way, Shelfie (taken 4x), Vitrine (myvitrine.app, a live
 * competitor), Hutch (Hutch Games holds marks in the apps class).
 *
 * Still outstanding: a proper trademark search before store submission. `isCodename`
 * is now false, so nothing in the build blocks on the name, but that search is not
 * the same thing as an app-store name check, and it has not been done.
 */
export const BRAND = {
  name: 'Backstamp',
  tagline: 'Flip it over. Know what you found.',
  /** False since 2026-08-10. A real trademark search is still owed before submission. */
  isCodename: false,
} as const;
