import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ComplianceRequirementQueryDto } from '../../../common/dto/resource-query.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { ComplianceDocumentRequirementsService } from './compliance-document-requirements.service';
import { CreateComplianceDocumentRequirementDto } from './dto/create-compliance-document-requirement.dto';
import { UpdateComplianceDocumentRequirementDto } from './dto/update-compliance-document-requirement.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('compliance/document-requirements')
export class ComplianceDocumentRequirementsController {
  constructor(private readonly service: ComplianceDocumentRequirementsService) {}

  @Get()
  @RequirePermissions('compliance_document_requirements.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: ComplianceRequirementQueryDto) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('compliance_document_requirements.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('compliance_document_requirements.manage')
  create(@Body() dto: CreateComplianceDocumentRequirementDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('compliance_document_requirements.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateComplianceDocumentRequirementDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('compliance_document_requirements.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
