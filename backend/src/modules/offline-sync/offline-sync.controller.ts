import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { OfflineSyncService } from './offline-sync.service';
import { CreateSyncBatchDto } from './dto/create-sync-batch.dto';
import { QuerySyncBatchDto } from './dto/query-sync-batch.dto';
import { QuerySyncConflictDto } from './dto/query-sync-conflict.dto';
import { UpsertCheckpointDto } from './dto/upsert-checkpoint.dto';
import { ResolveConflictDto } from './dto/resolve-conflict.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('offline-sync')
export class OfflineSyncController {
  constructor(private readonly service: OfflineSyncService) {}

  @Get('batches')
  @RequirePermissions('offline_sync.view')
  findAllBatches(@Query() query: QuerySyncBatchDto, @CurrentUser() user: AuthUser) {
    return this.service.findAllBatches(query, user);
  }

  @Get('batches/:id')
  @RequirePermissions('offline_sync.view')
  findOneBatch(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOneBatch(id, user);
  }

  @Post('batches')
  @RequirePermissions('offline_sync.manage')
  createBatch(@Body() dto: CreateSyncBatchDto, @CurrentUser() user: AuthUser) {
    return this.service.createBatch(dto, user);
  }

  @Get('checkpoints')
  @RequirePermissions('offline_sync.view')
  findCheckpoints(@CurrentUser() user: AuthUser, @Query('deviceId') deviceId?: string) {
    return this.service.findCheckpoints(user, deviceId);
  }

  @Post('checkpoints')
  @RequirePermissions('offline_sync.manage')
  upsertCheckpoint(@Body() dto: UpsertCheckpointDto, @CurrentUser() user: AuthUser) {
    return this.service.upsertCheckpoint(dto, user);
  }

  @Get('conflicts')
  @RequirePermissions('offline_sync.view')
  findConflicts(@Query() query: QuerySyncConflictDto, @CurrentUser() user: AuthUser) {
    return this.service.findConflicts(query, user);
  }

  @Post('conflicts/:id/resolve')
  @RequirePermissions('offline_sync.resolve_conflicts')
  resolveConflict(
    @Param('id') id: string,
    @Body() dto: ResolveConflictDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.resolveConflict(id, dto, user);
  }
}
