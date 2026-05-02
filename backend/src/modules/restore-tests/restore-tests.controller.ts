import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { RestoreTestsService } from './restore-tests.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('restore-tests')
export class RestoreTestsController {
  constructor(private readonly service: RestoreTestsService) {}

  @Get()
  @RequirePermissions('restore_tests.view')
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('restore_tests.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('restore_tests.manage')
  create(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  /**
   * P0-06: Trigger automated checksum verification of a completed backup.
   * Creates a CHECKSUM_VERIFY RestoreTest and enqueues the background worker
   * to re-hash the file and compare against the stored checksum.
   */
  @Post('verify/:backupRunId')
  @RequirePermissions('restore_tests.manage')
  verify(@Param('backupRunId') backupRunId: string, @CurrentUser() user: AuthUser) {
    return this.service.verifyBackup(backupRunId, user.id);
  }

  @Patch(':id')
  @RequirePermissions('restore_tests.manage')
  update(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('restore_tests.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
