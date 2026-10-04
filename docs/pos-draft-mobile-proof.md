# Mobile POS and POS Draft local verification

Verified on 4 October 2026 in the isolated `codex/pos-draft-remake` worktree. This is local implementation evidence; no production data, accounts, or deployment were used.

## Repeatable API and database proof

After building the backend, run the isolated runner from the repository root:

```powershell
node scripts/run-pos-draft-proof.mjs
```

It validates the private rehearsal profile, applies outstanding migrations to that isolated database, starts `backend/dist/main.js`, waits for readiness, runs the proof, and stops only its own API process. Port `28001` must be free before starting it. The CI workflow provisions a fresh database and uses the same runner.

For an already running private rehearsal API, run the proof directly from `backend`:

```powershell
node scripts/verify-pos-draft-workflows.cjs
```

The script reads only the ignored `.release/rehearsal.env`. Before opening Prisma it requires the database host `127.0.0.1`, port `18564`, and database name `itemba_release_proof`. Its API is fixed to `http://127.0.0.1:28001/api/v1`; redirects are rejected. It creates a separate synthetic company, branch, products, balances, and operators per run. It never prints PINs, device secrets, passwords, invitation/claim tokens, or authentication response bodies. A rate-limited response receives at most two bounded retries; throttling stays enabled.

Latest complete run: **23 of 23 checks passed**, exit code 0. The ignored `.release/pos-draft-proof.json` contains the timestamp and check results. `.release/pos-proof-fixture.json` contains synthetic IDs and office login identifiers for local browser verification, without passwords or tokens. These files are local evidence and must not be committed.

The proof covers these behaviors:

- Registration remains pending until an authorized manager approves it. An admin request links to the existing scoped OS administrator rather than granting a new admin role. Approval creates a POS user and assigned terminal without an HR employee.
- PIN sessions contain only capture permissions, are bound to the enrolled branch, and cannot use ordinary authentication, legacy sales/purchase/stock writers, or office approval routes. Refresh requires the device secret, rotates once, and retains the restricted role. Retrying setup after a lost response recovers access only with the same bound device secret and correct PIN.
- Five incorrect PINs persist a 15-minute lock. Administrator recovery immediately invalidates existing credentials and the previous PIN, requires the original device secret, and consumes its recovery claim. Revocation immediately rejects access and refresh tokens; revoking an admin device linkage leaves that person's ordinary OS account usable.
- Submitting a cashier draft creates no canonical sale, money receipt, journal, or physical movement. Replaying the same request returns the same draft; reusing its request identity with different content fails.
- First approval reserves the entire cashier sale without posting it. A stockist prepares the dispatch. Concurrent final reviewers accept only one revision, create one canonical sale, and release the reservation. Retrying the posted revision returns its original entity.
- A stockist sale needs one admin decision. Matching stockist and cashier captures follow the existing cashier transaction. Genuine repeated sales require explicit review of all matching candidates and a reason.
- Expiry releases reserved availability, persists a review state, and preserves the collected-money claim. Rejection retains that claim until an authorized administrator explicitly confirms the collected money was returned. This declaration preserves the original captured amount and creates no canonical cash entry; retrying it records one decision.
- Ordinary approval enforces maker checker. The authorized admin's explicit direct action posts their sale, count, damage, transfer, or full receipt without another reviewer.
- Collections reduce the selected approved sale's actual debt. Full confirmed purchase receipts post stock once and reject partial input or a previously received order. Supplier invoices created before or after receiving reuse exactly one payable and one posted journal; header and line debit/credit amounts balance. A stock invoice cannot be approved before goods arrive.
- Physical counts require the captured quantity and physical revision; a later stock event blocks a stale count. Transfers preserve total quantity and inventory value across branches. Damage changes stock and accounting only after posting.
- Approval rereads the origin recorder's company access after capture. Withdrawing it blocks posting without changing canonical stock or money.
- Existing password accounts linked to staff enrollment, including paused or revoked enrollment, and historical staff terminal assignments cannot use their ERP write permissions to bypass approval. Their ordinary read permissions and logout remain available. An approved GRN with a granted `grn.post` permission stays unposted, with no physical or financial effect, when either staff route attempts direct posting.

## Existing read API evidence

The cashier proposal and its accepted posting were compared through existing APIs, with the same company and branch filters:

| API                                   | Proposal                            | Accepted cash sale of TZS 200, cost TZS 80                |
| ------------------------------------- | ----------------------------------- | --------------------------------------------------------- |
| `desk-reports/business?kind=sales`    | Sales amount/count unchanged        | Amount +200, count +1                                     |
| `operations-reports/sales-summary`    | Sales total unchanged               | Sales value +200                                          |
| `desk-reports/business?kind=accounts` | Cash unchanged                      | Balance +200                                              |
| `cash-desk/accounts`                  | Connected ERP cash mirror unchanged | ERP mirror +200                                           |
| `inventory-balances/summary`          | Inventory value unchanged           | Value -80                                                 |
| `sales-desk/overview`                 | Standalone register unchanged       | Standalone register remains separate from canonical sales |

The canonical Sales business report and Operations sales report provide the accepted sale evidence. Sales Desk's standalone register deliberately excludes canonical transactions; the test checks that this independent register is not duplicated. Cash Desk's linked ERP mirror is checked separately from its independent desk ledger.

## Auth regression tests

```powershell
npm test -- --runTestsByPath src/modules/mobile-pos-auth/mobile-pos-auth.service.spec.ts src/modules/auth/auth.refresh.spec.ts src/modules/auth/auth.timing.spec.ts src/modules/auth/password-reset.spec.ts
```

The final mobile security suite passed **18 tests**, including password-account bypass, setup response-loss recovery, and a configured historical assignment following an unconfigured terminal. The three ordinary authentication suites passed **13 tests**. The eight affected draft, legacy POS, and canonical posting suites passed **375 tests** across the main run and a targeted rerun after updating the legacy terminal fixture. These cover approval reservations, posting and accounting, origin access, paused assignments, dispatch enrollment, and collected-funds reconciliation. Run compiler/Jest jobs sequentially on this local 16 GB machine to avoid memory pressure.

## Remaining device and release acceptance

These checks do not constitute physical iPhone/Android acceptance or staging UAT. Before release, verify camera QR scanning, actual Android installation and iOS Add to Home Screen, enrollment continuity across Safari and the installed app, device-secret continuity during PIN recovery, and per-operator cache isolation on real hardware. Also verify capture-only offline use, reconnect/retry behavior, switching operators, revoked-device recovery, and print/receipt usability against representative branch data. The local API proof does not validate production connectivity, production performance, or a release deployment.
