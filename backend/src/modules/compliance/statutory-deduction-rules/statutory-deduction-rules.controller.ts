import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { StatutoryDeductionRulesQueryDto } from '../../../common/dto/resource-query.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { StatutoryDeductionRulesService } from './statutory-deduction-rules.service';
import { CreateStatutoryDeductionRuleDto } from './dto/create-statutory-deduction-rule.dto';
import { UpdateStatutoryDeductionRuleDto } from './dto/update-statutory-deduction-rule.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('compliance/statutory-rules')
export class StatutoryDeductionRulesController {
  constructor(private readonly service: StatutoryDeductionRulesService) {}

  @Get()
  @RequirePermissions('statutory_deduction_rules.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: StatutoryDeductionRulesQueryDto) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('statutory_deduction_rules.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('statutory_deduction_rules.manage')
  create(@Body() dto: CreateStatutoryDeductionRuleDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('statutory_deduction_rules.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateStatutoryDeductionRuleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('statutory_deduction_rules.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
