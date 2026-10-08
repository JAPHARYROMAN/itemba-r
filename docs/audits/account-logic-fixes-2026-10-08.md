# Account logic corrections — 8 October 2026

## Result and scope

Settlement views now distinguish order value, posted AP/AR, cash paid, non-cash relief, and received goods awaiting a bill. Purchase orders, sales orders and supplier invoices read valid linked AP/AR settlements instead of trusting stale copies. Posted-document lifecycle safeguards prevent future ledger/subledger divergence.

Statements use dated activity for opening balances, period movements and closing balances. Existing journal evidence supplies historical settlements that predate payment headers; no synthetic payment records are created. Existing saved statement views and exports recompute dated balances while retaining the original saved figures as `storedBalances`. Missing or conflicting settlement evidence is disclosed, and prevents generation of a certified saved statement.

Overdue lists, filters and actions use the outstanding amount and due date. Payment due dates are explicit on new credit purchase receipts, independent of the expected delivery date. Monetary summaries remain separate by currency; a base-currency credit limit is never compared with an unconverted foreign-currency exposure.

## Live-data verification before release

The candidate services were exercised against a production `REPEATABLE READ`, `READ ONLY` transaction. The probe submitted no writes.

| Check | Result |
| --- | --- |
| Purchase orders with matching active canonical AP | 23 checked; displayed cash paid and outstanding agree with AP |
| Previously stale purchase-order copies | 15 affected, with TZS 141,104,324.44 excess outstanding; canonical views remove the discrepancy |
| Overdue payables | 1 expected by due date, 1 returned by the overdue filter |
| Overdue receivables | 9 expected by due date, 9 returned by the overdue filter |
| Customer statements | 90 customers checked; 177 historical settlements recovered; no unexplained payment-history gaps |
| Previously inflated customer statements | All 44 statement discrepancies caused by omitted historical settlements resolved |
| Remaining statement/open-receivables difference | One legitimate TZS 875,000 customer credit balance; preserved |
| Supplier statement runs | Both existing runs expose complete dated history, including 22 historical settlements |
| Supplier invoices | Both checked; no conflicting canonical links |

VRAJ DISTRIBUTOR has TZS 367,650,000.10 in purchase-order value, TZS 105,175,000 cash paid, TZS 98,800,000 in posted AP outstanding, and TZS 163,675,000.10 in received stock without posted AP. The latter is procurement coverage requiring a bill, not proof of additional posted supplier debt. No AP was automatically created for those stock receipts.

## Historical records held for review

The user requested that these three deleted receivables remain unchanged pending review:

| Receivable | Amount |
| --- | ---: |
| REC-2026-000005 | TZS 520,000 |
| REC-2026-000022 | TZS 120,000 |
| REC-2026-000085 | TZS 290,000 |

Their backing journals remain posted, and the audit logs record deletion without a reason. Restoring the receivables or reversing their accounting requires a decision about the original transaction. Two are linked to active confirmed sales orders; reversing those complete sale journals would also affect stock and cost of sales. This release does neither.

Previously recorded supplier due dates that were copied from delivery dates are also retained: corrected code requires explicit payment terms for future receipts, but the release does not invent replacement historical due dates.

## Validation

Regression tests cover dated statements across period boundaries, legacy-journal recovery and evidence gaps, payment reversal after write-off/cancellation, posted-document deletion, source settlement projection, due-date overdue filters and payments, separate currency summaries, credit-limit denomination, and the corresponding account views. Exact test and release results are recorded with the release evidence.
