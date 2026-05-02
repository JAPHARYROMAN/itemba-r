import { Controller, Get, Post, Put, Delete, Body, Param, Query, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { SubcontractorsService } from './subcontractors.service';
import { CreateSubcontractorDto } from './dto/create-subcontractor.dto';
import { UpdateSubcontractorDto } from './dto/update-subcontractor.dto';

@Controller('construction/subcontractors')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SubcontractorsController {
  constructor(private service: SubcontractorsService) {}

  @Post() @RequirePermissions('subcontractors.manage')
  create(@Body() dto: CreateSubcontractorDto, @CurrentUser() user: AuthUser) { return this.service.create(dto, user.id); }

  @Get() @RequirePermissions('subcontractors.view')
  findAll(@Query('projectId') projectId?: string, @Query('companyId') companyId?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.findAll(projectId, companyId, page ? +page : 1, limit ? +limit : 20);
  }

  @Get(':id') @RequirePermissions('subcontractors.view')
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  /**
   * Record a milestone claim from the subcontractor — creates a Payable
   * and posts the cost JE.
   */
  @Patch(':id/claim') @RequirePermissions('subcontractors.manage')
  recordClaim(
    @Param('id') id: string,
    @Body() body: { amount: number; description: string; dueDate?: string; supplierId?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.recordClaim(id, body, user.id);
  }

  /**
   * Pay (fully or partially) against an existing subcontractor Payable.
   * Pass `cashAccountId` to also post the cash-side JE.
   */
  @Patch(':id/payment') @RequirePermissions('subcontractors.manage')
  recordPayment(
    @Param('id') id: string,
    @Body() body: { paymentAmount: number; payableId?: string; cashAccountId?: string; reference?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.recordPayment(id, body, user.id);
  }

  @Put(':id') @RequirePermissions('subcontractors.manage')
  update(@Param('id') id: string, @Body() dto: UpdateSubcontractorDto, @CurrentUser() user: AuthUser) { return this.service.update(id, dto, user.id); }

  @Delete(':id') @RequirePermissions('subcontractors.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.remove(id, user.id); }
}
