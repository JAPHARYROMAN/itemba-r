import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  CreateMsaidiziScheduleDto,
  QueryMsaidiziSchedulesDto,
  UpdateMsaidiziScheduleDto,
  VersionedScheduleActionDto,
} from './dto/msaidizi-control-plane.dto';
import { MsaidiziSchedulesService } from './msaidizi-schedules.service';

@ApiTags('msaidizi-schedules')
@ApiBearerAuth()
@AgentExcluded()
@RequirePermissions('msaidizi.use')
@Controller(['msaidizi/schedules', 'msaidizi/routines'])
export class MsaidiziSchedulesController {
  constructor(private readonly schedules: MsaidiziSchedulesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a draft routine/schedule under a mandate' })
  create(@Body() dto: CreateMsaidiziScheduleDto, @CurrentUser() user: AuthUser) {
    return this.schedules.create(dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'List caller-owned routines in accessible mandate scopes' })
  list(@Query() query: QueryMsaidiziSchedulesDto, @CurrentUser() user: AuthUser) {
    return this.schedules.list(query, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read one scoped routine/schedule' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.schedules.findOne(id, user);
  }

  @Get(':id/versions')
  @ApiOperation({ summary: 'List the immutable version history for one scoped routine' })
  listVersions(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.schedules.listVersions(id, user);
  }

  @Get(':id/versions/:version')
  @ApiOperation({ summary: 'Read one immutable scoped routine version' })
  findVersion(
    @Param('id') id: string,
    @Param('version', ParseIntPipe) version: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.schedules.findVersion(id, version, user);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Create the next immutable draft or paused routine version' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMsaidiziScheduleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.schedules.update(id, dto, user);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('msaidizi.use', 'msaidizi.oversight')
  @ApiBody({ type: VersionedScheduleActionDto, required: true })
  @ApiOperation({ summary: 'Activate a routine whose mandate is currently active' })
  activate(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: VersionedScheduleActionDto,
  ) {
    return this.schedules.activate(id, user, dto.expectedVersion);
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: VersionedScheduleActionDto, required: true })
  @ApiOperation({ summary: 'Pause future routine dispatches' })
  pause(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: VersionedScheduleActionDto,
  ) {
    return this.schedules.pause(id, user, dto.expectedVersion);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: VersionedScheduleActionDto, required: true })
  @ApiOperation({ summary: 'Permanently archive a routine while retaining evidence' })
  archive(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: VersionedScheduleActionDto,
  ) {
    return this.schedules.archive(id, user, dto.expectedVersion);
  }

  @Delete(':id')
  @ApiBody({ type: VersionedScheduleActionDto, required: true })
  @ApiOperation({ summary: 'Delete a routine by archiving it' })
  remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: VersionedScheduleActionDto,
  ) {
    return this.schedules.archive(id, user, dto.expectedVersion);
  }
}
