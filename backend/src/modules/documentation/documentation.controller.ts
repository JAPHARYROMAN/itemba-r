import { Controller, Get } from '@nestjs/common';
import { DocumentationService } from './documentation.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@Controller('documentation')
export class DocumentationController {
  constructor(private readonly service: DocumentationService) {}

  @Get('summary')
  @RequirePermissions('documentation.view')
  getSummary() {
    return this.service.getSummary();
  }
}
