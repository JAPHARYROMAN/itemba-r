import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuditEvidencePacksQueryDto } from '../../common/dto/resource-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AuditEvidencePacksService } from './audit-evidence-packs.service';
import { CreateAuditEvidencePackDto } from './dto/create-audit-evidence-pack.dto';
import { UpdateAuditEvidencePackDto } from './dto/update-audit-evidence-pack.dto';
import { CreateAuditEvidencePackItemDto } from './dto/create-audit-evidence-pack-item.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('audit-evidence-packs')
export class AuditEvidencePacksController {
  constructor(private readonly service: AuditEvidencePacksService) {}

  @Get()
  @RequirePermissions('audit_evidence_packs.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: AuditEvidencePacksQueryDto) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('audit_evidence_packs.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('audit_evidence_packs.manage')
  create(@Body() dto: CreateAuditEvidencePackDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('audit_evidence_packs.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAuditEvidencePackDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/review')
  @RequirePermissions('audit_evidence_packs.manage')
  review(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.review(id, user);
  }

  @Patch(':id/mark-ready')
  @RequirePermissions('audit_evidence_packs.manage')
  markReady(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.markReady(id, user);
  }

  @Post(':id/items')
  @RequirePermissions('audit_evidence_packs.manage')
  addItem(
    @Param('id') id: string,
    @Body() dto: CreateAuditEvidencePackItemDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.addItem(id, dto, user);
  }

  @Get(':id/items')
  @RequirePermissions('audit_evidence_packs.view')
  listItems(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.listItems(id, user);
  }

  @Delete(':id/items/:itemId')
  @RequirePermissions('audit_evidence_packs.manage')
  removeItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.removeItem(id, itemId, user);
  }

  @Delete(':id')
  @RequirePermissions('audit_evidence_packs.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
