# ITEMBA-R — Company Operations Workflow Hardening Notes

## Current implementation slice

This document records the first Iteration 4 hardening pattern for petroleum operations.

## Shared petroleum control source

`PetroleumShiftControlService` centralizes operational checks that must hold before shift closure and daily fuel reconciliation.

It currently enforces:

- fuel shifts cannot be closed without nozzle readings
- shift close requests cannot include duplicate nozzle reading submissions
- shift close requests cannot reference nozzle readings from another shift
- every shift nozzle reading must have a closing meter
- disputed or voided nozzle readings must be resolved before shift closure
- closing meters cannot be below opening meters
- daily reconciliation requires no unclosed active shifts for the branch/date
- daily reconciliation requires at least one closed shift for the branch/date

## Fuel shift controls

`fuel-shifts` now calls the petroleum control service before applying closing meter updates, nozzle meter updates, sale inventory movements, and shift status changes.

The close workflow still records:

- closed nozzle readings
- updated nozzle current meter readings
- sale issue inventory movements for positive litres sold
- total litres sold, expected sales, collections, and shortage/excess
- audit log for shift closure

## Daily reconciliation controls

`fuel-daily-reconciliation` now checks reconciliation readiness before generating a new daily reconciliation. Existing reconciliations remain idempotent and are returned as before.

The readiness check prevents:

- generating a reconciliation while submitted/approved/open active shifts still exist
- generating an empty reconciliation for a branch/date with no closed shifts

## Test coverage

`PetroleumShiftControlService` has focused unit coverage for:

- computing litres and expected amount from valid closing readings
- rejecting duplicate closing readings
- rejecting unknown shift readings
- rejecting disputed/voided readings
- rejecting closing meters below opening meters
- rejecting reconciliation while active shifts remain unclosed
- rejecting reconciliation when no closed shifts exist
- allowing reconciliation when all active shifts are closed

## Next operations modules

Recommended order:

1. `fuel-tank-dips`: block posting before shift closure and add variance threshold approvals.
2. `fuel-deliveries`: enforce purchase/delivery/tank capacity checks.
3. `fuel-credit-sales`: add settlement lifecycle and reconciliation tie-out.
4. `westsides-*`: harden quotation-to-sale and purchase-to-stock workflows.
5. `trips`: add dispatch, expense, fuel usage, and profitability lifecycle controls.
