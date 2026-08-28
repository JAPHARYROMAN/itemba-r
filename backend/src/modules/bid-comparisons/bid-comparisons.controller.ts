import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common';
import { CompanyStatusPageLimitQueryDto } from '../../common/dto/resource-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { BidComparisonsService } from './bid-comparisons.service';
import { CreateBidComparisonDto, UpdateBidComparisonDto } from './dto/bid-comparison.dto';

@Controller('bid-comparisons')
export class BidComparisonsController {
  constructor(private readonly service: BidComparisonsService) {}

  @Get()
  @RequirePermissions('bid_comparisons.list')
  findAll(@Query() query: CompanyStatusPageLimitQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @AgentExcluded('company_scope_not_enforced')
  @RequirePermissions('bid_comparisons.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('bid_comparisons.create')
  create(@Body() dto: CreateBidComparisonDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('bid_comparisons.create')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateBidComparisonDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Post(':id/approve')
  @RequirePermissions('bid_comparisons.approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, user);
  }
}
