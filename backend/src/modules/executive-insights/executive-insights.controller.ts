import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { ExecutiveInsightsService } from './executive-insights.service';
import { CreateExecutiveInsightDto } from './dto/create-executive-insight.dto';

@ApiTags('Executive Insights')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('bi/insights')
export class ExecutiveInsightsController {
  constructor(private readonly service: ExecutiveInsightsService) {}

  @Post()
  @RequirePermissions('executive_insights.manage')
  create(@Body() dto: CreateExecutiveInsightDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Get()
  @RequirePermissions('executive_insights.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('executive_insights.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Patch(':id')
  @RequirePermissions('executive_insights.manage')
  update(@Param('id') id: string, @Body() dto: Partial<CreateExecutiveInsightDto>, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/acknowledge')
  @RequirePermissions('executive_insights.acknowledge')
  acknowledge(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.acknowledge(id, user);
  }

  @Patch(':id/resolve')
  @RequirePermissions('executive_insights.resolve')
  resolve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.resolve(id, user);
  }

  @Patch(':id/dismiss')
  @RequirePermissions('executive_insights.manage')
  dismiss(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.dismiss(id, user);
  }

  @Delete(':id')
  @RequirePermissions('executive_insights.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
