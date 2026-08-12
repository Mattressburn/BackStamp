# Set scan: built, live-probed, and what the probe changed

Date: 2026-08-11. Endpoint `POST /identify/set`, model `gemini-3.1-flash-lite`, two
real single-set crops cut from the session 4 shelf photo (one orange Daisy-era stack,
one turquoise stack), 1024px, EXIF stripped. Four live calls plus two direct
measurement calls, well under five cents total.

## What shipped

One photo of one nested set filling the frame, up to 8 detections back, each carrying
`location` and `visibleEvidence`. The backend drops rows whose evidence names colors
that contradict the slug's documented colorway (`colorsContradict` in
`shared/colorways.ts`, equivalence groups for the model's known color drift such as
blue for turquoise). That check is the fifth honest-output enforcer, after
`PriceFigure`, the swatch mark, the AI badge, and the slug enum plus `resolveGuesses`.
The app offers a One piece / Whole set toggle on the viewfinder, prunable grouped
results, and batch filing. Set scans do not log training scans yet and do not queue
offline; both are marked in code.

## Why one set and not the shelf

The shelf failed on 2026-08-10 because Gemini spends a fixed image budget (about 1064
tokens) on the whole frame. One set filling the frame spends that same budget on four
dishes instead of forty. Measured here: a 1024px single-set crop bills 1089 image
tokens, the same budget the whole shelf got, now at roughly ten times the detail per
dish.

## First live result, original prompt wording

Both sets returned four detections at 0.80 to 0.95 with coherent top-to-bottom
locations, no invented slugs, and no rows for non-Pyrex. But:

- The model assigned every piece in a stack to one pattern family. A casserole whose
  band print reads as Town and Country came back as `daisy-501`, a refrigerator dish
  slug for a round casserole, because everything else in the stack was Daisy. Both
  Town and Country and Balloons are in the catalog; it substituted anyway.
- It wrote catalog pattern names into the evidence field ("white Butterprint pattern")
  instead of describing the print. A wrong slug whose evidence just restates the slug
  is exactly the self-confirming failure the shelf probe warned about.
- `contradicted` stayed 0 on both calls: the substitutions matched on color, so the
  colorway check correctly did not fire. It guards color lies, not pattern lies.

## The measured fix

Two sentences, tested directly against Gemini on the same crops before landing:

1. "The pieces in one stack are not necessarily the same pattern; judge each piece on
   its own print."
2. Evidence must describe what a print actually depicts in plain words, and must
   never contain a catalog pattern name.

With that wording, evidence turned pictorial: "band of gold stylized butterfly and
flower shapes", "farm life vignettes including a rooster and a windmill", "trees in
framed panels", including honest notes like "form judged by relative size". On one
run the model also abstained on the solid-color middle pieces it could not pin; on a
later identical run it kept them at 0.95. The stable improvement is the evidence
quality, which is what the pruning UI shows the collector. Abstention count is run to
run noise, consistent with the known confidence instability on this model.

Ground truth caveat: nobody who owns these dishes has judged the slugs yet. The
probe validates the failure modes and the evidence quality, not accuracy. Accuracy
still needs the eval harness and labeled scans.

## Prefix caching, first live confirmation

The second direct Gemini call returned `cachedContentTokenCount: 13406` (12,550 text
plus 856 image) out of a 17,050-token prompt. The catalog-block prefix cache is real
and hitting, which was only reasoned about until today. The set prompt contains no
request-derived text at all, so every call after the first is mostly cached input.

## What browser QA of the populated screens found (same session)

- **The backend had no CORS headers at all.** The web preview's fetches were blocked
  at preflight in the browser, which is why "start the backend, then QA the populated
  screens" failed silently for two sessions; native apps never send an Origin, so the
  phone path was never affected. Fixed with Hono's cors middleware.
- With the collection populated through the real browse-and-confirm flow: every
  shadow on the populated screens in both themes is a solid zero-blur offset in token
  colors, dark offsets are darker than the ground they sit on, all 379 rows carry the
  labelled swatch mark, and every visible element renders in Rubik.
- The price pipeline being down rendered honestly everywhere: banner, per-row labels,
  and the filed-screen ledger all said prices unavailable rather than showing a bare
  or zero figure.
- **Bug found and fixed:** the collection header counted item rows as "pieces filed"
  while quantities made the true piece count higher. Pieces now means the sum of
  quantities everywhere, matching the scan flow's ordinal.
- For future browser QA: React Native Web's Pressable ignores synthetic
  `element.click()` from page scripts. Drive it with Playwright's real click, with
  `force: true` when the fixed tab bar intercepts the hit test.
