# ITEMBA-R — Data Migration and Adoption Hardening Notes

## Current implementation slice

This document records the first Iteration 8 hardening pattern for staged import validation.

## Shared staged import control

`StagedImportValidationService` centralizes pre-commit validation for CSV/XLSX import workflows.

It currently supports staged validation for:

- customers
- suppliers
- products
- employees
- assets
- opening balances
- stock

## Validation behavior

The validator returns a row-level validation report with:

- total rows
- valid rows
- invalid rows
- commit eligibility
- row-level issues

The current checks enforce:

- required fields by entity type
- case-insensitive duplicate natural keys
- composite stock duplicate keys by product code and inventory location code
- commit blocking when any validation issue remains

## Import safety pattern

Future import endpoints should use this sequence:

1. Parse CSV/XLSX into staged rows.
2. Run `StagedImportValidationService.validate`.
3. Return the validation report to the operator.
4. Commit only after `assertCanCommit` succeeds.
5. Audit the validation report and final committed row counts.

## Test coverage

`StagedImportValidationService` has focused unit coverage for:

- valid staged imports being commit-eligible
- row-level missing required fields
- case-insensitive duplicate natural keys
- composite stock duplicate keys
- commit blocking when validation issues remain

## Next migration and adoption modules

Recommended order:

1. Add a `data-imports` module with staged upload, validation, commit, and rollback endpoints.
2. Persist import batches, source filenames, row counts, validation report summaries, and commit audit details.
3. Add parser support for CSV and XLSX using the staged import validator.
4. Link failed import rows to downloadable correction files.
5. Tie launch readiness to training completion, unresolved blockers, and successful trial imports.
