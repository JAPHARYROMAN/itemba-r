import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  MessageEvent,
  Param,
  Post,
  Query,
  Req,
  Sse,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { from, Observable, switchMap } from 'rxjs';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  CreateMsaidiziTaskDraftDto,
  CreateMsaidiziTaskDto,
  PlanMsaidiziTaskDto,
  QueryMsaidiziTaskDto,
  QueryMsaidiziTaskEventsDto,
  ReplanMsaidiziTaskDto,
} from './dto/msaidizi-task.dto';
import { MsaidiziTasksService } from './msaidizi-tasks.service';

@ApiTags('msaidizi-tasks')
@ApiBearerAuth()
@AgentExcluded()
@RequirePermissions('msaidizi.use')
@Controller('msaidizi/tasks')
export class MsaidiziTasksController {
  constructor(private readonly tasks: MsaidiziTasksService) {}

  @Post('drafts')
  @ApiOperation({ summary: 'Create a caller-owned PLANNING task for intent and untrusted media' })
  draft(@Body() dto: CreateMsaidiziTaskDraftDto, @CurrentUser() user: AuthUser) {
    return this.tasks.createDraft(dto, user);
  }

  @Post('plan')
  @ApiOperation({ summary: 'Persist a reviewed, immutable Msaidizi task plan' })
  plan(@Body() dto: PlanMsaidiziTaskDto, @CurrentUser() user: AuthUser) {
    return this.tasks.plan(dto, user);
  }

  @Post()
  @ApiOperation({ summary: 'Queue a READY task; this request never executes a step' })
  create(@Body() dto: CreateMsaidiziTaskDto, @CurrentUser() user: AuthUser) {
    return this.tasks.create(dto.taskId, user, dto.oneShotConsentStepIds);
  }

  @Get()
  @ApiOperation({ summary: 'List durable Msaidizi tasks initiated by the caller' })
  list(@Query() query: QueryMsaidiziTaskDto, @CurrentUser() user: AuthUser) {
    return this.tasks.list(query, user);
  }

  @Get(':id/events')
  @ApiOperation({ summary: 'Read append-only task events after a reconnect cursor' })
  events(
    @Param('id') id: string,
    @Query() query: QueryMsaidiziTaskEventsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tasks.events(id, query, user);
  }

  @Sse(':id/events/stream')
  @ApiOperation({ summary: 'Reconnectable task-event stream with cursor IDs and heartbeats' })
  eventStream(
    @Param('id') id: string,
    @Query() query: QueryMsaidiziTaskEventsDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ): Observable<MessageEvent> {
    // Authorise before opening a durable stream. Polls still repeat the scoped
    // check, so a later access revocation closes rather than leaking new events.
    return from(this.tasks.findOne(id, user)).pipe(
      switchMap(() => taskEventStream(this.tasks, id, query, user, request)),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read one task with every immutable plan version and step' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.tasks.findOne(id, user);
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pause queued work or request pause after the current step' })
  pause(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.tasks.pause(id, user);
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Queue a paused task for its next step' })
  resume(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.tasks.resume(id, user);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel remaining work without claiming an in-flight step stopped' })
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.tasks.cancel(id, user);
  }

  @Post(':id/replan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create and activate a new immutable plan version' })
  replan(
    @Param('id') id: string,
    @Body() dto: ReplanMsaidiziTaskDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.tasks.replan(id, dto, user);
  }
}

interface TaskEventRow {
  cursor: string;
  type: string;
  [key: string]: unknown;
}

interface TaskEventPage {
  data: TaskEventRow[];
  nextCursor: string;
  hasMore: boolean;
}

const STREAM_POLL_MS = 2_000;
const HEARTBEAT_MS = 15_000;

function taskEventStream(
  tasks: MsaidiziTasksService,
  taskId: string,
  query: QueryMsaidiziTaskEventsDto,
  user: AuthUser,
  request: Request,
): Observable<MessageEvent> {
  return new Observable<MessageEvent>((subscriber) => {
    let cursor = query.after ?? '0';
    let timeout: NodeJS.Timeout | undefined;
    let stopped = false;
    let lastHeartbeatAt = 0;

    const stop = () => {
      stopped = true;
      if (timeout) clearTimeout(timeout);
    };
    request.once('close', stop);

    const poll = async () => {
      if (stopped || subscriber.closed) return;
      try {
        const page = (await tasks.events(
          taskId,
          { after: cursor, limit: query.limit },
          user,
        )) as unknown as TaskEventPage;
        for (const event of page.data) {
          if (stopped || subscriber.closed) return;
          cursor = event.cursor;
          subscriber.next({ id: event.cursor, type: event.type, data: event });
        }
        if (page.data.length === 0 && Date.now() - lastHeartbeatAt >= HEARTBEAT_MS) {
          lastHeartbeatAt = Date.now();
          subscriber.next({
            id: cursor,
            type: 'heartbeat',
            data: { cursor, at: new Date().toISOString() },
          });
        }
        // `firstValueFrom`, a closed browser tab, or an explicit unsubscribe may
        // close synchronously inside `next()`. Do not leave a polling timer
        // behind after that handoff.
        if (stopped || subscriber.closed) return;
        timeout = setTimeout(poll, page.hasMore ? 0 : STREAM_POLL_MS);
      } catch (error) {
        subscriber.error(error);
      }
    };

    void poll();
    return () => {
      stop();
      request.off('close', stop);
    };
  });
}
