/**
 * Conversation history — the surface a chat application needs and that nothing
 * in this codebase already provides.
 *
 * The near neighbour is `GET /audit-logs?agentSessionId=…`, and it does not do
 * this job on four counts: it lists what the agent CHANGED, so under a read-only
 * deployment an entire run leaves zero rows and every user's history would be
 * empty; there is no route that enumerates a user's sessions, so you must
 * already know the id; it is gated on `audit-logs.read`, an oversight permission
 * that reading your own chat must not require; and it is company-scoped rather
 * than author-scoped, which is the exact widening this controller forbids.
 *
 * `@AgentExcluded` keeps every route here out of the capability registry. The
 * agent must never be able to read conversations as a tool — its own or anyone
 * else's — and the decorator is what makes that structural rather than a runtime
 * check somebody can forget.
 */

import { Controller, Delete, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { MsaidiziConversationsService } from './conversations.service';

@ApiTags('msaidizi')
@ApiBearerAuth()
@AgentExcluded()
@Controller('msaidizi')
export class MsaidiziConversationsController {
  constructor(
    private readonly conversations: MsaidiziConversationsService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /**
   * Who is using the agent and how much — metadata only.
   *
   * Declared before `conversations/:id` so the literal segment is matched first.
   * Carries no title, no prompt, no events and no arguments, because it is the
   * answer to "there is no admin read of a transcript" rather than a softer
   * version of one. `msaidizi.oversight` is seeded to no role: holding it is a
   * deliberate grant, never a consequence of being an administrator.
   */
  @Get('oversight/conversations')
  @RequirePermissions('msaidizi.oversight')
  @ApiOperation({ summary: 'Agent usage by conversation — metadata only, no content' })
  oversight(
    @CurrentUser() user: AuthUser,
    @Query('companyId') companyId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.conversations.oversight(
      { companyId, page: toInt(page), limit: toInt(limit) },
      user,
    );
  }

  @Get('conversations')
  @RequirePermissions('msaidizi.use')
  @ApiOperation({ summary: 'List my conversations with Msaidizi' })
  list(
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.conversations.list(user, toInt(page) ?? 1, toInt(limit) ?? 20);
  }

  /**
   * One conversation and its turns, decrypted.
   *
   * Author-only, and a request from anyone else is a 404 rather than a 403 —
   * there is nothing to tell a non-author about a conversation that is not
   * theirs, including that it exists.
   */
  @Get('conversations/:id')
  @RequirePermissions('msaidizi.use')
  @ApiOperation({ summary: 'Read one of my conversations, with its full transcript' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.conversations.findOne(id, user);
  }

  /**
   * What the agent actually did during this conversation.
   *
   * A convenience join, not a widening: it still requires `audit-logs.read` and
   * the audit service still applies its own company scope. The conversation is a
   * UI artefact; the audit log is the record.
   */
  @Get('conversations/:id/audit')
  @RequirePermissions('msaidizi.use', 'audit-logs.read')
  @ApiOperation({ summary: 'Audit trail for this conversation, by agent session' })
  async audit(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const conversation = await this.conversations.findOne(id, user);
    return this.auditLogs.findAll({ agentSessionId: conversation.agentSessionId }, user);
  }

  /**
   * Removes a conversation.
   *
   * Soft-deletes the transcript and destroys the resume state immediately. This
   * is unrestricted for the author precisely because it deletes no evidence:
   * whatever the agent changed is recorded in `audit_logs` under the user's own
   * id and survives untouched, so "delete my chat" can never become a way to
   * cover tracks.
   */
  @Delete('conversations/:id')
  @RequirePermissions('msaidizi.use')
  @ApiOperation({ summary: 'Remove one of my conversations' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.conversations.remove(id, user);
  }
}

function toInt(value?: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}
