# Seed catalog

Version 1 contains **33 patterns, 30 forms, and 379 produced items**. An item is an
explicitly verified pattern/form pairing; the file does not generate a pattern/form
cross-product.

## Deliberate omissions

- Alternate colorways that need separate identities and pricing were not folded into
  their standard patterns. These include charcoal Snowflake, black/yellow Gooseberry,
  pink or orange Butterprint, the 1979 revisions of Butterfly Gold and Spring Blossom
  Green, and the later brown Homestead.
- The Foulard beverage-set carafe is documented as unnumbered. It is omitted because
  `Form.modelNo` is required and the item slug is derived from it; inventing a model
  number would create a false join key. The documented 1410 mug is included.
- Model 021 clear ovenware is not included because this seed is organized around named
  opalware patterns and no dependable named decoration was found for that form. Models
  023 and 024 are represented by verified decorated pieces.
- Unverified prototypes, alleged one-offs, most short-run promotional pieces, and
  tabletop accessories without dependable model numbers are excluded.

## Intentional nulls

- `yearsEnd` is null for Snowflake Blue and Old Town Blue because published references
  differ by one year (1975/1976 and 1982/1983, respectively).
- `capacityQt` is null for model 063 because its marked capacity changed without a
  corresponding shape change. It is also null for model 1410 because sources describe
  the same mug as both 9 and 10 ounces.
- `dimensions` is null except where a dependable model listing supplied exact pan
  measurements (913, 922, and 933).
- A null `notes` value means no seed-specific caveat was needed; it does not stand in
  for copied reference prose.

## Sources used for fact checking

- [Corning Museum of Glass pattern library](https://pyrex.cmog.org/pattern-library)
- [Corning dealer catalog scan](https://exhibitdb.cmog.org/opacimages/Images/Pyrex/Rakow_2000006804.pdf)
- [Common model numbers and capacities](https://www.pyrexcollector.com/models.php)
- [Pattern/form reference](https://www.pyrexcollector.com/patternsbyname.php)

Only factual fields were extracted. No photographs, descriptions, rarity-guide prose,
or reference source's full selection and arrangement were copied.
