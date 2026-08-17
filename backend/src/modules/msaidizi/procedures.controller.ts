import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { MsaidiziConfig } from './msaidizi.config';
import { MsaidiziService, RunResult } from './msaidizi.service';
import { ProceduresService } from './procedures.service';

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

  @IsOptional() @IsArray() @IsString({ each: true }) confirmed?: string[];
}

/**
 * Saved procedures.
 *
 * `@AgentExcluded` for the same reason as the ask endpoints: a procedure run
 * must not be able to author or approve procedures, which would let it widen its
 * own bounds mid-run.
 */
@ApiTags('msaidizi')
@ApiBearerAuth()
@AgentExcluded()
@Controller('msaidizi/procedures')
export class ProceduresController {
  constructor(
    private readonly procedures: ProceduresService,
    private readonly agent: MsaidiziService,
    private readonly config: MsaidiziConfig,
  ) {}

  /**
   * Resolves an instruction to the capabilities a run would be allowed to use,
   * without saving anything. This is the review step — the caller looks at the
   * list, then calls create with it.
   */
  @Post('compile')
  @RequirePermissions('msaidizi.procedures.manage')
  compile(@Body() dto: CompileProcedureDto, @CurrentUser() user: AuthUser) {
    this.assertEnabled();
    return this.procedures.compile(dto.instruction, user);
  }

  @Post()
  @RequirePermissions('msaidizi.procedures.manage')
  create(@Body() dto: CreateProcedureDto, @CurrentUser() user: AuthUser) {
    this.assertEnabled();
    return this.procedures.create(dto, user);
  }

  /** Approve a procedure for use. Deliberately separate from creation. */
  @Patch(':id/activate')
  @RequirePermissions('msaidizi.procedures.approve')
  activate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    this.assertEnabled();
    return this.procedures.activate(id, user);
  }

  @Patch(':id/archive')
  @RequirePermissions('msaidizi.procedures.manage')
  archive(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    this.assertEnabled();
    return this.procedures.archive(id, user);
  }

  @Get()
  @RequirePermissions('msaidizi.procedures.view')
  findAll(@CurrentUser() user: AuthUser, @Query('companyId') companyId?: string) {
    return this.procedures.findAll(user, companyId);
  }

  @Get(':id')
  @RequirePermissions('msaidizi.procedures.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.procedures.findOne(id, user);
  }

  /**
   * Runs a procedure.
   *
   * Under the *invoker's* permissions, not the author's — a procedure is a saved
   * instruction, never a grant. Bounded to the capability list it was approved
   * with, intersected with what the invoker may actually reach.
   */
  @Post(':id/run')
  @RequirePermissions('msaidizi.use')
  async run(
    @Param('id') id: string,
    @Body() dto: RunProcedureDto,
    @CurrentUser() user: AuthUser,
    @Headers('authorization') authorization?: string,
  ): Promise<RunResult> {
    this.assertEnabled();
    if (!authorization) {
      throw new ForbiddenException('Msaidizi requires a bearer token to act on your behalf.');
    }

    const { instruction, entries } = await this.procedures.resolveForRun(id, user);
    const message = dto.context ? `${instruction}\n\nFor this run: ${dto.context}` : instruction;

    return this.agent.run({
      user,
      authorization,
      confirmed: dto.confirmed,
      restrictTo: entries,
      messages: [{ role: 'user', content: message }],
    });
  }

  private assertEnabled(): void {
    if (!this.config.enabled) {
      throw new ServiceUnavailableException('Msaidizi is not enabled in this deployment.');
    }
  }
}
