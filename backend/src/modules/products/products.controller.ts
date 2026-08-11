import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { ProductsService } from './products.service';
import { PRODUCT_IMAGE_MAX_BYTES, PRODUCT_IMAGE_MIME_TYPES } from './product-image';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductDto } from './dto/query-product.dto';
import { QueryProductFamilyDto } from './dto/query-product-family.dto';
import { CreateProductFamilyDto, UpdateProductFamilyDto } from './dto/manage-product-family.dto';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('products')
export class ProductsController {
  constructor(private readonly service: ProductsService) {}

  @Get()
  @RequireAnyPermissions(
    'products.view',
    'pos.create',
    'sales.create',
    'purchases.create',
    'inventory.view',
    'inventory.adjustments.create',
    'operations.dashboard.view',
  )
  findAll(@Query() query: QueryProductDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get('families')
  @RequireAnyPermissions('products.view', 'operations.dashboard.view')
  findFamilies(@Query() query: QueryProductFamilyDto, @CurrentUser() user: AuthUser) {
    return this.service.findFamilies(query, user);
  }

  @Post('families')
  @RequirePermissions('product_categories.manage')
  createFamily(@Body() dto: CreateProductFamilyDto, @CurrentUser() user: AuthUser) {
    return this.service.createFamily(dto, user);
  }

  @Patch('families/:id')
  @RequirePermissions('product_categories.manage')
  updateFamily(
    @Param('id') id: string,
    @Body() dto: UpdateProductFamilyDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.updateFamily(id, dto, user);
  }

  @Delete('families/:id')
  @RequirePermissions('product_categories.manage')
  removeFamily(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.removeFamily(id, user);
  }

  @Get(':id')
  @RequireAnyPermissions(
    'products.view',
    'pos.create',
    'sales.create',
    'purchases.create',
    'inventory.view',
    'inventory.adjustments.create',
    'operations.dashboard.view',
  )
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('products.create')
  create(@Body() dto: CreateProductDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('products.update')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('products.delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }

  /** Stream the product image. Same read permissions as the product itself so POS reps can load tiles. */
  @Get(':id/image')
  @RequireAnyPermissions(
    'products.view',
    'pos.create',
    'sales.create',
    'purchases.create',
    'inventory.view',
    'inventory.adjustments.create',
    'operations.dashboard.view',
  )
  async getImage(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.service.getImage(id, user);
    res.set({
      'Content-Type': file.mimeType,
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=300',
    });
    return new StreamableFile(file.buffer);
  }

  /** Upload / replace the product image (multipart field `file`, JPEG/PNG/WebP, ≤ 2 MB). */
  @Post(':id/image')
  @RequirePermissions('products.update')
  @UseInterceptors(
    FileInterceptor('file', {
      // Memory storage: the 2 MB cap keeps buffers small and matches the
      // documents storage entry point (DocumentsService.createFromBuffer).
      fileFilter: (_req, file, cb) => {
        if (PRODUCT_IMAGE_MIME_TYPES.has(file.mimetype)) return cb(null, true);
        return cb(
          new BadRequestException(
            `Unsupported image type: ${file.mimetype}. Use JPEG, PNG, or WebP.`,
          ),
          false,
        );
      },
      limits: { fileSize: PRODUCT_IMAGE_MAX_BYTES },
    }),
  )
  uploadImage(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.setImage(id, file, user);
  }

  @Delete(':id/image')
  @RequirePermissions('products.update')
  removeImage(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.clearImage(id, user);
  }
}
