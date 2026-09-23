# Shared documents and company letterheads

Implemented 19 September 2026. This is local release work; it has not been deployed.

## User experience

- **Apps → Documents** opens a document library, format guide and general correspondence editor.
- **Write a letter** selects an accessible company, subject, recipient, reference, body and signatory. A live letterhead preview accompanies PDF, editable Word and text downloads. Drafts remain in the current editor, with the existing unsaved-work guard; they are not automatically saved to a server. Upload a finished copy to keep it in the library.
- **Manage company letterheads** opens the existing Company Profile settings. Company identities are maintained in one place, rather than in a second document directory.
- The existing document library now opens a file preview first and retains original download, metadata, expiry and audit workflows.
- Shared business-document actions, shared ERP data tables and the Reports analysis grids offer PDF, DOCX, XLSX, CSV and text exports. Existing generated PDF storage remains available separately.

## Identity rules

Company registered name, logo, contact details, address and legal identifiers come from company/profile records. Group contact details and the Itemba Group logo provide a fallback. Missing company TIN, VRN and registration numbers remain blank; they never inherit another legal entity's identifiers. A group-level letter uses the existing configured group defaults. The existing defaults are retained, not newly certified by this implementation.

The backend generated-document resolver supplies new exports, report letterheads and the legacy print engine. The frontend `documentOrganization` helper follows the same fallback rules for existing record previews. Operations, Westside and Record Book report print headers now resolve the selected company instead of hardcoding group tax numbers. Supplier order draft previews no longer substitute group legal identifiers for missing company values.

## Supported formats

| Format | Read in the app | Export |
| --- | --- | --- |
| PDF | Browser PDF viewer | Branded business documents, reports and letters |
| DOCX | Plain-text preview; original layout remains in the downloaded file | Editable headers, footers, sections, tables, totals and signature lines |
| XLSX | Visible sheet values, using saved formula results | Real workbook with letterhead, editable tables and explicit numeric columns |
| CSV | Parsed quoted fields and multiline cells | Portable tabular content with formula neutralization |
| TXT / JSON | Escaped text preview | TXT document export; existing JSON report exports remain |
| PNG / JPEG / WebP | Image preview | Original download |
| DOC / XLS / PPT / PPTX / ODT / ODS / RTF / ZIP | Original download for a compatible application | Original download |

This is not an arbitrary file conversion engine. Uploaded originals are never reformatted or stamped with a letterhead. Macro execution, document editing, OCR, digital signatures, full Office layout rendering and PowerPoint generation are outside this phase. General letter PDFs use the existing standard Latin font renderer; unsupported characters produce a useful error directing users to Word or text, preserving their content.

## Controls and implementation

- Exported copies are audited. They do not change source financial records or automatically become approved/issued documents.
- Business exports rebuild the existing authorized source model; letterhead reads check company scope. New letter creation requires `documents.manage`; file previews require `documents.view` and the same record scope check as downloads.
- Reports export only the supplied, already fetched rows. The backend authorizes company identity separately. Export is capped at 5,000 rows and 40 columns; the new selector rejects oversized requests without silent truncation. CSV remains available for full report results through existing report controls.
- Office preview processing stays on the backend; no documents are sent to public Office/Google viewers. DOCX output is rendered as text, never uploaded HTML. XLSX formulas are not evaluated and active links are not rendered.
- Preview limit: 10 MB compressed/file bytes, 32 MB total expanded Office content, 16 MB per archive entry and 2,048 entries. Table previews show at most 10 visible sheets, 200 rows and 40 columns. Text previews show at most 100,000 characters. The original stays downloadable.
- CSV formula triggers are neutralized, including leading whitespace. XLSX uses explicit string cells for text, preserves long numbers as text to avoid Excel precision loss, and converts explicitly numeric columns only when safe.
- Multipart `false` is now parsed correctly for the Confidential checkbox. Storage keys use UUIDs to avoid collisions between simultaneous uploads with the same name.
- No schema migration is required. Backend adds `docx`, `mammoth`, `fflate` and `csv-parse` dependencies. Existing permissions and organisation records are reused.

## Verification

The guarded `scripts/prove-document-workspace.mjs` runs only against `127.0.0.1:5549/itemba_release_proof`. It exercises real authenticated exports, uploads, previews, byte-for-byte original downloads, source permissions, company isolation and format/size validation with synthetic data. Private output and results live under ignored `.release/document-proof/`.

Focused backend and frontend suites cover format round-trips, spreadsheet precision and formula safety, hostile/oversized Office input, missing company tax identifiers, permission checks, literal text rendering and export limits. Production builds and frontend/backend route and DTO checks are included. Browser verification covers launching Documents, composing/exporting a Word letter, stored Word/Excel previews, 390 px mobile layout and keyboard navigation. Sample letter/report PDFs were rendered and inspected visually. Word content and package structure were verified; full Word application pagination has not been visually reviewed.

The repository's broader release holds, opening-data reconciliation and production UAT remain tracked separately in `docs/releases/itemba-os-release-readiness.md`.

Final verification: 64 focused backend tests across six suites, 50 frontend tests across eight suites, and 20 authenticated document workflow checks passed. Backend and frontend production builds passed (209 frontend pages). Route contract: 948 literal frontend calls against 1,397 backend routes; DTO contract passed. Targeted lint passed without errors; existing backend `any` warnings remain. The isolated services were stopped after verification, with test data and evidence retained.
