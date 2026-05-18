import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { PostingRunsService } from './posting-runs.service';
import { CreatePostingRunDto, QueryPostingRunDto } from './dto/posting-run.dto';

@Controller('posting-runs')
export class PostingRunsController {
  constructor(private readonly service: PostingRunsService) {}

  @Get()
  @RequirePermissions('posting_runs.list')
  findAll(@Query() query: QueryPostingRunDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('posting_runs.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('posting_runs.create')
  create(@Body() dto: CreatePostingRunDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Post(':id/post')
  @RequirePermissions('posting_runs.post')
  post(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.postRun(id, user);
  }

  @Post(':id/reverse')
  @RequirePermissions('posting_runs.reverse')
  reverse(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.reverseRun(id, user);
  }
}
