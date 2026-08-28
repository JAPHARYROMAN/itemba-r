import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common';
import { CompanyStatusPageLimitQueryDto } from '../../common/dto/resource-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { RfqsService } from './rfqs.service';
import { CreateRfqDto, SendRfqDto, UpdateRfqDto } from './dto/rfq.dto';

@Controller('rfqs')
export class RfqsController {
  constructor(private readonly service: RfqsService) {}

  @Get()
  @RequirePermissions('rfqs.list')
  findAll(@Query() query: CompanyStatusPageLimitQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('rfqs.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('rfqs.create')
  create(@Body() dto: CreateRfqDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('rfqs.update')
  update(@Param('id') id: string, @Body() dto: UpdateRfqDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Post(':id/send')
  @RequirePermissions('rfqs.send')
  send(@Param('id') id: string, @Body() dto: SendRfqDto, @CurrentUser() user: AuthUser) {
    return this.service.send(id, dto, user);
  }
}
