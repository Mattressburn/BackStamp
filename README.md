# Backstamp

Photograph a piece of vintage Pyrex, find out what it is, see what comparable pieces
sell for, and track what you own and what you're hunting.

A backstamp is the mark on the underside of a piece that identifies it — which is
literally what this app reads, since the scan flow asks for a base shot because the
embossed model number beats pattern vision. The name replaced the codename `PyDex` on
2026-08-10: "Pyrex" is a live trademark and this app is directly about that product,
and "-Dex" draws Nintendo separately. The name lives in `shared/branding.ts` and
nowhere else. Design spec: `docs/superpowers/specs/2026-08-09-backstamp-design.md`.

## Layout

```
docs/superpowers/specs/     the design spec — read this first
AGENTS.md                   build contract: file ownership, non-negotiables
shared/types.ts             single source of truth for every data shape
shared/branding.ts          the app name, in exactly one place
app/                        Expo app (iOS + Android)
backend/                    Hono API on Node 26 + node:sqlite
data/catalog.json           seeded patterns, forms, items
scripts/digitize-book.ts    one-off book -> catalog JSON extractor
```

## Running it

Node 26 and npm are the only prerequisites. Dependencies are already installed.

**Backend** — needs to be up before the app can identify or price anything:

```bash
cd backend
cp .env.example .env      # then fill in the keys below
npm run dev               # http://0.0.0.0:8787
```

**App** — Expo Go on a physical phone. There is no iOS Simulator on Linux, so an actual
iPhone is the only way to see iOS:

```bash
cd app
npx expo start            # scan the QR code with Expo Go
```

The app defaults to `http://192.168.69.242:8787` (MRDockBox over the LAN). Override with
`EXPO_PUBLIC_API_URL` when the backend runs somewhere else:

```bash
EXPO_PUBLIC_API_URL=http://192.168.69.221:8787 npx expo start
```

Phone and backend must be on the same network. `localhost` will not work from a phone.

**Checks** — all currently passing:

```bash
npm --prefix backend run typecheck                                  # backend types
cd app && npx tsc --noEmit                                          # app types

# Tests need the tsx loader: tsconfig path aliases (@shared/*) and NodeNext's
# .js-extension imports are both invisible to bare `node --test`.
cd backend && node --import tsx --test "src/**/*.test.ts"           # 23 tests
cd app     && node --import tsx --test "src/**/*.test.ts"           # 13 tests
cd scripts && node --import tsx --test "*.test.ts"                  #  4 tests
cd scripts && node --import tsx build-catalog.ts                    # validates data/catalog.json

cd app && npx expo export --platform ios                            # proves Metro bundles
```

The Expo export is worth running after any change to `shared/` — `tsc` reads tsconfig
`paths` and Metro does not, so a passing typecheck is not evidence the app bundles.

## Environment

| Variable | Used for | Required |
|---|---|---|
| `ANTHROPIC_API_KEY` | Identification (`claude-opus-5` vision) | Yes |
| `SOLDCOMPS_API_KEY` | Sold price comps | No — falls back to active listings |
| `EBAY_APP_ID` | eBay Browse, active listings | No — pricing degrades to unavailable |
| `IMAGE_GEN_API_KEY` | AI placeholder images for uncatalogued patterns | No — no placeholder generated |
| `EXPO_PUBLIC_API_URL` | Backend URL the app calls | No — defaults to the LAN address above |

A missing optional key disables that one feature. It must not crash the server.

## Building for a store

iOS requires EAS Build — this machine is Linux, so there is no Xcode and no local iOS
toolchain. Hosted macOS runners are the only path:

```bash
npx eas build --platform ios
npx eas build --platform android
```

The name is settled, so `BRAND.isCodename` is now `false`. A proper trademark search on
"Backstamp" is still owed before submission — an app-store name check is not the same
thing, and it has not been done.

## Status — 2026-08-09

This is a rough draft. Everything below compiles, typechecks, passes its tests, and
bundles for iOS. The backend boots and serves live requests — `GET /catalog` returns all
379 items, `GET /items/:slug` returns the joined pattern/form/price shape, and
`/collection` correctly refuses unauthenticated requests.

**Not yet done: none of it has run on a phone**, and no route has been exercised against
a real Anthropic, SoldComps, or eBay key — so identification and pricing are structurally
correct and empirically unproven.

**Working and verified:** backend routes and SQLite schema; EXIF stripping (2 tests,
including one proving an APP1 segment is actually removed); pricing with the sold →
active fallback, weekly per-item caching, and concurrent-request coalescing; the scan
screen with burst capture and offline queue; collection, item detail, and settings;
catalog of 379 items across 33 patterns and 30 forms; the book digitizer. 32 tests pass.

**Known incomplete — none of these are hidden behind a green test:**

- Placeholder image generation assumes OpenAI's `gpt-image-2`. Unconfigured, the catalog
  entry is still created, just without art. Provider is still an open decision.
- Attributed photo uploads have no handle to attribute to — auth deliberately stores no
  profile — so they queue with `uploaderHandle: null`. Needs a display-name field that
  is separate from identity.
- Public photos have an approval column but no review tool.
- No application-level rate limiting. Put a gateway in front of `/identify` and the
  pricing routes before exposing them publicly; `/identify` costs money per call.
- Collection sync carries only `(user_id, item_slug, status, quantity)` by design, so
  `condition`, `notes`, and `updatedAt` stay device-local and do not survive a reinstall.
- Tab bar icons are the Expo template's, copied to fill three slots. They are wrong on
  purpose — real glyphs are a design-pass job.
- `app.json` now carries the name, bundle identifier `com.backstamp.app`, camera usage
  strings, and `usesAppleSignIn`. Google OAuth client IDs are still missing, so
  "Continue with Google" renders as *Not configured*.
- **Running on Expo SDK 56, not 57.** SDK 57 released too recently for the App Store
  build of Expo Go to support it, and Expo Go refuses a project newer than itself. The
  SDK 57 `package.json` is backed up in the session scratchpad if you want to move back
  once Expo Go catches up — but do not upgrade casually, it breaks phone testing.
- The UI is functional and unpolished. A design pass is the next session's work.

## Two things worth knowing before reading the code

**A pattern is not an item.** Butterprint on a 444 Cinderella bowl and Butterprint on a
501 refrigerator dish are different collectibles at different prices. `item = pattern ×
form`, and `item.slug` is what joins catalog rows, identification guesses, eBay queries,
collections, photos, and prices. Price attaches to the item.

**Sold prices and asking prices are different claims.** eBay closed its sold-data API to
solo developers, so pricing reads through a `PriceSource` interface with a third-party
sold-comps source and an active-listings fallback. Every number the UI shows is labeled
with which one produced it.
