import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { RunResult } from '../msaidizi.service';
import { GRANT_ID, MAX_CONFIRMED_PER_TURN } from './approval-grants';
import { SESSION_ID } from './session-id';

export class CompileProcedureDto {
  @IsString() @MinLength(4) @MaxLength(4000) instruction!: string;
}

export class CreateProcedureDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsString() @MinLength(4) @MaxLength(4000) instruction!: string;
  @IsOptional() @IsUUID() companyId?: string;
  @IsArray() @IsString({ each: true }) capabilities!: string[];
}

export class RunProcedureDto {
  /** Extra context for this run — "for supplier X", "for March". */
  @IsOptional() @IsString() @MaxLength(2000) context?: string;

  /**
   * The session id of the run being approved, echoed back from its
   * `ProcedureRunResult`.
   *
   * Sent with `confirmed`, and it is what puts the approval back into the
   * conversation the proposal was made in: `open()` resolves it against this
   * caller's own conversations, and a grant is spendable only from the
   * conversation it was issued in. Omitting it starts a new run — a new
   * conversation, and therefore no standing approvals — which is what a plain
   * invocation wants.
   *
   * A LOOKUP KEY, not a credential. An id that resolves to nothing of this
   * caller's is ignored and a fresh one minted, never adopted and never
   * rejected; the run then proceeds in a new conversation where the sent grants
   * match nothing and the action is proposed again. That is the fail-closed
   * outcome, and it is a re-ask rather than an error.
   *
   * It is still the AUDIT key — whatever the store settles on is what
   * `capability-invoker` sends as the agent-session header on every `audit_logs`
   * row this run writes — which is why the value is pinned to a shape at all.
   * What it no longer is, is load-bearing for approvals: red-tier ids used to be
   * DERIVED from it, so a run under a different id recomputed every id the user
   * had approved and suspended forever. Approvals are server-issued nonces now
   * and survive the session id changing underneath them.
   */
  @IsOptional() @IsString() @Matches(SESSION_ID) sessionId?: string;

  /**
   * Grant ids the user has approved, for this request only.
   *
   * Identical in kind to `AskDto.confirmed`, and read from the same place: the
   * `grantId` on a `confirmation_required` entry in the previous run's `events`.
   * A procedure run goes through the same gate as an ask — there is no second
   * approval path — so the id shape, the one-shot spend, and the re-proposal on
   * a used or unknown grant are the same here.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CONFIRMED_PER_TURN)
  @IsString({ each: true })
  @Matches(GRANT_ID, { each: true })
  confirmed?: string[];
}

/**
 * What `POST /msaidizi/procedures/:id/run` answers with.
 *
 * The same two fields `AskResult` carries, for the same reason and now with a
 * sharper one. This endpoint accepts `sessionId` and `confirmed`, so it is a
 * resumable surface; a caller that is never told which conversation its run
 * landed in cannot tell an approvable proposal from an un-approvable one.
 *
 * That distinction only became visible with the grant ledger. A grant is bound
 * to a conversation, so a run with no `conversationId` is a run in which no
 * grant could be issued — every red-tier action it proposes carries no
 * `grantId` and can only be re-asked. Before this field existed the client had
 * to infer that from the absence of an id it was never sent.
 *
 * Both optional, and ABSENT rather than zero for a turn that was not persisted,
 * exactly as on the ask path: `JSON.stringify` drops an undefined field, and a
 * client holds its last known-good values through an answer that omits them.
 */
export interface ProcedureRunResult extends RunResult {
  conversationId?: string;
  sequence?: number;
}
