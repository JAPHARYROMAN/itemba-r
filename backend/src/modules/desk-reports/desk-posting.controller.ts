import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { IsIn, IsString, Length, Matches } from 'class-validator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { DeskReportQuery } from './desk-reports.dto';
import { DeskPostingService } from './desk-posting.service';
class SourceParams {
  @IsIn(['sales', 'purchases']) kind!: 'sales' | 'purchases';
}
export class PostSourceDto {
  @Matches(/^[a-f0-9]{64}$/) fingerprint!: string;
  @IsString() @Length(1, 128) debitAccountId!: string;
  @IsString() @Length(1, 128) creditAccountId!: string;
}
@Controller('desk-posting')
export class DeskPostingController {
  constructor(private readonly service: DeskPostingService) {}
  @Get(':kind')
  @RequirePermissions('journal_entries.view')
  list(@CurrentUser() user: AuthUser, @Param() params: SourceParams, @Query() q: DeskReportQuery) {
    return this.service.list(user, params.kind, q);
  }
  @Get(':kind/:id')
  @RequirePermissions('journal_entries.view')
  review(
    @CurrentUser() user: AuthUser,
    @Param('kind') kind: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.review(user, this.kind(kind), id);
  }
  @Post(':kind/:id')
  @RequirePermissions('journal_entries.view', 'journal_entries.create', 'journal_entries.post')
  post(
    @CurrentUser() user: AuthUser,
    @Param('kind') kind: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PostSourceDto,
  ) {
    return this.service.post(user, this.kind(kind), id, dto);
  }
  private kind(kind: string): 'sales' | 'purchases' {
    if (kind !== 'sales' && kind !== 'purchases')
      throw new BadRequestException('Unknown source kind');
    return kind;
  }
}
