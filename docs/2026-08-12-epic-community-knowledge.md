# EPIC: The community knowledge engine

Filed 2026-08-12, late night, in the owner's words: "What if this became just a
great resource for the whole community. I don't want your data, I only want
Pyrex knowledge and photos."

Format note: this file is the epic's temporary home. The acvs/rumil repo's
tracking system is being studied; when Backstamp adopts a tracking shape, this
migrates into it as the founding epic.

## The vision

Backstamp stops being only a personal tracker and becomes the reference the
community maintains together: crowd-sourced knowledge and photographs, checked
before they become claims, with the privacy stance as a founding principle
rather than a compliance document. The privacy policy should be readable in one
breath: we do not want your data, we want Pyrex knowledge and photos.

## Why verification is the heart of it

Crowdsourcing without checking poisons the well. The owner's example: collectors
who believe they own true Opal pieces when the backstamp says otherwise (wrong
stamp, or no stamp where Opal carries one). A submission is not a fact; it is a
claim with evidence, and the catalog already has the vocabulary for this
(provenance labels, the colorway-contradiction guard, the photo approval gate,
evidence-quality-over-confidence). This epic generalizes that vocabulary to
everything the community submits.

## Stories

1. **Submission lanes.** A collector can submit: a photo of a piece (exists,
   approval-gated), a new pattern-form combination (exists, collector-attested),
   a correction to an existing entry (does not exist), and a claimed rarity or
   variant observation (does not exist). Every lane produces a claim carrying
   its evidence, never a direct catalog write.
2. **The checking bench.** A review surface where claims meet evidence rules
   before publication: does the photo's backstamp match what the claimed
   pattern's era used (the Opal test)? Does the colorway contradict the
   documented one? Does a trusted source (CMoG, PyrexLove, period ads, the
   digitized book) corroborate or contradict? Claims that fail rules are
   returned with the reason, not silently dropped. Starts as the manual
   approve-photos CLI generalized; grows toward in-app review by trusted
   collectors.
3. **Backstamp-era rules as data.** The Opal test needs the app to know which
   stamps belong to which eras and lines. That is a new fact type: stamp
   characteristics per pattern/era, sourced the same way as everything else and
   displayed on the piece page (it is also scan evidence the identifier can
   use).
4. **Book ingestion.** The owner is acquiring a reference book to digitize.
   `scripts/digitize-book.ts` already exists as the pipeline stub; the book's
   facts enter with published-reference provenance and page-level citations,
   restated in our own words, same discipline as CMoG and PyrexLove. The
   survey ranked the Pyrex Passion books the deepest grail source; this story
   is the machinery for any purchased reference.
5. **Contributor identity without personal data.** Attribution stays the
   chosen-handle model from photo sharing: no emails, no profiles, reputation
   is just a handle plus a count of accepted claims. "Trusted reviewer" is a
   role the owner grants, not a scraped identity.
6. **The one-breath privacy policy.** The legal work (docs/2026-08-12-legal-
   research.md) delivers the required document; this story keeps its soul: the
   plain-words opening stays "We do not want your data. We want Pyrex knowledge
   and photos," followed by exactly what that means mechanically.

## Constraints carried in

Every claim type gets its label in the same breath (honest labelling, six
enforcers and counting). No source is fetched without its permission shape
read. The prompt prefix cache and the 1024px bound are measured walls. The
checking bench must never present the word "slug" or "provenance" to a human.

## Open questions for the tracking system to hold

- When does review move from the owner's CLI to trusted collectors in-app?
- Does a rejected claim teach the identifier anything (negative evidence)?
- Where does the wife-as-oracle pattern formalize into "trusted reviewer #1"?
