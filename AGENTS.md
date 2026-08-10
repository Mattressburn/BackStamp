# Backstamp, build contract

Read `docs/superpowers/specs/2026-08-09-backstamp-design.md` before writing code. It is the
spec. This file is the mechanical contract between parallel workers.

The app is **Backstamp**, named 2026-08-10, replacing the codename `PyDex`. The name
lives in `shared/branding.ts` and nowhere else, never hardcode a product name.

## Non-negotiables

1. **`shared/types.ts` is the single source of truth.** Import from `@shared/types` on
   both sides. Never redeclare a type that already lives there. If a type is missing,
   add it there rather than defining a local one.
2. **A pattern is not an item.** `item = pattern x form`, and `item.slug` joins
   everything: catalog rows, LLM guesses, eBay queries, collections, photos, prices.
   Price attaches to the item, never to the pattern.
3. **EXIF is stripped server-side on ingest, before anything touches disk.** Phone
   photos carry GPS. A public photo of a four-figure piece with the owner's home
   address in the metadata defeats the entire point of the anonymous option.
4. **Store the auth provider's subject ID and nothing else.** No email, no name, no
   profile. Sync stores `(user_id, item_slug, status, quantity)` and nothing more.
5. **Label the price source in the UI.** "sold, last 90 days" and "currently listed"
   are different claims and collectors know it. Never render a bare number.
6. **Do not commit.** Leave changes in the working tree.

## Ownership, stay inside your files

Parallel workers are running. Editing a file outside your assignment will collide.

| Worker | Owns |
|---|---|
| backend | `backend/src/**` |
| scan | `app/src/app/index.tsx`, `app/src/features/scan/**` |
| collection | `app/src/app/collection.tsx`, `app/src/app/item/[slug].tsx`, `app/src/features/collection/**` |
| settings | `app/src/app/settings.tsx` |
| catalog-data | `data/catalog.json`, `scripts/build-catalog.ts` |
| digitizer | `scripts/digitize-book.ts` |

**Already written, read these, do not edit them:**

- `shared/types.ts`, `shared/branding.ts`
- `app/src/db.ts`, local SQLite: catalog cache, collection, offline scan queue
- `app/src/api.ts`, backend client, every network call goes through it
- `app/src/constants/theme.ts`, design tokens

Need a change in a shared file? Write what you need in your own file and leave a
`// CONTRACT:` comment naming the change. The integrator resolves it.

## Design

Read `app/src/constants/theme.ts` first, its header carries the reference lock, and
every color, size, radius and shadow comes from there. No hardcoded hex values, no
magic numbers.

The direction changed on 2026-08-10 and this paragraph changed with it. The chrome no
longer recedes. It used to: the first lock painted the walls off-white and let the
dishes carry the room. Harvest File is period furniture instead, so a solid avocado
header band is correct and the dishes sit inside it as cards. Rarity is still the one
place loud color is correct, because it is a rank collectors read at a glance.

The lock, in one line: a 1970s card file. Avocado, harvest gold and spice brown on
toasted cream; separation is a solid offset shadow with no blur, in a darker tone of the
ground beneath; buttons press 3px down and lose that offset rather than scaling; one
family, Rubik, at 400/700/900. A blur radius anywhere is a bug. Read elevation through
`useElevation()`, never `Elevation.card`, it is keyed by scheme.

Shared primitives live in `app/src/features/collection/collection-ui.tsx`, `Card`,
`PressButton`, `CircleButton`, `HeaderBar`, `FileTabs`, `SpecChip`, `SpecimenTile`,
`PriceFigure`, `RarityBadge`, `RarityPill`, `Label`, `Divider`, `PhotoPlaceholder`. Use
them rather than rebuilding them, especially `PriceFigure`, which exists to make a bare
price impossible.

Follow each platform's conventions rather than forcing one look on both: 44dp minimum
tap targets, real safe-area insets, native-feeling navigation. Support light and dark,
`useColorScheme()` picks the palette. Every interactive element needs an
`accessibilityLabel` and `accessibilityRole`.

## Stack

Expo SDK 56, React Native 0.85.3, expo-router (routes live in `app/src/app/`),
TypeScript strict. Backend is Hono on Node 26 using the built-in `node:sqlite`, no
better-sqlite3, no ORM. Item identification runs on `gemini-3.1-flash-lite` over REST
with global `fetch`; `describePattern` and the image generator stay on `claude-opus-5`
via `@anthropic-ai/sdk`. Whichever key is set picks the identifier, Gemini first.

## Testing

One runnable check per non-trivial piece of logic, the smallest thing that fails if
the logic breaks. No frameworks, no fixtures. A `node --test` file or an
assert-based `main` is enough. Trivial one-liners need no test.
