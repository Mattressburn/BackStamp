# Reference-book digitizer

This one-off tool turns photographs of reference-book pages into a JSON review file. It never writes `data/catalog.json`; a human must review and merge the facts.

## Photographing pages

- Use JPEG, PNG, GIF, or WebP. Configure the phone camera for JPEG or convert HEIC first.
- Photograph one complete page per image, square to the page, in even light without glare or shadows.
- Keep pattern names, dates, dimensions, capacities, and every model-number character in focus. Retake a page if a digit is ambiguous.
- Use sortable filenames such as `001.jpg`, `002.jpg`, and `003.jpg`.
- Do not crop away headings or table labels needed to connect a value to a pattern or form.

No manual downscaling is needed for ordinary phone page photos; the vision model handles images up to 2576 pixels on the long edge.

## Setup and commands

Node 26 and `ANTHROPIC_API_KEY` are required. From the repository root:

```sh
npm --prefix scripts install
export PATH="$PWD/scripts/node_modules/.bin:$PATH"
export ANTHROPIC_API_KEY="your-key"
tsx scripts/digitize-book.ts ./book-pages --out ./extracted.json
```

Resume an interrupted run with the same output file:

```sh
tsx scripts/digitize-book.ts ./book-pages --out ./extracted.json --resume
```

`--resume` skips filenames already listed in `processedPages`. Successful batches are written atomically, and progress is printed for every page. Without `--resume`, the command starts a fresh review file and replaces the output after the first successful batch. The Anthropic SDK retries rate limits with exponential backoff.

Run the pure-logic checks without calling the API:

```sh
npm --prefix scripts test
```

## Review before merging

The output groups records into `patterns`, `forms`, and `items`. Every candidate includes `sourcePage` and `confidence`; `conflicts` lists fields for which pages make incompatible claims. Conflicting candidates remain in the arrays so the reviewer can inspect both source pages.

Before manually merging records into `data/catalog.json`:

1. Open each cited source page and verify low-confidence records, conflicts, years, and model numbers.
2. Leave an unreadable year unknown. Resolve or discard forms and items with a null model number because they cannot have a canonical catalog identifier.
3. Resolve duplicates, confirm every reference, and verify each item slug is exactly `{patternId}-{form.modelNo}`.
4. Set required rarity values independently. The extractor intentionally leaves rarity and notes null rather than copying a guide's rankings or prose.
5. Remove `sourcePage` and `confidence`, resolve all nulls in fields that are non-nullable in `Pattern`, `Form`, or `Item`, then merge the reviewed arrays into the versioned catalog.

## Facts, not expression

Extract manufactured-object facts only: pattern names, production years, model numbers, colorways, dimensions, capacities, and pattern/form associations. Do not copy the book's photographs, prose, captions, descriptions, phrasing, rarity rankings, or page-by-page organization. Individual facts can be transferred; the author's expression and a guide's protected selection or arrangement cannot. The review JSON uses the catalog's field names and contains no book images or descriptive prose for this reason.
