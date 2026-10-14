# Public-site content verification — 14 October 2026

The rebuild uses the existing public companies, operating sites, six-sector
service directory and owner-supplied more-than-50-stockists statement. English
copy describes those operations without adding unsupported legal or expansion
claims. Unknown information is omitted, rather than marked as verified.

## Omitted pending supporting evidence

- TINs, incorporation numbers and dates, named directors and leadership roles.
  `publishLegalIdentifiers` is off for visible pages, hidden print source and
  structured-data legal-name claims.
- The dated 2012–2025 founding/opening/reorganisation chronology and `EST. 2012`
  letterhead. About and the profile describe present company responsibilities.
- Three proposed fuel stations, their location count and any implied opening
  status. Operating station and parking information remains.
- Speculative emerging-business divisions or capacity. Public profiles describe
  logistics and property-related enquiries through Itemba Estate without claiming
  active property projects or assets.
- Exclusive supplier contracts, territorial exclusivity and claims of little
  or no competition. Product stock and distribution do not establish those rights.
- The unverified UZUNGUNI INN room photograph and real-estate photographs
  without recorded provenance/licence. Hospitality and property services remain
  in the directory using a typographic treatment where no suitable verified
  photograph is available. Other hospitality photographs recorded as owned
  remain eligible, although their inclusion depends on composition and quality.
- Manufacturing/division-count inconsistencies, fastest-growing-region claims,
  and an inferred identity between the head office and ITEMBA-MPEMBA remain omitted.

The existing public name `Mwanjalisi Oil Co Ltd` or the brand `Mwanjalisi Oil` is
used in public copy. The different archived registered-name variant is unresolved.
Archived statutory data is server-only internal content; retaining it does not
confirm it or authorise publication.

## Photograph evidence

Operating photographs marked `own` in the media register identify their existing
Itemba source. They can illustrate those operations. Beverage and hardware brands
visible in stock photographs do not imply sponsorship or exclusive contracts.
The regional Songwe landscape is third-party imagery with a recorded CC BY-SA 4.0
licence and visible Richard grivas / Wikimedia Commons credit; it illustrates the
region, not Itemba-owned premises. No new AI or stock photography is introduced.

## Documents and release checks

All four final PDFs have been regenerated after the final UI/content changes,
visually reviewed and relocked with `npm run pdf:lock`. The Group profile has
seven pages; Enterprises, Mwanjalisi and Westsides have three pages each. The
16-page review found no clipping, overlapping text, orphan trailing pages or
known withheld identifiers, historical dates, named leaders or speculative
emerging-business claims. The final input hash begins `2e97c41c6cd1`; see the
[release verification record](rebuild-verification-2026-10-14.md).

Future changes to PDF inputs require regeneration, visual review and relocking.
Those inputs include content flags, contact/site data, company/profile content,
the media register and print rendering.

Tests explicitly require omitted identifiers, directors and the unverified
founding year to be absent from screen, print source and regenerated PDFs.
The historic PDF baseline remains evidence of the previous release; exact
omissions are handled in the PDF contract test without replacing that baseline.

Before release, inspect all public pages and structured data for unverified
claims, verify that every published photo has a suitable recorded source, confirm
the four new downloads match the screen copy, and complete enquiry delivery checks.
