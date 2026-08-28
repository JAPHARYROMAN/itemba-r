import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  CreateMsaidiziMemoryDto,
  QueryMsaidiziMemoriesDto,
  UpdateMsaidiziMemoryDto,
} from './dto/msaidizi-control-plane.dto';
import { MsaidiziMemoryService } from './msaidizi-memory.service';

@ApiTags('msaidizi-memory')
@ApiBearerAuth()
@AgentExcluded()
@RequirePermissions('msaidizi.use')
@Controller('msaidizi/memory')
export class MsaidiziMemoryController {
  constructor(private readonly memory: MsaidiziMemoryService) {}

  @Post()
  @ApiOperation({ summary: 'Store scoped, encrypted memory after mandatory secret redaction' })
  create(@Body() dto: CreateMsaidiziMemoryDto, @CurrentUser() user: AuthUser) {
    return this.memory.create(dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'List memory metadata without decrypting content' })
  list(@Query() query: QueryMsaidiziMemoriesDto, @CurrentUser() user: AuthUser) {
    return this.memory.list(query, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read and integrity-check one scoped memory record' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.memory.findOne(id, user);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update memory through the same redaction and encryption boundary' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMsaidiziMemoryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.memory.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete memory so it cannot be retrieved' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.memory.remove(id, user);
  }
}
