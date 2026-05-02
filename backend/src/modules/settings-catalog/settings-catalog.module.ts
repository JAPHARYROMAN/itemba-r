import { Module } from '@nestjs/common';
import { SettingsCatalogService } from './settings-catalog.service';
import { SettingsCatalogController } from './settings-catalog.controller';

@Module({
  providers: [SettingsCatalogService],
  controllers: [SettingsCatalogController],
  exports: [SettingsCatalogService],
})
export class SettingsCatalogModule {}
