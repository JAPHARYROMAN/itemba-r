/**
 * Positive mutation fixtures suspended by the ITEMBA OS redesign (4a155f19).
 *
 * Each route below had reviewed positive evidence before the redesign changed
 * its request contract. None could be carried forward mechanically: either the
 * body DTO now uses conditional validation the agent schema cannot represent
 * strictly, or the route now moves money through a Cash Desk account under a
 * new request contract. Every route is therefore `@AgentExcluded()` in source
 * (fail closed), so the manifest-bound registry drops its fixture and the agent
 * cannot reach it.
 *
 * The static fixture definitions are deliberately retained, unchanged, as the
 * starting point for re-review. Tranche specs account for them by exact id
 * rather than by any agentExcluded wildcard: a route listed here must be
 * agent-excluded, and a route that is not listed here gets no such allowance.
 * Re-enabling one means writing a fixture for the new contract, removing the
 * `@AgentExcluded()` marker and removing it from this list.
 */
export const CRUD_REDESIGN_SUSPENDED_POSITIVE_CAPABILITIES: Readonly<Record<string, string>> =
  Object.freeze({
    'ApprovalDelegationsController.create':
      'Body DTO moved to conditional (ValidateIf) validation that the agent schema reports as partial.',
    'ApprovalDelegationsController.update':
      'Body DTO moved to conditional (ValidateIf) validation that the agent schema reports as partial.',
    'ApprovalWorkflowsController.create':
      'Body DTO moved to conditional (ValidateIf/Matches) validation that the agent schema reports as partial.',
    'ApprovalWorkflowsController.update':
      'Body DTO moved to conditional (ValidateIf/Matches) validation that the agent schema reports as partial.',
    'LoanRepaymentSchedulesController.recordPayment':
      'Scheduled loan repayment now settles through a Cash Desk account with an allocation fingerprint and request id.',
    'LoansController.create':
      'Loan creation now carries a funding mode, principal ledger account and optional Cash Desk funding.',
    'LoansController.recordRepayment':
      'Loan repayment now settles through a Cash Desk account with a request id.',
    'PayrollRunsController.pay':
      'Payroll payment now requires a Cash Desk account, request id and business date.',
  });

export const CRUD_REDESIGN_SUSPENDED_POSITIVE_IDS: ReadonlySet<string> = new Set(
  Object.keys(CRUD_REDESIGN_SUSPENDED_POSITIVE_CAPABILITIES),
);
