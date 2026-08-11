# Shelf photo bulk import: measured, and it does not work

Date: 2026-08-10. One real shelf photo, three calls, `gemini-3.1-flash-lite`.
Script: `scripts/shelf-probe.ts`. Total estimated cost of the run: $0.018.

## The question

Can one photo of a whole shelf drive a bulk collection import, where the app identifies
what it can, the owner corrects it, and only the misses get the careful two photo scan?

## Answer: no, and the failure mode is the dangerous kind

The model does not read the shelf. It emits **canonical nesting sets** and fills them with
whatever pattern is nearby in its context. Every multi-piece stack came back as either
441 / 442 / 443 / 444 (the complete Cinderella set) or 401 / 402 / 403 / 404 (the complete
round mixing bowl set), regardless of how many pieces were actually stacked there.

The `visibleEvidence` field caught it. Requiring the model to say what it actually saw, in
the same row as the slug, made the contradiction visible in the output rather than
invisible behind a confidence number:

| Returned slug | Its own evidence field | Confidence |
|---|---|---|
| `spring-blossom-green-444` | "extra large round bowl, **solid orange**" | 0.80 |
| `spring-blossom-green-441` | "small round bowl, **solid red**" | 0.80 |
| `spring-blossom-green-443` | "large round bowl, **light blue**" | 0.90 |
| `spring-blossom-green-441` | "small round bowl, **solid blue**" | 0.90 |

Spring Blossom Green is green and white. A solid orange bowl is not it, and the model said
so itself in the same row it returned the slug.

It also contradicts itself across runs on the same piece. `primary-colors-404` was "solid
yellow" at 5712px and "blue" at 2048px. `primary-colors-401` was "solid blue", then "red",
then "iconic red color".

**Confidence was 0.80 to 1.00 throughout.** High confidence, wrong answer, and self
refuting evidence is the worst combination available for a workflow whose whole premise is
that a human corrects the misses. A wrong answer that looks right does not get corrected.

## Coverage

Roughly 40 to 50 Pyrex pieces are visible in the photo. Best run returned 24 detections,
and many of those are the template artifacts above. The entire right half of the shelf
produced nothing: the blue stacks, the turquoise stacks, the black and white snowflake
casserole, the orange and gold stacks, the yellow dots bowl, the refrigerator dishes.

## The one thing it got right

**No false positives on non-Pyrex.** The porcelain figurines, the owl salt shakers, the
stack of dark stoneware plates, the camera, the magazine files and the teacup were all
left alone. Abstention held. The slug enum guarantees a returned slug exists in the
catalog, and the prompt instruction not to emit an entry for non-Pyrex objects was
honoured.

## The finding that changes a shipped default

**Image input tokens were 1064 at every width: 5712px, 2048px and 1024px, identical.**

Gemini downsamples to the same internal tile budget regardless of what we upload. So:

- The resolution sweep measured nothing about resolution. The detection counts of 24, 17
  and 12 are run to run variance, not a resolution effect. This is consistent with the
  already known confidence instability on this model, where identical input returned 0.85
  once and 0.33 three times.
- **The 1024px downscale in `encodeForUpload` costs nothing in what the model sees.** It
  was chosen on reasoning alone earlier the same day. It is now measured: the model
  receives the same 1064 image tokens either way, so the downscale is pure saving on
  upload bytes and phone battery with no accuracy cost.
- It also caps what a shelf photo could ever achieve. The model never sees more than about
  four tiles of detail spread across the whole frame, so 40 dishes get a few hundred
  pixels each no matter how good the camera is.

## Recommendation

Do not build the shelf photo import. This confirms by measurement what session 3 argued
from first principles: photos are the worst bulk input. The remaining batch import
approaches are unaffected and still worth building, in this order: rapid add from the All
tab, then paste or dictate a list, then CSV.

## The idea worth keeping

`visibleEvidence` should move into the real `/identify` path as a cheap self check.
`app/src/constants/colorways.ts` already parses a pattern's prose colorway into the colors
it names. If the model reports "solid orange" and the returned slug's colorway parses to
green and white, that is a detectable contradiction and the guess can be dropped before
the user ever sees it.

That is a fifth enforcer in the same family as `PriceFigure`, the swatch mark, the
`AiApproximationBadge`, and the slug enum plus `resolveGuesses`: it makes a specific kind
of dishonest output structurally harder to emit. It costs one extra output field.
