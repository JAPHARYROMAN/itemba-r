import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  Post,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { MsaidiziConfig } from './msaidizi.config';
import { MsaidiziService, RunResult } from './msaidizi.service';
import { ModelMessage } from './model-client';

export class AskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  message!: string;

  /** Opaque conversation state returned by the previous turn. */
  @IsOptional()
  @IsArray()
  history?: ModelMessage[];

  @IsOptional()
  @IsString()
  @MaxLength(128)
  sessionId?: string;

  /** Confirmation ids the user has explicitly approved for this turn. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  confirmed?: string[];
}

/**
 * Msaidizi's own surface.
 *
 * `@AgentExcluded` on the controller keeps these routes out of the capability
 * registry, so a run cannot invoke Msaidizi recursively — the agent is not one
 * of its own tools.
 */
@ApiTags('msaidizi')
@ApiBearerAuth()
@AgentExcluded()
@Controller('msaidizi')
export class MsaidiziController {
  constructor(
    private readonly service: MsaidiziService,
    private readonly config: MsaidiziConfig,
  ) {}

  @Post('ask')
  @RequirePermissions('msaidizi.use')
  async ask(
    @Body() dto: AskDto,
    @CurrentUser() user: AuthUser,
    @Headers('authorization') authorization?: string,
  ): Promise<RunResult> {
    if (!this.config.enabled) {
      // Deliberately not a 404: the route exists, it is switched off. Saying so
      // is more useful than pretending it was never deployed.
      throw new ServiceUnavailableException('Msaidizi is not enabled in this deployment.');
    }
    if (!authorization) {
      // Every tool call is made with the caller's own credential. Without one
      // there is nothing to act as, and acting as anything else is the failure
      // this design exists to prevent.
      throw new ForbiddenException('Msaidizi requires a bearer token to act on your behalf.');
    }

    const history = dto.history ?? [];
    return this.service.run({
      user,
      authorization,
      sessionId: dto.sessionId,
      confirmed: dto.confirmed,
      messages: [...history, { role: 'user', content: dto.message }],
    });
  }

  /**
   * Streaming variant of `ask`.
   *
   * A run can involve several model turns and several tool calls, so the wait
   * before a non-streaming response is long enough that the user cannot tell
   * work from a hang. Events are emitted as they happen, ending with a `result`
   * event carrying the same payload `ask` returns.
   */
  @Post('ask/stream')
  @RequirePermissions('msaidizi.use')
  async askStream(
    @Body() dto: AskDto,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
    @Headers('authorization') authorization?: string,
  ): Promise<void> {
    if (!this.config.enabled) {
      throw new ServiceUnavailableException('Msaidizi is not enabled in this deployment.');
    }
    if (!authorization) {
      throw new ForbiddenException('Msaidizi requires a bearer token to act on your behalf.');
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (event: string, data: unknown) => {
      if (res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const result = await this.service.run(
        {
          user,
          authorization,
          sessionId: dto.sessionId,
          confirmed: dto.confirmed,
          messages: [...(dto.history ?? []), { role: 'user', content: dto.message }],
        },
        (event) => send(event.type, event),
      );
      send('result', result);
    } catch {
      // The connection is already open, so an exception filter cannot help —
      // report the failure on the stream rather than hanging the client.
      send('error', { message: 'The assistant could not complete this request.' });
    } finally {
      res.end();
    }
  }
}
