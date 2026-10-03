import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsIn, IsOptional, IsUUID } from 'class-validator';
import { PARTY_LINK_SOURCES, PartyLinkSource, PartyLinksService } from './party-links.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';

export class UnlinkedQueryDto {
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsIn(PARTY_LINK_SOURCES as readonly string[]) source?: PartyLinkSource;
}
export class LinkPartyDto {
  @IsUUID() partyId!: string;
  @IsOptional() @IsUUID() requestId?: string;
}
export class LinkManyPartyDto extends LinkPartyDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(500) @IsUUID('all', { each: true }) rowIds!: string[];
}
export class SourceParamDto {
  @IsIn(PARTY_LINK_SOURCES as readonly string[]) source!: PartyLinkSource;
}

/** Unmatched parties: list rows that carry only a typed name, and link them to a master. */
@Controller('party-links')
export class PartyLinksController {
  constructor(private readonly service: PartyLinksService) {}

  @Get('unlinked')
  // Agent-excluded until its Msaidizi evidence fixture is authored: the capability manifest
  // must stay closed over positive fixtures and explicit exclusions (collection read).
  @AgentExcluded()
  @RequirePermissions('party_links.view')
  unlinked(@Query() query: UnlinkedQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.unlinked(user, query);
  }

  @Patch(':source/link-many')
  @AgentExcluded()
  @RequirePermissions('party_links.manage')
  linkMany(
    @Param() params: SourceParamDto,
    @Body() dto: LinkManyPartyDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.linkMany(user, params.source, dto.rowIds, dto.partyId, dto.requestId);
  }

  @Patch(':source/:id')
  @AgentExcluded()
  @RequirePermissions('party_links.manage')
  link(
    @Param() params: SourceParamDto,
    @Param('id') id: string,
    @Body() dto: LinkPartyDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.link(user, params.source, id, dto.partyId, dto.requestId);
  }
}
