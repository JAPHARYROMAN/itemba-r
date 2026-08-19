import { Module, Provider } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CompanyScopeService, EncryptionService } from '../../common/services';
import { CapabilityInvoker } from './capability-invoker';
import { MsaidiziConversationsController } from './conversations.controller';
import { MsaidiziConversationsService } from './conversations.service';
import { ManifestProvider } from './manifest.provider';
import { AnthropicModelClient, ModelClient } from './model-client';
import { MsaidiziConfig } from './msaidizi.config';
import { MsaidiziController } from './msaidizi.controller';
import { APPROVAL_GRANT_STORE, ApprovalGrantStore, MsaidiziService } from './msaidizi.service';
import { ProceduresController } from './procedures.controller';
import { ProceduresService } from './procedures.service';

/**
 * The approval ledger, as the agent loop reaches it — one instance, typed.
 *
 * ONE INSTANCE, AND ONE TYPE. Two properties, and the factory below is the
 * shape that carries both.
 *
 * The instance first: the factory INJECTS the store and returns that same
 * object, so the token aliases the singleton the controllers already hold and a
 * grant issued while a turn is being proposed is written by the same object the
 * next request spends it from.
 *
 * `useClass` would be the easy mistake and the expensive one. A second instance
 * is a second ledger — grants issued into one, spent from the other — and it
 * fails in the direction that looks like success: every approval refused, every
 * red-tier action re-proposed forever, nothing in any log saying why, and a user
 * clicking a button that never does anything. Nothing downstream can detect it,
 * which is why there is a test for it in `msaidizi.controller.spec.ts` rather
 * than a comment alone.
 *
 * ─── Why a token, and what the token does NOT check ──────────────────────────
 *
 * The loop injects `ApprovalGrantStore` — the two methods that issue and spend
 * an approval — rather than `MsaidiziConversationsService`, so it depends on the
 * ledger and not on a service that also opens turns, sweeps retention and
 * decrypts transcripts. A token also keeps the dependency one-directional:
 * `conversations.service.ts` already imports types from `msaidizi.service.ts`.
 *
 * What Nest does not do is check that the bound instance satisfies the interface
 * the injecting class declared. A token binding is untyped at the container, so
 * a divergence between the port and the store would otherwise surface as a
 * `TypeError` inside the red-tier gate, at the moment a user clicks approve, on
 * the one path production has never run — `MSAIDIZI_WRITE_MODE=read-only` means
 * no confirmation has ever fired there.
 *
 * That is why the factory below is annotated `: ApprovalGrantStore` and why the
 * store declares `implements ApprovalGrantStore`. Neither line changes anything
 * at runtime; together they move the day the contract breaks from a user's
 * click to `tsc`. This binding is the seam the two halves meet at, so it is
 * where the check belongs — and it has already caught one divergence, when the
 * loop and the store were built to two different sets of method names.
 *
 * ─── What must NOT be added here ─────────────────────────────────────────────
 *
 * If this factory ever WRAPS the store rather than handing it back, the wrapper
 * must not catch. Every other write in this module swallows its own failures,
 * because by the time those writes happen the model turn and the tool calls
 * already have, and refusing to answer would report a failure that did not
 * occur. A grant is spent BEFORE the irreversible action runs, so the rule
 * inverts: a rejection has to reach the loop as a rejection, where it
 * distinguishes "the ledger holds no such grant" from "the ledger did not
 * answer" and dispatches on neither. Softening one into the other here would
 * re-propose during exactly the outage in which the replacement grant cannot be
 * recorded either.
 *
 * `MsaidiziConversationsService.issue()` and `.spend()` are written to that
 * rule — they are the only two methods in that file that throw instead of
 * swallowing — so a catch added here would not be a safety net over a store
 * that reports its failures. It would be the thing that discards them.
 *
 * Exported so a test can compile this binding on its own.
 */
export const approvalGrantStoreProvider: Provider = {
  provide: APPROVAL_GRANT_STORE,
  inject: [MsaidiziConversationsService],
  // The instance itself, not a copy of it. `{ ...c }` spreads own enumerable
  // properties only, so a class instance loses every prototype method: the
  // binding would resolve to an object with the store's injected fields and
  // neither `issue` nor `spend` on it, and the first approval anyone ever
  // clicked would TypeError inside the red-tier gate. The narrowing this
  // binding exists for belongs to the TYPE — the loop declares the port and
  // sees two methods — not to the runtime value. The return annotation is the
  // check: it is what fails the build if the store stops satisfying the port.
  useFactory: (c: MsaidiziConversationsService): ApprovalGrantStore => c,
};

/**
 * Msaidizi — the agent layer.
 *
 * Holds no business logic of its own. Every action it takes is an existing
 * endpoint, invoked over HTTP with the caller's own credential, so the module
 * adds a caller to the system rather than a new path through it.
 *
 * Inert unless MSAIDIZI_ENABLED=true and an API key is configured — with one
 * deliberate exception: conversation history stays readable when the module is
 * switched off, because a deployment that disables the agent should not also
 * make what it already did unreadable to the people who ran it.
 *
 * The conversation store is wired in twice, on purpose and under two names. The
 * controllers hold it as `MsaidiziConversationsService` and use it to open and
 * close turns; the agent loop holds the SAME INSTANCE behind
 * `APPROVAL_GRANT_STORE`, narrowed to the two methods that issue and spend
 * red-tier approvals. See `approvalGrantStoreProvider` for why one instance is
 * load-bearing and why the loop is given a port rather than the class.
 */
@Module({
  imports: [ConfigModule, PrismaModule, AuditLogsModule],
  controllers: [MsaidiziController, MsaidiziConversationsController, ProceduresController],
  providers: [
    MsaidiziConfig,
    ManifestProvider,
    CapabilityInvoker,
    MsaidiziService,
    MsaidiziConversationsService,
    approvalGrantStoreProvider,
    ProceduresService,
    CompanyScopeService,
    // Conversation transcripts and resume state are AES-256-GCM ciphertext at
    // rest, following the integration-connections precedent. APP_ENCRYPTION_KEY
    // is already required in production and staging, so this adds no ops burden.
    EncryptionService,
    { provide: ModelClient, useClass: AnthropicModelClient },
  ],
  exports: [MsaidiziConfig],
})
export class MsaidiziModule {}
