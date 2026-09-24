#!/usr/bin/env bash
#
# Compare two runs of reconcile.sql (before and after an upgrade).
#
#   bash scripts/upgrade-rehearsal/compare.sh <before.txt> <after.txt>
#
# Used by rehearse.sh on the copy, and on deploy day against production
# itself (see PRODUCTION_UPGRADE_RUNBOOK). Prints the changes the migrations
# are meant to make and anything else that changed. Exit 0 only when nothing
# outside the expected list changed.

set -euo pipefail

BEFORE="${1:-}"
AFTER="${2:-}"
[ -s "$BEFORE" ] && [ -s "$AFTER" ] || {
  echo "usage: compare.sh <before.txt> <after.txt> (both from reconcile.sql)" >&2
  exit 2
}

# Checks whose value the pending migrations are meant to change:
#   accounts_per_company / rows|chart_of_accounts: the VAT migration may add
#     account 1400 to companies without a VAT-receivable account
#   active_three_way_matches: older duplicate matches per supplier invoice are
#     soft-deleted
# Every other check must be identical.
EXPECTED_TO_CHANGE='^(accounts_per_company[|]|active_three_way_matches[|]|rows[|]chart_of_accounts[|])'

changed=$(diff <(sort "$BEFORE") <(sort "$AFTER") | grep -E '^[<>] ' || true)
# Drop the "< " / "> " marker to test each line against the list.
unexpected=$(printf '%s\n' "$changed" | sed -n 's/^[<>] //p' | grep -vE "$EXPECTED_TO_CHANGE" | sort -u || true)
expected=$(printf '%s\n' "$changed" | while IFS= read -r line; do
  [ -n "$line" ] || continue
  if printf '%s\n' "${line:2}" | grep -qE "$EXPECTED_TO_CHANGE"; then printf '  %s\n' "$line"; fi
done)

echo "Expected changes (before '<', after '>'):"
echo "${expected:-  none}"
echo
echo "Unexpected changes:"
if [ -n "$unexpected" ]; then
  printf '%s\n' "$unexpected" | sed 's/^/  /'
  exit 1
fi
echo "  none"
