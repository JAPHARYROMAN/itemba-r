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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  CreateMsaidiziMandateDto,
  QueryMsaidiziMandatesDto,
  UpdateMsaidiziMandateDto,
  VersionedMandateActionDto,
} from './dto/msaidizi-control-plane.dto';
import { MsaidiziMandatesService } from './msaidizi-mandates.service';

@ApiTags('msaidizi-mandates')
@ApiBearerAuth()
@AgentExcluded()
@RequirePermissions('msaidizi.use')
@Controller('msaidizi/mandates')
export class MsaidiziMandatesController {
  constructor(private readonly mandates: MsaidiziMandatesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a draft unattended-authority mandate' })
  create(@Body() dto: CreateMsaidiziMandateDto, @CurrentUser() user: AuthUser) {
    return this.mandates.create(dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'List the caller-owned mandates in accessible companies' })
  list(@Query() query: QueryMsaidiziMandatesDto, @CurrentUser() user: AuthUser) {
    return this.mandates.list(query, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read one scoped mandate' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.mandates.findOne(id, user);
  }

  @Get(':id/versions')
  @ApiOperation({ summary: 'List the immutable version history for one scoped mandate' })
  listVersions(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.mandates.listVersions(id, user);
  }

  @Get(':id/versions/:version')
  @ApiOperation({ summary: 'Read one immutable scoped mandate version' })
  findVersion(
    @Param('id') id: string,
    @Param('version', ParseIntPipe) version: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.mandates.findVersion(id, version, user);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Create the next immutable mandate version using optimistic CAS' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMsaidiziMandateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.mandates.update(id, dto, user);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('msaidizi.use', 'msaidizi.oversight')
  @ApiOperation({ summary: 'Activate a draft or suspended mandate' })
  activate(
    @Param('id') id: string,
    @Body() dto: VersionedMandateActionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.mandates.activate(id, dto.expectedVersion, user);
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspend a currently active mandate' })
  suspend(
    @Param('id') id: string,
    @Body() dto: VersionedMandateActionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.mandates.suspend(id, dto.expectedVersion, user);
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Permanently revoke a mandate while retaining its evidence' })
  revoke(
    @Param('id') id: string,
    @Body() dto: VersionedMandateActionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.mandates.revoke(id, dto.expectedVersion, user);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete authority by revoking it; mandate evidence is retained' })
  remove(
    @Param('id') id: string,
    @Body() dto: VersionedMandateActionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.mandates.revoke(id, dto.expectedVersion, user);
  }
}
